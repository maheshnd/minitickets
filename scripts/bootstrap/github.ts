import { capture, json, type Result } from "./shell.ts";

// Every GitHub call, through the gh CLI (logged in as you: `gh auth status`).
// READ (also in --dry-run): repo, user, OIDC subject, environment, variables, secret names.
// WRITE (never in --dry-run, after one confirmation for all of them): environment, variables, secret.

// 1. This checkout's GitHub repo, e.g. "maheshnd/minitickets".
export function currentRepo(): string | undefined {
  return json<{ nameWithOwner: string }>(capture("gh", ["repo", "view", "--json", "nameWithOwner"]))?.nameWithOwner;
}

// 2. You: the login and the numeric id (an environment's reviewer is set by id).
export function currentUser(): { login: string; id: number } | undefined {
  return json<{ login: string; id: number }>(capture("gh", ["api", "user"]));
}

// 3. The OIDC "subject prefix" GitHub writes into this repo's tokens (cicd.ts step 3).
//    Immutable format (owner and repo IDs): sub_claim_prefix, e.g. "repo:maheshnd@63289193/minitickets@1412723955".
//    Default format (no customization): "repo:<owner>/<repo>".
export function oidcSubjectPrefix(repo: string): string | undefined {
  const sub = json<{ use_default?: boolean; sub_claim_prefix?: string }>(
    capture("gh", ["api", `repos/${repo}/actions/oidc/customization/sub`]),
  );
  if (!sub) return undefined;
  return sub.sub_claim_prefix ?? (sub.use_default ? `repo:${repo}` : undefined);
}

// 4. One environment's required reviewers (their ids), or undefined if the environment does not exist.
export function environmentReviewers(repo: string, name: string): number[] | undefined {
  const env = json<{ protection_rules?: { type: string; reviewers?: { reviewer: { id: number } }[] }[] }>(
    capture("gh", ["api", `repos/${repo}/environments/${encodeURIComponent(name)}`]),
  );
  if (!env) return undefined;
  return (env.protection_rules ?? [])
    .filter((rule) => rule.type === "required_reviewers")
    .flatMap((rule) => rule.reviewers ?? [])
    .map((entry) => entry.reviewer.id);
}

// 5. Create the environment (or update it) with you as the required reviewer. The deploy job then
//    waits for your "Approve" (cd.yml step 20). The body goes in on standard input (--input -).
export function putEnvironment(repo: string, name: string, reviewerId: number): Result {
  const body = JSON.stringify({ reviewers: [{ type: "User", id: reviewerId }], prevent_self_review: false });
  return capture("gh", ["api", "-X", "PUT", `repos/${repo}/environments/${encodeURIComponent(name)}`, "--input", "-"], { input: body });
}

// 6. Variables of the repo (environment undefined) or of one environment: name -> value.
export function listVariables(repo: string, environment?: string): Record<string, string> {
  const args = ["variable", "list", "--repo", repo, "--json", "name,value"];
  if (environment) args.push("--env", environment);
  const list = json<{ name: string; value: string }[]>(capture("gh", args)) ?? [];
  return Object.fromEntries(list.map((variable) => [variable.name, variable.value]));
}

export function setVariable(repo: string, name: string, value: string, environment?: string): Result {
  const args = ["variable", "set", name, "--repo", repo, "--body", value];
  if (environment) args.push("--env", environment);
  return capture("gh", args);
}

// 7. Secret NAMES only (GitHub never gives a secret's value back to anyone).
export function secretNames(repo: string, environment?: string): string[] {
  const args = ["secret", "list", "--repo", repo, "--json", "name"];
  if (environment) args.push("--env", environment);
  return (json<{ name: string }[]>(capture("gh", args)) ?? []).map((secret) => secret.name);
}

// 8. Set an environment secret. The value goes in on standard input (gh reads it from there when
//    --body is missing), so it is never in the arguments.
export function setSecret(repo: string, name: string, value: string, environment: string): Result {
  return capture("gh", ["secret", "set", name, "--repo", repo, "--env", environment], { input: value });
}
