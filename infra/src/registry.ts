// LAYER: registry
// NEEDS (inputs):   nothing
// CREATES:          3 ECR repositories (api, web, worker), each with a lifecycle policy,
//                   + a repository policy on worker: the Lambda service may pull from it (S1c)
// GIVES (outputs):  apiRepoUrl -> used by task (image), and the push script
//                   webRepoUrl -> used by web-task (image) and the push script
//                   workerRepoUrl -> used by jobs/worker-lambda (image) and the push script
//                   repoArns (all repos, in image-repos.ts order) -> used by cicd (the only repos
//                     CD may push to / tag)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "./tags";
import { imageServices, repoName, type ImageService } from "./image-repos";
import { names, prefix } from "./stack";

// The registry layer: private shelves in AWS where our Docker images are stored.
// See docs/16-infra-ecr.md for the explanation.

// 1. Lifecycle policy (the same for all three repositories), as JSON text.
//    WHY: images pile up with every push and storage is billed per GB. Three rules keep it small,
//    WITHOUT deleting an image we may want to roll back to (Step 12b):
//    - rule 1: images CD has deployed (they carry an extra tag "deployed-<sha>", cd.yml phase B):
//      keep the newest 10. These are the rollback targets.
//    - rule 2: every other tagged image (published by CD on each push to main, never deployed):
//      keep the newest 30.
//    - rule 3: untagged images (left over when a push is half done) expire after 1 day.
//    Rules run in priority order (1 first). An image that matches rule 1 is never expired by
//    rule 2, so a deployed image is safe even when 30 newer, never-deployed images exist.
//    WHY this matters: until Step 12b one rule kept "the newest 10 tagged". With CD publishing on
//    every push, the image that is RUNNING could be deleted after 10 pushes, and ECS could then no
//    longer start a replacement task (Spot interruption, crash) from it.
//    "Newest" = pushed most recently. Adding the deployed- tag later does not change that date.
const lifecyclePolicy = JSON.stringify({
  rules: [
    {
      rulePriority: 1,
      description: "Keep the last 10 deployed images (tag deployed-*)",
      selection: {
        tagStatus: "tagged",
        tagPatternList: ["deployed-*"],
        countType: "imageCountMoreThan",
        countNumber: 10,
      },
      action: { type: "expire" },
    },
    {
      rulePriority: 2,
      description: "Keep the last 30 other tagged images",
      selection: { tagStatus: "tagged", tagPatternList: ["*"], countType: "imageCountMoreThan", countNumber: 30 },
      action: { type: "expire" },
    },
    {
      rulePriority: 3,
      description: "Expire untagged images after 1 day",
      selection: { tagStatus: "untagged", countType: "sinceImagePushed", countUnit: "days", countNumber: 1 },
      action: { type: "expire" },
    },
  ],
});

// @concept: ecr
// 2. Helper that builds one repository plus its lifecycle policy, so the repos are not copy-pasted.
function createRepo(service: ImageService) {
  const name = repoName(names.stack, service);

  // @concept: immutable-image-tags
  // @concept: image-scanning
  // WHAT: a private repository that holds the images of one service.
  // WHY: ECS (api, web) and Lambda (worker) pull images from here; they cannot pull from a laptop.
  // DEPENDS ON: nothing.
  // imageTagMutability IMMUTABLE: a tag can never point to different code later, so a tag
  //   (a git SHA) always means exactly one build and deploys are traceable.
  // scanOnPush: AWS runs a basic vulnerability scan on every pushed image.
  // forceDelete: dev only, so the stack can be destroyed even with images inside.
  //   Production keeps it false so a destroy cannot wipe the images.
  const repo = new aws.ecr.Repository(name, {
    name,
    imageTagMutability: "IMMUTABLE",
    imageScanningConfiguration: { scanOnPush: true },
    forceDelete: true,
    tags: tagsFor(name),
  });

  // WHAT: attach the lifecycle policy to the repository.
  // WHY: controls storage cost (see the policy above).
  // DEPENDS ON: repo.name (the policy needs a repository to be attached to).
  // deleteBeforeReplace: a changed policy text makes Pulumi REPLACE this resource (the AWS provider
  //   cannot update it in place). Pulumi's default order is "create the new one, then delete the old
  //   one". Here both are the SAME thing (the one policy of this repository), so that last delete
  //   would remove the NEW policy and leave the repository with none. Deleting first, then creating,
  //   ends with the new policy in place (for a second without any policy, which is harmless).
  new aws.ecr.LifecyclePolicy(
    `${name}-lifecycle`,
    {
      repository: repo.name,
      policy: lifecyclePolicy,
    },
    { deleteBeforeReplace: true },
  );

  return repo;
}

// @concept: aws-lambda
// 3. Repository policy for the worker: let the LAMBDA SERVICE pull its image (S1c).
//    WHY: ECS pulls with the task's EXECUTION ROLE (an IAM permission on our side). Lambda is
//      different: the Lambda service itself pulls the image when the function is created or
//      updated, so the REPOSITORY must allow it (a "resource policy": a rule stuck on the repo,
//      saying who may use it). Without it, AWS tries to add this rule by itself on the first
//      deploy, which needs extra rights (ecr:SetRepositoryPolicy) on whoever creates the function.
//      Written down here, it is visible and reviewed like any other code.
//    WHAT it allows: only the two read actions an image pull needs (manifest + layers), only for
//      the Lambda service, and only when it works for a function named minitickets-dev-* in our
//      account and region (aws:SourceArn). Without that condition, Lambda working for ANY account
//      could pull our image if it knew the address (the "confused deputy", see compute/iam.ts).
//    DEPENDS ON: the worker repository.
function allowLambdaPull(repo: aws.ecr.Repository) {
  const accountId = aws.getCallerIdentityOutput().accountId;
  const region = aws.getRegionOutput().region;
  return new aws.ecr.RepositoryPolicy(`${prefix}-worker-lambda-pull`, {
    repository: repo.name,
    policy: pulumi.jsonStringify({
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "LambdaPullWorkerImage",
          Effect: "Allow",
          Principal: { Service: "lambda.amazonaws.com" },
          Action: ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
          Condition: {
            StringLike: { "aws:SourceArn": pulumi.interpolate`arn:aws:lambda:${region}:${accountId}:function:${prefix}-*` },
          },
        },
      ],
    }),
  });
}

export function createRegistry() {
  // 4. One repository per service in image-repos.ts: the api, web and worker images are built and
  //    deployed separately. Same resource names as before the list existed, so nothing is replaced.
  const repos = {} as Record<ImageService, aws.ecr.Repository>;
  for (const service of imageServices) {
    repos[service] = createRepo(service);
  }
  const workerPull = allowLambdaPull(repos.worker);

  // 5. URLs are for docker (where to push/pull); ARNs are for IAM policies (what a role may touch).
  //    workerRepoUrl only once the pull policy exists (same idea as compute/iam.ts step 8): the
  //    Lambda reads the URL, so it is created after the policy that lets it pull.
  //    repoArns: built from the SAME list, so a new repository reaches the CD roles by itself.
  return {
    apiRepoUrl: repos.api.repositoryUrl,
    webRepoUrl: repos.web.repositoryUrl,
    workerRepoUrl: pulumi.all([repos.worker.repositoryUrl, workerPull.id]).apply(([url]) => url),
    repoArns: imageServices.map((service) => repos[service].arn),
  };
}
