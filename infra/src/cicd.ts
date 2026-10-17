// LAYER: cicd
// NEEDS (inputs):   githubSubjectPrefix     <- from Pulumi config (which GitHub repo may publish / deploy)
//                   repoArns                <- from registry: every repo in image-repos.ts (the
//                                            ONLY repos it may push to / tag)
//                   imageTagParameterArn    <- from release (one of the TWO parameters CD may write)
//                   deployedCommitParameterArn <- from release (the other one: the deploy guard's record)
// CREATES:          1 IAM OIDC provider (trust GitHub's login tokens),
//                   1 role "minitickets-dev-gh-publish" + its inline permission policy,
//                   1 role "minitickets-dev-gh-deploy" + its inline permission policy (Step 12b)
// GIVES (outputs):  publishRoleArn -> copied by hand into the GitHub repo variable AWS_PUBLISH_ROLE_ARN
//                   deployRoleArn  -> copied by hand into the GitHub repo variable AWS_DEPLOY_ROLE_ARN
//                   (both read by .github/workflows/cd.yml)
//
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { tagsFor } from "./tags";
import { names } from "./stack";
import { publishPolicyDocument } from "./publish-policy";
import { prefix } from "./stack";

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
//   GitHub job ── docker push ──▶ ECR (only our 3 repos)
//
// TWO roles, one per job (least privilege):
//   publish role: build + push images. Runs on every push to main, with no human in the loop.
//   deploy role:  `pulumi up` + migrate + roll the services. Only for jobs a human APPROVED.
// The job that builds images (and runs `pnpm install`, i.e. lots of third-party code) must not
// also be able to change what runs in AWS.

// The resource names start with prefix = "minitickets-<stack>" (src/stack.ts), e.g. minitickets-dev-gh-deploy.

// 1. The address of GitHub's token issuer, without "https://". IAM condition keys start with
//    it, e.g. "token.actions.githubusercontent.com:sub".
const githubOidcHost = "token.actions.githubusercontent.com";

export interface CicdInputs {
  githubSubjectPrefix: string;
  // The ARN of every ECR repository (registry.ts builds it from image-repos.ts). One list, so both
  // roles below always cover the same repositories and a new one cannot be forgotten here.
  repoArns: pulumi.Input<string>[];
  imageTagParameterArn: pulumi.Input<string>;
  deployedCommitParameterArn: pulumi.Input<string>;
}

export interface CicdOutputs {
  publishRoleArn: pulumi.Output<string>;
  deployRoleArn: pulumi.Output<string>;
}

// @concept: cd-oidc
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
  //    GitHub writes it into every token. Our repo uses GitHub's IMMUTABLE subject format,
  //    which adds the numeric IDs of the owner and the repo after their names:
  //      old (names only): repo:maheshnd/minitickets:ref:refs/heads/main
  //      ours (immutable): repo:maheshnd@63289193/minitickets@1412723955:ref:refs/heads/main
  //    WHY IDs: names can change hands. If this repo were renamed or deleted, someone could
  //      create a NEW repo with the same name; with names only, its tokens would match this
  //      trust policy. The IDs never change and are never reused, so a renamed or re-created
  //      repo with the same name gets a different "sub" and cannot match.
  //    The part before ":ref:..." is the "subject prefix" (Pulumi config githubSubjectPrefix).
  //    Find it with:  gh api repos/<owner>/<repo>/actions/oidc/customization/sub
  //      -> "sub_claim_prefix": "repo:maheshnd@63289193/minitickets@1412723955"
  //    (The publish job has no `environment:`; with one, GitHub would write "...:environment:<name>"
  //    instead and this role would refuse the job. The deploy job HAS one: see step 8.)
  const allowedSubject = `${inputs.githubSubjectPrefix}:ref:refs/heads/main`;

  // ---------- Publish role ----------
  // TRUST POLICY (who can use it):
  //   a GitHub Actions job, proven by a GitHub token (federated by the provider in step 2),
  //   only when the token is for AWS (aud) AND comes from main of our repo (sub). See step 4.
  // PERMISSION POLICY (what it can do):
  //   log in to ECR + push/pull on ONLY the three minitickets repos (api, web, worker). See step 6.
  // USED BY: .github/workflows/cd.yml, job "publish", step "Configure AWS credentials".

  // 4. The trust policy.
  //    Principal Federated = our OIDC provider: only tokens issued by GitHub count.
  //    Action sts:AssumeRoleWithWebIdentity = "swap a web identity token for AWS credentials".
  //    Two conditions, BOTH must match (StringEquals with two keys = AND):
  //    4a. aud = sts.amazonaws.com: the token was made for AWS. A token GitHub made for some
  //        other service (a different audience) cannot be replayed here.
  //    4b. sub = <subject prefix>:ref:refs/heads/main: the job runs in OUR repo, on main.
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
  const publishRole = new aws.iam.Role(names.publishRoleName, {
    name: names.publishRoleName,
    description: "GitHub Actions (main of our repo only): push images to the 3 minitickets ECR repos",
    assumeRolePolicy: trustPolicy,
    maxSessionDuration: 3600,
    tags: tagsFor(names.publishRoleName),
  });

  // 6. The permission policy: exactly what `docker login` + `docker push` to our repos need
  //    (the statements and their WHY: publish-policy.ts). It lists EVERY repo in inputs.repoArns,
  //    for the check/pull actions AND the push actions alike.
  //    WHY that matters: cd.yml's "check which images already exist" step reads each repo
  //    (BatchGetImage) BEFORE it pushes anything, so a repo missing here fails the whole publish.
  //    LESSON (S1c): the worker repo's ARN reached AWS only with the next `pulumi up`, and the CD
  //    run that was already on its way got "not authorized ... BatchGetImage on minitickets-dev-
  //    worker". A new repo needs this policy applied BEFORE the push that publishes to it.
  // DEPENDS ON: publishRole, plus the repo ARNs (from the registry layer).
  const publishPolicy = new aws.iam.RolePolicy(`${prefix}-gh-publish-ecr`, {
    name: "push-images",
    role: publishRole.id,
    policy: pulumi.jsonStringify(publishPolicyDocument(inputs.repoArns)),
  });

  // ---------- Deploy role (Step 12b) ----------
  // TRUST POLICY (who can use it):
  //   a GitHub Actions job of our repo that runs in the GitHub ENVIRONMENT named after the stack
  //   ("dev" for the dev stack, src/names.ts; step 8b). That environment has a required reviewer, so only a job a human approved gets that far.
  // PERMISSION POLICY (what it can do): whatever `pulumi up` needs for OUR stack (it creates,
  //   changes and deletes everything from the VPC to CloudFront), plus: write the deployed tag and
  //   the deployed commit to SSM, add the "deployed-<sha>" tag in ECR, run + watch the migration
  //   task. See step 10.
  // USED BY: .github/workflows/cd.yml, job "deploy", step "Configure AWS credentials".

  // 8. The trust policy. Same shape as step 4, with a different "sub".
  //    8a. aud = sts.amazonaws.com: same as 4a.
  //    8b. sub = <subject prefix>:environment:<stack>, e.g. ":environment:dev" (names.githubEnvironment).
  //        One environment per stack, so the deploy role of stack "prod" refuses a job approved for "dev".
  //        WHY not ":ref:refs/heads/main": a job that declares `environment: dev` gets the
  //        ENVIRONMENT form of "sub" from GitHub, never the branch form. So this role can only be
  //        used by jobs in the "dev" environment, and GitHub starts those only after the required
  //        reviewer clicked "Approve" (set up in the repo settings, not here). An unapproved job,
  //        the publish job, a pull request or a fork never gets this "sub".
  //        LIMIT to know: "sub" names the environment, not the branch. Which branches may deploy to
  //        "dev" is a setting of the environment ("Deployment branches"); cd.yml also only runs the
  //        deploy job for main. The approval is the real gate.
  // DEPENDS ON: provider.arn.
  const deployTrustPolicy = pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Federated: provider.arn },
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: {
          StringEquals: {
            [`${githubOidcHost}:aud`]: "sts.amazonaws.com",
            [`${githubOidcHost}:sub`]: `${inputs.githubSubjectPrefix}:environment:${names.githubEnvironment}`,
          },
        },
      },
    ],
  });

  // 9. The role itself.
  //    maxSessionDuration 7200 s (2 hours, not 1): a deploy that turns everything on or off waits for
  //    RDS (10-15 min) and, in CloudFront mode, for CloudFront (15-30 min), twice over in a two-phase
  //    deploy. Credentials that die halfway through `pulumi up` would leave the stack half-changed.
  // DEPENDS ON: deployTrustPolicy (so: the provider).
  const deployRole = new aws.iam.Role(names.deployRoleName, {
    name: names.deployRoleName,
    description: `GitHub Actions (approved jobs in environment ${names.githubEnvironment} only): pulumi up, migrate, roll services`,
    assumeRolePolicy: deployTrustPolicy,
    maxSessionDuration: 7200,
    tags: tagsFor(names.deployRoleName),
  });

  // 10. The permission policy.
  //     HONEST SUMMARY: this role is BROAD. `pulumi up` creates and deletes VPCs, databases, load
  //     balancers, CloudFront distributions and IAM roles, and Pulumi does not know the ids of most
  //     of them in advance (a new VPC gets a random id). Most of those services cannot be limited
  //     to "only resources that will be ours" in a simple way, so statement 10a grants whole
  //     services, on every resource in the account: an approved deploy job could also change or
  //     delete things that are NOT ours, if this account holds other projects.
  //     WHAT LIMITS IT:
  //       - WHO: only an approved job in the "dev" environment of our repo (step 8).
  //       - WHERE: only us-east-1 (10l). Global services (IAM, CloudFront, Budgets) are called
  //         through us-east-1, so they still work.
  //       - IAM (the dangerous one, 10c-10g): only roles named minitickets-dev-*, only passed to ECS
  //         tasks or Lambda, and only one AWS managed policy may be attached.
  //       - Secrets (10b): only minitickets/* and the RDS-managed rds!* secrets.
  //       - ECR and SSM (10h, 10i): only our 3 repositories and our 2 parameters.
  //       - The job pipeline (10j, 10k, S1c): only queues, tables and functions named minitickets-dev-*,
  //         and SES identities in this account and region.
  //       - Observability (10m, P2): only the topic, alarms and dashboard named minitickets-dev*.
  //       - TIME: credentials last at most 2 hours (step 9).
  //     WHAT IT DOES NOT STOP (be aware):
  //       - PutRolePolicy cannot be limited by CONTENT: an approved job could write an inline policy
  //         that gives a minitickets-dev-* role (even this one) more power. The proper fix is a
  //         "permissions boundary" (a ceiling no inline policy can raise) or one AWS account per
  //         environment. Not built in dev.
  //       - It can READ the secrets it manages (Pulumi reads them back), e.g. the DB password.
  //     The real protection is the approval: you see WHICH commit you approve.
  // DEPENDS ON: deployRole, the 3 repo ARNs (registry), the parameter ARN (release), account + region.
  const accountId = aws.getCallerIdentityOutput().accountId;
  const region = aws.getRegionOutput().region;
  const deployPolicy = new aws.iam.RolePolicy(`${prefix}-gh-deploy-policy`, {
    name: "deploy",
    role: deployRole.id,
    policy: pulumi.jsonStringify({
      Version: "2012-10-17",
      Statement: [
        // 10a. The services our stack is made of: network + security groups (ec2), ALB
        //      (elasticloadbalancing), cluster/services/task definitions/run-task (ecs), Postgres
        //      (rds), Valkey (elasticache), CloudFront, the certificate (acm), log groups (logs),
        //      Service Connect's namespace (servicediscovery) and the budget.
        //      ecs:* also covers what cd.yml does besides `pulumi up`: run-task (the migration),
        //      describe-tasks / describe-services (what the `aws ecs wait ...` commands poll) and
        //      update-service --force-new-deployment (Step 11h restart).
        //      kms:DescribeKey: RDS checks the key of the secret it manages for us (read-only).
        //      Resource "*": see the HONEST SUMMARY above.
        {
          Sid: "StackServices",
          Effect: "Allow",
          Action: [
            "ec2:*",
            "elasticloadbalancing:*",
            "ecs:*",
            "rds:*",
            "elasticache:*",
            "cloudfront:*",
            "acm:*",
            "logs:*",
            "servicediscovery:*",
            "budgets:*",
            "kms:DescribeKey",
          ],
          Resource: "*",
        },
        // 10b. Secrets Manager, only our secrets: minitickets/* (redis-url, revalidate-secret, ...)
        //      and rds!* (the master password secret that RDS creates for us; RDS creates it with
        //      the CALLER's permissions, so this role needs CreateSecret on it).
        {
          Sid: "OurSecrets",
          Effect: "Allow",
          Action: "secretsmanager:*",
          Resource: [
            pulumi.interpolate`arn:aws:secretsmanager:${region}:${accountId}:secret:minitickets/*`,
            pulumi.interpolate`arn:aws:secretsmanager:${region}:${accountId}:secret:rds!*`,
          ],
        },
        // 10c. Read any role's details. Read-only; Pulumi reads the roles it manages, and ECS /
        //      RDS look up their service-linked roles.
        {
          Sid: "ReadIam",
          Effect: "Allow",
          Action: ["iam:GetRole", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:ListRoleTags"],
          Resource: "*",
        },
        // 10d. Manage OUR roles only (execution roles, task role, publish role, this role): their
        //      names all start with minitickets-dev-. AttachRolePolicy is NOT here (10e).
        {
          Sid: "ManageOurRoles",
          Effect: "Allow",
          Action: [
            "iam:CreateRole",
            "iam:DeleteRole",
            "iam:UpdateRole",
            "iam:UpdateRoleDescription",
            "iam:UpdateAssumeRolePolicy",
            "iam:TagRole",
            "iam:UntagRole",
            "iam:GetRolePolicy",
            "iam:PutRolePolicy",
            "iam:DeleteRolePolicy",
            "iam:DetachRolePolicy",
            "iam:ListInstanceProfilesForRole",
          ],
          Resource: pulumi.interpolate`arn:aws:iam::${accountId}:role/${prefix}-*`,
        },
        // 10e. Attach an AWS managed policy to our roles: ONLY AmazonECSTaskExecutionRolePolicy
        //      (the one compute/iam.ts and web-iam.ts attach). WHY a condition: without it, this role
        //      could attach AdministratorAccess to one of our roles in a single call.
        {
          Sid: "AttachOnlyEcsExecutionPolicy",
          Effect: "Allow",
          Action: "iam:AttachRolePolicy",
          Resource: pulumi.interpolate`arn:aws:iam::${accountId}:role/${prefix}-*`,
          Condition: {
            ArnEquals: { "iam:PolicyARN": "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy" },
          },
        },
        // 10f. PassRole: "hand one of our roles to ECS or Lambda". Needed to register a task
        //      definition with an execution / task role, to run the migration task, and (S1c) to
        //      create the worker function with its role. Only to those two services.
        {
          Sid: "PassOurRolesToEcsTasksAndLambda",
          Effect: "Allow",
          Action: "iam:PassRole",
          Resource: pulumi.interpolate`arn:aws:iam::${accountId}:role/${prefix}-*`,
          Condition: { StringEquals: { "iam:PassedToService": ["ecs-tasks.amazonaws.com", "lambda.amazonaws.com"] } },
        },
        // 10g. The GitHub OIDC provider (step 2) is part of the stack too, so Pulumi manages it.
        //      Plus: let AWS create its own "service-linked roles" for ECS, the ALB, RDS and
        //      ElastiCache, if the account does not have them yet (they usually exist already).
        {
          Sid: "GithubOidcProvider",
          Effect: "Allow",
          Action: [
            "iam:GetOpenIDConnectProvider",
            "iam:CreateOpenIDConnectProvider",
            "iam:DeleteOpenIDConnectProvider",
            "iam:TagOpenIDConnectProvider",
            "iam:UntagOpenIDConnectProvider",
            "iam:ListOpenIDConnectProviderTags",
            "iam:UpdateOpenIDConnectProviderThumbprint",
            "iam:AddClientIDToOpenIDConnectProvider",
            "iam:RemoveClientIDFromOpenIDConnectProvider",
          ],
          Resource: pulumi.interpolate`arn:aws:iam::${accountId}:oidc-provider/${githubOidcHost}`,
        },
        {
          Sid: "ServiceLinkedRoles",
          Effect: "Allow",
          Action: "iam:CreateServiceLinkedRole",
          Resource: pulumi.interpolate`arn:aws:iam::${accountId}:role/aws-service-role/*`,
          Condition: {
            StringEquals: {
              "iam:AWSServiceName": [
                "ecs.amazonaws.com",
                "elasticloadbalancing.amazonaws.com",
                "rds.amazonaws.com",
                "elasticache.amazonaws.com",
              ],
            },
          },
        },
        // 10h. ECR, only our repositories (the same list as the publish role). Everything there, because Pulumi owns them (create,
        //      lifecycle policy, the worker's repository policy, delete). cd.yml uses: DescribeImages
        //      (does the tag exist?), BatchGetImage + PutImage (add the tag "deployed-<sha>" to an
        //      existing image). Creating the worker Lambda also reads its image with the CALLER's
        //      rights (BatchGetImage, GetDownloadUrlForLayer), which this covers.
        //      No GetAuthorizationToken: the deploy job never runs docker.
        {
          Sid: "OurEcrRepos",
          Effect: "Allow",
          Action: "ecr:*",
          Resource: inputs.repoArns,
        },
        // 10i. SSM, only our two parameters (release.ts): Pulumi manages them, cd.yml reads and
        //      writes their values:
        //        /minitickets/dev/image-tag        which image tag is deployed (phase B)
        //        /minitickets/dev/deployed-commit  which commit's infrastructure code CD applied last.
        //          cd.yml's deploy guard READS it before any `pulumi` command and refuses older code
        //          (scripts/deploy-guard.sh); its last step WRITES it. Added after the incident of
        //          2026-10-15 (an old approved run deleted newer resources). Nothing else may touch it.
        //      GetParametersByPath is checked against the PATH (/minitickets/dev): that is how Pulumi
        //      reads the image tag (release.ts step 3). DescribeParameters only lists names and AWS
        //      accepts nothing but "*" for it.
        {
          Sid: "OurReleaseParameters",
          Effect: "Allow",
          Action: [
            "ssm:GetParameter",
            "ssm:GetParameters",
            "ssm:PutParameter",
            "ssm:DeleteParameter",
            "ssm:AddTagsToResource",
            "ssm:RemoveTagsFromResource",
            "ssm:ListTagsForResource",
          ],
          Resource: [inputs.imageTagParameterArn, inputs.deployedCommitParameterArn],
        },
        {
          Sid: "ReadOurParameterPath",
          Effect: "Allow",
          Action: "ssm:GetParametersByPath",
          Resource: pulumi.interpolate`arn:aws:ssm:${region}:${accountId}:parameter${names.path}`,
        },
        {
          Sid: "ListParameterNames",
          Effect: "Allow",
          Action: "ssm:DescribeParameters",
          Resource: "*",
        },
        // 10j. The job pipeline (S1c): everything there, because Pulumi owns it (create, change,
        //      delete), but only OUR resources, by name:
        //        sqs:*      the jobs queue and its DLQ (minitickets-dev-*)
        //        dynamodb:* the processed-jobs table (table/minitickets-dev-*)
        //        lambda:*   the worker function (function:minitickets-dev-*) and its event source
        //                   mapping (event-source-mapping:*: AWS names mappings by a random id, so
        //                   they can't be limited by name)
        //        ses:*      the email identities (identity/*: one is your email ADDRESS, which is a
        //                   secret and must not be written into this policy)
        //      cd.yml uses lambda:GetFunction + ListEventSourceMappings (is the new image running?).
        {
          Sid: "JobPipeline",
          Effect: "Allow",
          Action: ["sqs:*", "dynamodb:*", "lambda:*", "ses:*"],
          Resource: [
            pulumi.interpolate`arn:aws:sqs:${region}:${accountId}:${prefix}-*`,
            pulumi.interpolate`arn:aws:dynamodb:${region}:${accountId}:table/${prefix}-*`,
            pulumi.interpolate`arn:aws:lambda:${region}:${accountId}:function:${prefix}-*`,
            pulumi.interpolate`arn:aws:lambda:${region}:${accountId}:event-source-mapping:*`,
            pulumi.interpolate`arn:aws:ses:${region}:${accountId}:identity/*`,
          ],
        },
        // 10k. Two Lambda actions that are not about one existing resource, so AWS accepts only "*":
        //      CreateEventSourceMapping (the mapping's ARN does not exist yet) and
        //      ListEventSourceMappings (a listing). They only create / list mappings; what a mapping
        //      may then read is decided by the FUNCTION's role (jobs/worker-iam.ts).
        {
          Sid: "LambdaMappingsCreateList",
          Effect: "Allow",
          Action: ["lambda:CreateEventSourceMapping", "lambda:ListEventSourceMappings"],
          Resource: "*",
        },
        // 10m. Observability (series 2, P2, src/observability/): Pulumi owns the alert topic, the
        //      alarms and the dashboard (create, change, delete), but only OURS, by name:
        //        sns:*         the topic minitickets-dev-alerts and its subscription (a subscription's
        //                      ARN is the topic's ARN + ":<id>", so the same pattern covers it)
        //        cloudwatch:*  alarms named minitickets-dev-* and the dashboard minitickets-dev
        //                      (a dashboard ARN has no region: arn:aws:cloudwatch::<account>:dashboard/...)
        //      The saved Logs Insights queries are covered by logs:* (10a).
        //      NEW permissions reach AWS only with a `pulumi up` of THIS policy, and CD's `pulumi up`
        //      would need them already: bootstrap once (docs/20-deploy-day.md 3.12).
        {
          Sid: "Observability",
          Effect: "Allow",
          Action: ["sns:*", "cloudwatch:*"],
          Resource: [
            pulumi.interpolate`arn:aws:sns:${region}:${accountId}:${prefix}-*`,
            pulumi.interpolate`arn:aws:cloudwatch:${region}:${accountId}:alarm:${prefix}-*`,
            pulumi.interpolate`arn:aws:cloudwatch::${accountId}:dashboard/${prefix}`,
          ],
        },
        // 10m2. Reading alarm settings: DescribeAlarms is a listing (read-only); allowed on "*" in case
        //       AWS checks it against the account rather than the named alarms.
        {
          Sid: "ReadAlarms",
          Effect: "Allow",
          Action: "cloudwatch:DescribeAlarms",
          Resource: "*",
        },
        // 10l. A DENY beats every Allow above: nothing outside our region. WHY: 10a is broad; this at
        //      least keeps a mistake (or a misuse) out of every other region of the account.
        //      Global services (IAM, CloudFront, Budgets) send their requests to us-east-1, so they
        //      still pass. If the stack ever moves region, change this together with aws:region.
        {
          // P4 WHO: approved deploy job (trust above). WHAT: manage only our asset bucket.
          // ATTACHED: gh-deploy; Lambda separately gets PutObject on tickets/ only.
          Sid: "TicketAssets",
          Effect: "Allow",
          Action: "s3:*",
          Resource: [pulumi.interpolate`arn:aws:s3:::${prefix}-ticket-assets-${accountId}`,
            pulumi.interpolate`arn:aws:s3:::${prefix}-ticket-assets-${accountId}/*`],
        },
        {
          Sid: "DenyOtherRegions",
          Effect: "Deny",
          Action: "*",
          Resource: "*",
          Condition: { StringNotEquals: { "aws:RequestedRegion": region } },
        },
      ],
    }),
  });

  // 11. Return each ARN only once its policy is attached (same idea as compute/iam.ts step 8).
  //     WHY: someone copies these ARNs into GitHub; a role without its policy would make the
  //     first CD run fail with "not authorized".
  return {
    publishRoleArn: pulumi.all([publishRole.arn, publishPolicy.id]).apply(([arn]) => arn),
    deployRoleArn: pulumi.all([deployRole.arn, deployPolicy.id]).apply(([arn]) => arn),
  };
}
