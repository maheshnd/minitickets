// LAYER: cicd
// NEEDS (inputs):   githubOwner, githubRepo <- from Pulumi config (which GitHub repo may publish)
//                   apiRepoArn, webRepoArn  <- from registry (the ONLY repos it may push to)
// CREATES:          1 IAM OIDC provider (trust GitHub's login tokens),
//                   1 role "minitickets-dev-gh-publish" + its inline permission policy
// GIVES (outputs):  publishRoleArn -> copied by hand into a GitHub repo variable,
//                                     read by .github/workflows/cd.yml
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "./tags";

// The CI/CD layer: lets GitHub Actions push images to ECR WITHOUT any stored AWS keys.
// Always on: IAM roles and OIDC providers cost nothing.
//
// OIDC in simple words:
//   Every GitHub Actions job can ask GitHub for a short-lived ID card (a signed token, a
//   "JWT"). The card says WHO is asking: which repo, which branch, which workflow.
//   AWS checks GitHub's signature on the card, reads those details, and, if they match the
//   role's trust policy, hands out AWS credentials that expire after about one hour.
//   So nothing secret is ever stored in GitHub: there is no access key that could leak.
//
//   GitHub job ── "give me an ID card" ──▶ GitHub (token.actions.githubusercontent.com)
//   GitHub job ── ID card ──▶ AWS STS ── checks signature + trust conditions
//   GitHub job ◀── temporary credentials (1 h) ── AWS STS
//   GitHub job ── docker push ──▶ ECR (only our 2 repos)
//
// Only PUBLISHING lives here. A later deploy step gets its OWN role (least privilege): the
// role that builds and pushes images must not also be able to change what runs in ECS.

const prefix = "minitickets-dev";

// 1. The address of GitHub's token issuer, without "https://". IAM condition keys start with
//    it, e.g. "token.actions.githubusercontent.com:sub".
const githubOidcHost = "token.actions.githubusercontent.com";

export interface CicdInputs {
  githubOwner: string;
  githubRepo: string;
  apiRepoArn: pulumi.Input<string>;
  webRepoArn: pulumi.Input<string>;
}

export interface CicdOutputs {
  publishRoleArn: pulumi.Output<string>;
}

export function createCicd(inputs: CicdInputs): CicdOutputs {
  // 2. The OIDC provider: tells IAM "tokens signed by GitHub's issuer may be used here".
  //    WHAT: registers GitHub as an identity provider in our AWS account (one per account,
  //      per URL: a second one with the same URL is refused).
  //    clientIdLists ["sts.amazonaws.com"]: the "audience" a token must be made for. GitHub's
  //      AWS action asks for exactly this audience.
  //    No thumbprintLists: AWS checks GitHub's certificate against its own list of trusted
  //      authorities, so the old certificate fingerprint is no longer needed.
  //    WHY: without it, AWS would not accept GitHub's tokens at all.
  // DEPENDS ON: nothing.
  const provider = new aws.iam.OpenIdConnectProvider(`${prefix}-github-oidc`, {
    url: `https://${githubOidcHost}`,
    clientIdLists: ["sts.amazonaws.com"],
    tags: tagsFor(`${prefix}-github-oidc`),
  });

  // 3. The "sub" (subject) value we accept: this one repo, and only its main branch.
  //    GitHub writes it into every token, e.g. repo:maheshnd/minitickets:ref:refs/heads/main.
  //    (cd.yml has no `environment:`; with one, GitHub would write "...:environment:<name>"
  //    instead and this role would refuse the job.)
  const allowedSubject = `repo:${inputs.githubOwner}/${inputs.githubRepo}:ref:refs/heads/main`;

  // ---------- Publish role ----------
  // TRUST POLICY (who can use it):
  //   a GitHub Actions job, proven by a GitHub token (federated by the provider in step 2),
  //   only when the token is for AWS (aud) AND comes from main of our repo (sub). See step 4.
  // PERMISSION POLICY (what it can do):
  //   log in to ECR + push/pull on ONLY the two minitickets repos. See step 6.
  // USED BY: .github/workflows/cd.yml, job "publish", step "Configure AWS credentials".

  // 4. The trust policy.
  //    Principal Federated = our OIDC provider: only tokens issued by GitHub count.
  //    Action sts:AssumeRoleWithWebIdentity = "swap a web identity token for AWS credentials".
  //    Two conditions, BOTH must match (StringEquals with two keys = AND):
  //    4a. aud = sts.amazonaws.com: the token was made for AWS. A token GitHub made for some
  //        other service (a different audience) cannot be replayed here.
  //    4b. sub = repo:<owner>/<repo>:ref:refs/heads/main: the job runs in OUR repo, on main.
  //        WHY it matters most: the OIDC provider trusts GitHub as a whole. Every repo on
  //        GitHub, anyone's, gets tokens from the same issuer. Without "sub", ANY GitHub repo
  //        could assume this role and push to our registry. With it, only main of our repo
  //        can; a feature branch, a pull request or a fork is refused.
  //        StringEquals (not StringLike with "*"): an exact match, so no wildcard can be
  //        widened by mistake.
  // DEPENDS ON: provider.arn.
  const trustPolicy = pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Federated: provider.arn },
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: {
          StringEquals: {
            [`${githubOidcHost}:aud`]: "sts.amazonaws.com",
            [`${githubOidcHost}:sub`]: allowedSubject,
          },
        },
      },
    ],
  });

  // 5. The role itself (the badge, with the trust policy, no permissions yet).
  //    maxSessionDuration 3600 s (the default, written out): the credentials die after 1 hour,
  //    long enough for a build, short enough that a leaked copy is soon useless.
  // DEPENDS ON: trustPolicy (so: the provider).
  const publishRole = new aws.iam.Role(`${prefix}-gh-publish`, {
    name: `${prefix}-gh-publish`,
    description: "GitHub Actions (main of our repo only): push images to the 2 minitickets ECR repos",
    assumeRolePolicy: trustPolicy,
    maxSessionDuration: 3600,
    tags: tagsFor(`${prefix}-gh-publish`),
  });

  // 6. The permission policy: exactly what `docker login` + `docker push` to our 2 repos need.
  // DEPENDS ON: publishRole, plus the two repo ARNs (from the registry layer).
  const publishPolicy = new aws.iam.RolePolicy(`${prefix}-gh-publish-ecr`, {
    name: "push-images",
    role: publishRole.id,
    policy: pulumi.jsonStringify({
      Version: "2012-10-17",
      Statement: [
        // 6a. Log in to ECR.
        //     WHAT: ecr:GetAuthorizationToken returns the 12-hour password for `docker login`.
        //     WHY Resource "*": this action is not tied to one repository (the login is for
        //     the whole registry), so AWS only accepts "*" here. It grants no access by itself:
        //     what the login may then do is decided by statement 6b.
        {
          Sid: "EcrLogin",
          Effect: "Allow",
          Action: "ecr:GetAuthorizationToken",
          Resource: "*",
        },
        // 6b. Push and pull, on ONLY our two repositories.
        //     PULL side (read):
        //       BatchCheckLayerAvailability: "do you already have this layer?" (push skips it)
        //       BatchGetImage:               read a manifest (cd.yml checks if a tag exists)
        //       GetDownloadUrlForLayer:      download a layer or config (part of reading)
        //     PUSH side (write):
        //       InitiateLayerUpload, UploadLayerPart, CompleteLayerUpload: upload one layer
        //       PutImage: write the manifest + tag (the moment the image becomes visible)
        //     WHY only these two ARNs: least privilege. Even with these credentials, nobody
        //     can touch another repository, delete images (no BatchDeleteImage), change
        //     lifecycle rules, or call ECS, IAM or anything else.
        {
          Sid: "PushPullMiniticketsRepos",
          Effect: "Allow",
          Action: [
            "ecr:BatchCheckLayerAvailability",
            "ecr:BatchGetImage",
            "ecr:GetDownloadUrlForLayer",
            "ecr:InitiateLayerUpload",
            "ecr:UploadLayerPart",
            "ecr:CompleteLayerUpload",
            "ecr:PutImage",
          ],
          Resource: [inputs.apiRepoArn, inputs.webRepoArn],
        },
      ],
    }),
  });

  // 7. Return the ARN only once the policy is attached (same idea as compute/iam.ts step 8).
  //    WHY: someone copies this ARN into GitHub; a role without its policy would make the
  //    first CD run fail with "not authorized".
  return {
    publishRoleArn: pulumi.all([publishRole.arn, publishPolicy.id]).apply(([arn]) => arn),
  };
}
