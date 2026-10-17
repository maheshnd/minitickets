// The ECR repositories (one per service image). The ONE list of them is imageServices in names.ts
// (kept there because that file has no imports, so the bootstrap script can read it too). Who uses it:
//   - registry.ts creates a repository for each service;
//   - cicd.ts lets the publish and deploy roles touch exactly these repositories (their ARNs come
//     from registry.ts, so they follow the list);
//   - publish-policy.test.ts checks that the publish job in .github/workflows/cd.yml uses no
//     repository that is missing from it;
//   - scripts/infra-bootstrap.ts sets one GitHub variable per repository (repoVariable).
// WHY one list: in S1c the worker repository was added in three places by hand. A fourth
//   place that is forgotten next time shows up as "not authorized" in CD, not here.
// Pure code (no Pulumi), so a unit test can import it.
import { imageServices, namesFor, repoVariable, type ImageService } from "./names";

export { imageServices, repoVariable, type ImageService };

// 1. The repository name of one service in one stack, e.g. "minitickets-dev-worker".
export function repoName(stack: string, service: ImageService): string {
  return namesFor(stack).repoName(service);
}
