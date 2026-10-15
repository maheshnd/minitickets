// The ECR repositories (one per service image). This is the ONE list of them:
//   - registry.ts creates a repository for each service here;
//   - cicd.ts lets the publish and deploy roles touch exactly these repositories (their ARNs come
//     from registry.ts, so they follow this list);
//   - publish-policy.test.ts checks that the publish job in .github/workflows/cd.yml uses no
//     repository that is missing here.
// WHY one list: in S1c the worker repository was added in three places by hand. A fourth
//   place that is forgotten next time shows up as "not authorized" in CD, not here.
// Pure code (no Pulumi), so a unit test can import it.

const prefix = "minitickets-dev";

// 1. The services that have their own image. Add a new one HERE, then add its build to cd.yml.
export const imageServices = ["api", "web", "worker"] as const;
export type ImageService = (typeof imageServices)[number];

// 2. The repository name of one service, e.g. "minitickets-dev-worker" (cd.yml's *_REPO_NAME).
export function repoName(service: ImageService): string {
  return `${prefix}-${service}`;
}
