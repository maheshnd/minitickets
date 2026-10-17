import { imageServices, namesFor } from "../../infra/src/names.ts";

// WHAT CD needs in AWS before its FIRST run, as Pulumi targets (URNs). Pure, so it is unit-tested.
//
// WHY only these: the first CD run does everything else itself (`pulumi up` with all switches off
// creates the network, the queues, the certificate, ...). But CD cannot create the things it needs
// to START:
//
//   publish job ── needs ──▶ GitHub OIDC provider + publish role + its policy + 3 ECR repositories
//   deploy job  ── needs ──▶ deploy role + its policy (it runs `pulumi up` with it)
//               ── reads ──▶ SSM image-tag + deployed-commit (the deploy guard, cd.yml 28b)
//
// A URN is Pulumi's full name of one resource: urn:pulumi:<stack>::<project>::<type>::<name>.
// The names below must match the resource names in infra/src (cicd.ts, registry.ts, release.ts);
// the bootstrap checks that every one of them is in the stack after the apply.

export const PULUMI_PROJECT = "minitickets";

export type Target = { urn: string; what: string };

// The type of the GitHub OIDC provider, also needed by `pulumi import` (infra-bootstrap.ts step 3).
export const OIDC_PROVIDER_TYPE = "aws:iam/openIdConnectProvider:OpenIdConnectProvider";

// 1. The Pulumi name of the OIDC provider (cicd.ts step 2).
export function oidcProviderName(stack: string): string {
  return `${namesFor(stack).prefix}-github-oidc`;
}

// 2. One URN.
function urn(stack: string, type: string, name: string): string {
  return `urn:pulumi:${stack}::${PULUMI_PROJECT}::${type}::${name}`;
}

// 3. The list, in the order CD meets them.
export function bootstrapTargets(stack: string): Target[] {
  const names = namesFor(stack);
  const p = names.prefix;
  const targets: Target[] = [
    // 3a. cicd.ts: the OIDC provider and both roles with their inline policies.
    { urn: urn(stack, OIDC_PROVIDER_TYPE, oidcProviderName(stack)), what: "GitHub OIDC provider (AWS trusts GitHub's tokens)" },
    { urn: urn(stack, "aws:iam/role:Role", names.publishRoleName), what: "publish role (job publish logs in as it)" },
    { urn: urn(stack, "aws:iam/rolePolicy:RolePolicy", `${p}-gh-publish-ecr`), what: "publish role policy (push to our 3 repositories)" },
    { urn: urn(stack, "aws:iam/role:Role", names.deployRoleName), what: "deploy role (job deploy logs in as it)" },
    { urn: urn(stack, "aws:iam/rolePolicy:RolePolicy", `${p}-gh-deploy-policy`), what: "deploy role policy (what pulumi up may do)" },
  ];

  // 3b. registry.ts: one repository + its lifecycle policy per image, and the worker's pull policy.
  for (const service of imageServices) {
    const repo = names.repoName(service);
    targets.push(
      { urn: urn(stack, "aws:ecr/repository:Repository", repo), what: `ECR repository ${repo}` },
      { urn: urn(stack, "aws:ecr/lifecyclePolicy:LifecyclePolicy", `${repo}-lifecycle`), what: `lifecycle policy of ${repo}` },
    );
  }
  targets.push({
    urn: urn(stack, "aws:ecr/repositoryPolicy:RepositoryPolicy", `${p}-worker-lambda-pull`),
    what: "worker repository policy (Lambda may pull the image)",
  });

  // 3c. release.ts: the two SSM parameters CD reads before its first `pulumi up`.
  targets.push(
    { urn: urn(stack, "aws:ssm/parameter:Parameter", `${p}-image-tag`), what: `SSM ${names.imageTagParameter}` },
    { urn: urn(stack, "aws:ssm/parameter:Parameter", `${p}-deployed-commit`), what: `SSM ${names.deployedCommitParameter}` },
  );
  return targets;
}
