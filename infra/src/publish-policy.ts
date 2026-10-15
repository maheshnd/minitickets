// The permission policy of the publish role (cicd.ts step 6), as a plain object.
// WHY its own file: pure code (no Pulumi), so publish-policy.test.ts can check it. cicd.ts passes
//   it to pulumi.jsonStringify, which waits for the repo ARNs and turns it into JSON text.

// 1. What `docker push` (and cd.yml's "does this tag exist?" check) needs on ONE repository.
//    PULL side (read):
//      BatchCheckLayerAvailability: "do you already have this layer?" (push skips it)
//      BatchGetImage:               read a manifest (cd.yml checks if a tag exists)
//      GetDownloadUrlForLayer:      download a layer or config (part of reading)
//    PUSH side (write):
//      InitiateLayerUpload, UploadLayerPart, CompleteLayerUpload: upload one layer
//      PutImage: write the manifest + tag (the moment the image becomes visible)
export const ecrPushPullActions = [
  "ecr:BatchCheckLayerAvailability",
  "ecr:BatchGetImage",
  "ecr:GetDownloadUrlForLayer",
  "ecr:InitiateLayerUpload",
  "ecr:UploadLayerPart",
  "ecr:CompleteLayerUpload",
  "ecr:PutImage",
];

// 2. The whole policy. repoArns = EVERY repository from image-repos.ts (registry.ts builds the
//    list), so a new repository is covered without touching this file.
//    T: a plain string in the test, a Pulumi Input<string> in cicd.ts.
export function publishPolicyDocument<T>(repoArns: T[]) {
  return {
    Version: "2012-10-17",
    Statement: [
      // 2a. Log in to ECR.
      //     WHAT: ecr:GetAuthorizationToken returns the 12-hour password for `docker login`.
      //     WHY Resource "*": this action is not tied to one repository (the login is for
      //     the whole registry), so AWS only accepts "*" here. It grants no access by itself:
      //     what the login may then do is decided by statement 2b.
      {
        Sid: "EcrLogin",
        Effect: "Allow",
        Action: "ecr:GetAuthorizationToken",
        Resource: "*",
      },
      // 2b. Push and pull (step 1), on ONLY our repositories.
      //     WHY only these ARNs: least privilege. Even with these credentials, nobody can touch
      //     another repository, delete images (no BatchDeleteImage), change lifecycle rules, or
      //     call ECS, IAM or anything else.
      {
        Sid: "PushPullMiniticketsRepos",
        Effect: "Allow",
        Action: ecrPushPullActions,
        Resource: repoArns,
      },
    ],
  };
}
