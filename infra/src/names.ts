// The names of everything one stack creates, built from the Pulumi STACK name ("dev", "prod", ...).
// WHY: one AWS account (or a second one) can hold another copy of MiniTickets only if no two
//   copies share a name. Every name below comes from the stack name, so `pulumi stack init prod`
//   gives minitickets-prod-* next to (or instead of) minitickets-dev-*.
// Pure code with NO imports, so the bootstrap script (scripts/infra-bootstrap.ts, run by Node
// directly, which needs ".ts" in every import) and the unit tests can use it too. Inside the Pulumi
// program, src/stack.ts calls it with the real stack name.
//
//   stack "dev" ──▶ resources   minitickets-dev-api, minitickets-dev-jobs, ...
//               ──▶ SSM + logs  /minitickets/dev/image-tag, /minitickets/dev/api, ...
//               ──▶ secrets     minitickets/dev/redis-url, ...
//               ──▶ GitHub      environment "dev" (the deploy job waits for approval there)

// 1. The services that have their own image: ONE ECR repository each (image-repos.ts says who uses
//    this list). Add a new one HERE, then add its build to cd.yml.
export const imageServices = ["api", "web", "worker"] as const;
export type ImageService = (typeof imageServices)[number];

// 2. What a stack name may look like: 2-20 characters, lowercase letters, digits and single hyphens,
//    starting with a letter. WHY so strict: it ends up inside AWS names with tight rules, e.g. the
//    load balancer's name (minitickets-<stack>, max 32 characters) and the Valkey group's id (no "--",
//    no "-" at the end).
export function isValidStackName(stack: string): boolean {
  return /^[a-z][a-z0-9-]{1,19}$/.test(stack) && !stack.includes("--") && !stack.endsWith("-");
}

// 3. Every name of one stack.
export function namesFor(stack: string) {
  // 3a. The start of every resource name, e.g. "minitickets-dev".
  const prefix = `minitickets-${stack}`;
  // 3b. The folder for SSM parameters and log groups, e.g. "/minitickets/dev".
  //     A folder (path) so IAM and Pulumi can name "everything of this stack" in one rule.
  const path = `/minitickets/${stack}`;

  return {
    stack,
    prefix,
    path,
    // 3c. Secrets Manager names have no leading slash: "minitickets/dev/redis-url".
    secretPath: `minitickets/${stack}`,
    // 3d. The two SSM parameters CD reads and writes (release.ts).
    imageTagParameter: `${path}/image-tag`,
    deployedCommitParameter: `${path}/deployed-commit`,
    // 3e. The GitHub environment of the deploy job: the same word as the stack (cicd.ts step 8).
    githubEnvironment: stack,
    // 3f. Names cd.yml uses directly (it gets them from GitHub variables, scripts/infra-bootstrap.ts).
    repoName: (service: ImageService) => `${prefix}-${service}`,
    workerFunctionName: `${prefix}-worker`,
    ticketFunctionName: `${prefix}-tickets`,
    // 3g. The two CD roles (cicd.ts steps 5 and 9) and the alert topic (observability/alert-topic.ts).
    publishRoleName: `${prefix}-gh-publish`,
    deployRoleName: `${prefix}-gh-deploy`,
    alertTopicName: `${prefix}-alerts`,
  };
}

// 4. The GitHub variable that holds a repository's name for cd.yml, e.g. "WORKER_REPO_NAME".
export function repoVariable(service: ImageService): string {
  return `${service.toUpperCase()}_REPO_NAME`;
}
