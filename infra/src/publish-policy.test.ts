import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { imageServices, repoName, repoVariable } from "./image-repos";
import { publishPolicyDocument } from "./publish-policy";

// The repositories the publish job really uses. cd.yml's top-level env reads each name from a GitHub
// variable (e.g. "WORKER_REPO_NAME: ${{ vars.WORKER_REPO_NAME }}"), which scripts/infra-bootstrap.ts
// sets to repoName(<stack>, service). So: the variable names in cd.yml, turned back into services,
// then into the dev stack's repository names. A repo added there but not in image-repos.ts fails here.
const cdYml = readFileSync(path.join(__dirname, "../../.github/workflows/cd.yml"), "utf8");
function repoVariablesInCdWorkflow(): string[] {
  // Both jobs' `env:` blocks list them (publish and deploy), so each name once.
  const found = [...cdYml.matchAll(/^ +([A-Z_]+_REPO_NAME): \$\{\{ vars\.([A-Z_]+) \}\}$/gm)].map((match) => {
    expect(match[2], "each *_REPO_NAME reads the variable of the same name").toBe(match[1]);
    return match[1];
  });
  return [...new Set(found)];
}
function repoNamesInCdWorkflow(): string[] {
  return repoVariablesInCdWorkflow().map((variable) => {
    const service = imageServices.find((s) => repoVariable(s) === variable);
    return service ? repoName("dev", service) : `unknown repository variable ${variable}`;
  });
}

// A fake ARN in the shape AWS uses for an ECR repository.
function repoArn(name: string): string {
  return `arn:aws:ecr:us-east-1:123456789012:repository/${name}`;
}

// The same list cicd.ts gets from registry.ts: one ARN per service in image-repos.ts.
const policy = publishPolicyDocument(imageServices.map((service) => repoArn(repoName("dev", service))));

// Does any Allow statement give `action` on exactly `arn`? (No wildcards: the policy must name it.)
function allows(action: string, arn: string): boolean {
  return policy.Statement.some((statement) => {
    const actions = ([] as string[]).concat(statement.Action);
    const resources = ([] as string[]).concat(statement.Resource);
    return statement.Effect === "Allow" && actions.includes(action) && resources.includes(arn);
  });
}

describe("publish role policy", () => {
  // 1. The list in image-repos.ts and the publish job in cd.yml name the same repositories.
  //    WHY: the policy is built from the list; a repo only cd.yml knows would get "not authorized".
  it("covers every repository the publish job in cd.yml uses", () => {
    const used = repoNamesInCdWorkflow();
    expect(used.length).toBeGreaterThan(0);
    expect([...used].sort()).toEqual(imageServices.map((s) => repoName("dev", s)).sort());
  });

  // 1b. No repository name is typed into cd.yml any more: they all come from the stack's variables.
  //     (Comments may still say "e.g. minitickets-dev-api"; only the lines that run are checked.)
  it("cd.yml spells no stack-specific name", () => {
    const code = cdYml.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");
    expect(code).not.toMatch(/minitickets-dev|\/minitickets\/dev|stack select dev|'dev'|\[dev\]/);
  });

  // 2. On EVERY repo: the check/pull action (cd.yml reads each tag before pushing) AND the push
  //    actions. S1c's failure: BatchGetImage on minitickets-dev-worker was not allowed yet.
  const needed = [
    "ecr:BatchGetImage",
    "ecr:BatchCheckLayerAvailability",
    "ecr:InitiateLayerUpload",
    "ecr:UploadLayerPart",
    "ecr:CompleteLayerUpload",
    "ecr:PutImage",
  ];
  for (const name of repoNamesInCdWorkflow()) {
    it(`grants check + push on ${name}`, () => {
      for (const action of needed) {
        expect(allows(action, repoArn(name)), action).toBe(true);
      }
    });
  }

  // 3. Least privilege: nothing that deletes images or changes a repository.
  it("does not grant delete or repository changes", () => {
    for (const name of repoNamesInCdWorkflow()) {
      expect(allows("ecr:BatchDeleteImage", repoArn(name))).toBe(false);
      expect(allows("ecr:DeleteRepository", repoArn(name))).toBe(false);
    }
  });
});
