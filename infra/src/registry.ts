// LAYER: registry
// NEEDS (inputs):   nothing
// CREATES:          2 ECR repositories (api, web), each with a lifecycle policy
// GIVES (outputs):  apiRepoUrl -> used by task (image), and the push script
//                   webRepoUrl -> used by the push script (and, later, the web task)
//
import * as aws from "@pulumi/aws";
import { tagsFor } from "./tags";

// The registry layer: private shelves in AWS where our Docker images are stored.
// See docs/16-infra-ecr.md for the explanation.

const prefix = "minitickets-dev";

// 1. Lifecycle policy (the same for both repositories), as JSON text.
//    WHY: images pile up with every push and storage is billed per GB. Two rules keep it small:
//    - rule 1: untagged images (left over when a tag moves or a push is half done) expire after 1 day.
//    - rule 2: of the tagged images, keep only the newest 10; older ones are deleted.
//    Rules run in priority order (1 first).
const lifecyclePolicy = JSON.stringify({
  rules: [
    {
      rulePriority: 1,
      description: "Expire untagged images after 1 day",
      selection: { tagStatus: "untagged", countType: "sinceImagePushed", countUnit: "days", countNumber: 1 },
      action: { type: "expire" },
    },
    {
      rulePriority: 2,
      description: "Keep only the last 10 tagged images",
      selection: { tagStatus: "tagged", tagPatternList: ["*"], countType: "imageCountMoreThan", countNumber: 10 },
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
  new aws.ecr.LifecyclePolicy(`${name}-lifecycle`, {
    repository: repo.name,
    policy: lifecyclePolicy,
  });

  return repo;
}

export function createRegistry() {
  // 3. One repository per service: the api and web images are built and deployed separately.
  const api = createRepo("api");
  const web = createRepo("web");

  return {
    apiRepoUrl: api.repositoryUrl,
    webRepoUrl: web.repositoryUrl,
  };
}
