import { imageServices, namesFor, repoVariable } from "../../infra/src/names.ts";

// The GitHub variables cd.yml reads (see "NAMES COME FROM GITHUB VARIABLES" at the top of cd.yml),
// built from the stack's names. Pure, so it is unit-tested.
//
//   repo variables         -> job publish (it has NO environment: cd.yml 7c)
//   environment variables  -> job deploy, in the environment named after the stack
//
// An environment variable wins over a repo variable with the same name, so the deploy job always
// sees its own stack's values, even if the repo variables point at another stack.

export type GithubVariables = { repo: Record<string, string>; environment: Record<string, string> };

// 1. A role ARN is predictable from the account and the role name (no path), so the variables can be
//    shown BEFORE the roles exist (in a dry run of a new account). The bootstrap compares them with
//    the stack outputs once the roles exist.
export function roleArn(account: string, roleName: string): string {
  return `arn:aws:iam::${account}:role/${roleName}`;
}

export function githubVariables(stack: string, account: string, region: string): GithubVariables {
  const names = namesFor(stack);
  const repos = Object.fromEntries(imageServices.map((service) => [repoVariable(service), names.repoName(service)]));

  return {
    // 2. For job publish (and the default environment of a CI-started deploy).
    repo: {
      AWS_REGION: region,
      AWS_PUBLISH_ROLE_ARN: roleArn(account, names.publishRoleName),
      ...repos,
      DEPLOY_ENVIRONMENT: names.githubEnvironment,
    },
    // 3. For job deploy. PULUMI_STACK = the environment's own name (cd.yml checks they agree).
    environment: {
      PULUMI_STACK: stack,
      AWS_REGION: region,
      AWS_DEPLOY_ROLE_ARN: roleArn(account, names.deployRoleName),
      ...repos,
      WORKER_FUNCTION_NAME: names.workerFunctionName,
      TICKET_FUNCTION_NAME: names.ticketFunctionName,
      IMAGE_TAG_PARAMETER: names.imageTagParameter,
      DEPLOYED_COMMIT_PARAMETER: names.deployedCommitParameter,
    },
  };
}

// 4. The account inside an ARN ("arn:aws:iam::258237553751:role/x" -> "258237553751"), to notice a
//    repo variable that still points at ANOTHER account.
export function accountOf(arn: string | undefined): string | undefined {
  return arn?.split(":")[4] || undefined;
}
