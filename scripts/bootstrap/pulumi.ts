import { capture, INFRA, json, stream, type Result } from "./shell.ts";

// Every Pulumi command the bootstrap runs, always with --stack (never `pulumi stack select`, which
// would change which stack YOUR terminal uses afterwards) and always in infra/.
//
// READ (also in --dry-run): whoami, stack ls, config, stack output, stack export, preview.
// WRITE (never in --dry-run, each after a confirmation): stack init, config set, import, up.

export type PulumiTarget = { stack: string; profile: string };

// AWS_PROFILE: how the Pulumi AWS provider finds the credentials (CLAUDE.md: never in the stack file).
function pulumi(target: PulumiTarget, args: string[], input?: string): Result {
  return capture("pulumi", [...args, "--non-interactive"], { cwd: INFRA, env: { AWS_PROFILE: target.profile }, input });
}

// 1. Logged in to Pulumi Cloud? Gives the user name, or undefined.
export function whoami(): string | undefined {
  const result = capture("pulumi", ["whoami", "--non-interactive"], { cwd: INFRA });
  return result.ok ? result.stdout.trim() : undefined;
}

// 2. Does the stack exist? (Its name may come back as "dev" or "<org>/dev".)
export function stackExists(stack: string): boolean | { error: string } {
  const result = capture("pulumi", ["stack", "ls", "--json", "--non-interactive"], { cwd: INFRA });
  const stacks = json<{ name: string }[]>(result);
  if (!stacks) return { error: (result.stderr || result.stdout).trim() };
  return stacks.some((entry) => entry.name === stack || entry.name.endsWith(`/${stack}`));
}

export function initStack(target: PulumiTarget): Result {
  return pulumi(target, ["stack", "init", target.stack, "--no-select"]);
}

// 3. The stack's config. Secrets come back as { secret: true } WITHOUT their value (no
//    --show-secrets): the bootstrap only needs to know whether they are set.
export type ConfigEntry = { value?: string; secret: boolean };
export function readConfig(target: PulumiTarget): Record<string, ConfigEntry> {
  return json<Record<string, ConfigEntry>>(pulumi(target, ["config", "--json", "--stack", target.stack])) ?? {};
}

// 4. Set one value. A secret is passed on standard input (pulumi reads the value from there when the
//    command line has none), so it never appears in the arguments or on the screen.
export function setConfig(target: PulumiTarget, key: string, value: string, secret: boolean): Result {
  if (secret) return pulumi(target, ["config", "set", "--secret", key, "--stack", target.stack], value);
  return pulumi(target, ["config", "set", key, value, "--stack", target.stack]);
}

// 5. Stack outputs (publishRoleArn, certificateValidationRecord, ...). {} before the first update.
export function readOutputs(target: PulumiTarget): Record<string, unknown> {
  return json<Record<string, unknown>>(pulumi(target, ["stack", "output", "--json", "--stack", target.stack])) ?? {};
}

// 6. The URNs of every resource the stack's state knows (what was created or imported so far).
export function stateUrns(target: PulumiTarget): Set<string> {
  const exported = json<{ deployment?: { resources?: { urn: string }[] } }>(pulumi(target, ["stack", "export", "--stack", target.stack]));
  return new Set((exported?.deployment?.resources ?? []).map((resource) => resource.urn));
}

// 7. Preview ONLY the targets and count what would happen to them.
//    --json: one machine-readable result with each step ("op": create, update, same, ...).
export type PreviewCounts = Record<string, number>;
export function previewTargets(target: PulumiTarget, urns: string[]): { counts: PreviewCounts; byUrn: Map<string, string> } | { error: string } {
  const args = ["preview", "--stack", target.stack, "--json", ...urns.flatMap((urn) => ["--target", urn])];
  const result = pulumi(target, args);
  const parsed = json<{ steps?: { urn: string; op: string }[]; changeSummary?: PreviewCounts; diagnostics?: { message: string; severity: string }[] }>(
    { ...result, ok: true },
  );
  if (!result.ok || !parsed) {
    const problems = parsed?.diagnostics?.filter((d) => d.severity === "error").map((d) => d.message.trim());
    return { error: problems?.length ? problems.join("\n") : (result.stderr || result.stdout).trim() };
  }
  // Count per targeted URN (so untargeted resources never show up in the numbers).
  const byUrn = new Map<string, string>();
  for (const step of parsed.steps ?? []) if (urns.includes(step.urn)) byUrn.set(step.urn, step.op);
  for (const urn of urns) if (!byUrn.has(urn)) byUrn.set(urn, parsed.steps ? "same" : "unknown");
  const counts: PreviewCounts = {};
  for (const op of byUrn.values()) counts[op] = (counts[op] ?? 0) + 1;
  return { counts, byUrn };
}

// 7b. The same preview for a human: what changes, property by property (--diff), shown live.
//     Only READS, like every preview. Run when 7 found something to change, before "Apply?".
export function showPreview(target: PulumiTarget, urns: string[]): number {
  return stream("pulumi", ["preview", "--stack", target.stack, "--diff", "--non-interactive", ...urns.flatMap((urn) => ["--target", urn])], {
    cwd: INFRA,
    env: { AWS_PROFILE: target.profile },
  });
}

// 8. Apply ONLY the targets, output shown live. --yes: the bootstrap already asked "Apply?".
export function upTargets(target: PulumiTarget, urns: string[]): number {
  return stream("pulumi", ["up", "--stack", target.stack, "--yes", "--non-interactive", ...urns.flatMap((urn) => ["--target", urn])], {
    cwd: INFRA,
    env: { AWS_PROFILE: target.profile },
  });
}

// 9. Adopt an EXISTING AWS resource into the stack (instead of creating a second one).
//    --protect=false: `pulumi import` protects imported resources by default; the code does not, and
//      the two should agree. --generate-code=false: the code already exists (cicd.ts).
export function importResource(target: PulumiTarget, type: string, name: string, id: string): number {
  return stream("pulumi", ["import", type, name, id, "--stack", target.stack, "--yes", "--non-interactive", "--protect=false", "--generate-code=false"], {
    cwd: INFRA,
    env: { AWS_PROFILE: target.profile },
  });
}
