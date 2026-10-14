// LAYER: registry
// NEEDS (inputs):   nothing
// CREATES:          2 ECR repositories (api, web), each with a lifecycle policy
// GIVES (outputs):  apiRepoUrl -> used by task (image), and the push script
//                   webRepoUrl -> used by the push script (and, later, the web task)
//                   apiRepoArn, webRepoArn -> used by cicd (the only repos CD may push to / tag)
//
import * as aws from "@pulumi/aws";
import { tagsFor } from "./tags";

// The registry layer: private shelves in AWS where our Docker images are stored.
// See docs/16-infra-ecr.md for the explanation.

const prefix = "minitickets-dev";

// 1. Lifecycle policy (the same for both repositories), as JSON text.
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
// 2. Helper that builds one repository plus its lifecycle policy, so api and web are not copy-pasted.
function createRepo(service: "api" | "web") {
  const name = `${prefix}-${service}`;

  // @concept: immutable-image-tags
  // @concept: image-scanning
  // WHAT: a private repository that holds the images of one service.
  // WHY: ECS (a later step) pulls images from here; it cannot pull from our laptop.
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

export function createRegistry() {
  // 3. One repository per service: the api and web images are built and deployed separately.
  const api = createRepo("api");
  const web = createRepo("web");

  // 4. URLs are for docker (where to push/pull); ARNs are for IAM policies (what a role may touch).
  return {
    apiRepoUrl: api.repositoryUrl,
    webRepoUrl: web.repositoryUrl,
    apiRepoArn: api.arn,
    webRepoArn: web.arn,
  };
}
