// `pnpm infra:bootstrap --stack <name> --profile <aws profile> [--region <region>] [--dry-run]`
// Sets up MiniTickets in an AWS account (a new one, or checks an existing one), so CD can take over.
// Plain-English checklist of the same flow: docs/21-new-aws-account.md.
//
// SAFE TO RUN AGAIN: every step first LOOKS at what exists and only adds what is missing. Stopped
// halfway (Ctrl+C, an error, a DNS record not live yet)? Run the same command again: it continues.
// --dry-run: every read, check and preview, but NOTHING is changed (no stack config, no pulumi up,
// no GitHub writes). Every change in a normal run is shown first and needs your "y".
//
//   1. AWS account + region   who am I, is it the right account, other MiniTickets stacks here?
//   2. Pulumi stack + config  create/select the stack, ask for missing config, switches false
//   3. Bootstrap resources    the 14 things CD needs before its first run (scripts/bootstrap/targets.ts):
//                             preview -> "Apply?" -> pulumi up --target ... (import an existing OIDC provider)
//   4. GitHub                 environment "<stack>" (you approve deploys), variables, Pulumi token
//   5. DNS                    certificate + DKIM records in Cloudflare's format; wait until live
//   6. Checks                 SES, alert email, Lambda limit, CloudFront (what to click)
//   7. Next steps             commit the stack config, push, approve, CNAME
//
// It never runs `pulumi up` on anything but the bootstrap targets, and never without asking.

import { existsSync } from "node:fs";
import path from "node:path";
import { namesFor } from "../infra/src/names.ts";
import { parseBootstrapArgs } from "./bootstrap/args.ts";
import { callerIdentity, certificateStatus, githubOidcProviderArn, miniTicketsStacks, profileRegion } from "./bootstrap/aws.ts";
import { accountChecks } from "./bootstrap/checks.ts";
import { findZone, nameInZone, printCloudflare, waitUntilLive, type DnsRecord } from "./bootstrap/dns.ts";
import * as github from "./bootstrap/github.ts";
import { accountOf, githubVariables } from "./bootstrap/github-variables.ts";
import { ask, askSecret, confirm, confirmWord } from "./bootstrap/prompt.ts";
import * as pulumi from "./bootstrap/pulumi.ts";
import { capture, firstError, INFRA } from "./bootstrap/shell.ts";
import { bootstrapTargets, OIDC_PROVIDER_TYPE, oidcProviderName } from "./bootstrap/targets.ts";
import { printSection } from "./stack/results.ts";

// 0. The command line.
const args = parseBootstrapArgs(process.argv.slice(2));
if ("error" in args) {
  console.error(args.error);
  process.exit(2);
}
const { stack, profile, dryRun } = args;
const names = namesFor(stack);
const pulumiTarget = { stack, profile };

// What this run changed (or, in a dry run, WOULD change), and what is left for you to do by hand.
const changes: string[] = [];
const manual: string[] = [];

const heading = (title: string) => console.log(`\n${title}\n${"─".repeat(title.length)}`);
const ok = (text: string) => console.log(`  ✓ ${text}`);
const warn = (text: string) => console.log(`  ! ${text}`);
const info = (text: string) => console.log(`    ${text}`);
function stop(message: string): never {
  console.error(`\n✗ ${message}\nNothing after this point was changed. Fix it, then run the same command again.`);
  process.exit(1);
}
// In a dry run: say what WOULD happen, record it, do nothing. Returns true when the caller may act.
function mayChange(what: string): boolean {
  changes.push(what);
  if (dryRun) info(`would ${what} (dry run: skipped)`);
  return !dryRun;
}

console.log(`MiniTickets infra bootstrap: stack "${stack}", AWS profile "${profile}"${dryRun ? " (DRY RUN: changes nothing)" : ""}`);

// 0b. The tools. Each one is a CLI you also use by hand (docs/21-new-aws-account.md "Before you start").
for (const [tool, versionArgs] of [["aws", ["--version"]], ["pulumi", ["version"]], ["gh", ["--version"]], ["dig", ["-v"]], ["git", ["--version"]]] as const) {
  if (capture(tool, [...versionArgs]).code === 127) stop(`"${tool}" is not installed (docs/21-new-aws-account.md, "Before you start").`);
}

// ───────────────────────── 1. AWS account + region ─────────────────────────
heading("1. AWS account and region");

// 1a. Who am I? An expired login stops here, before anything else runs.
const identity = callerIdentity(profile);
if ("error" in identity) {
  stop(`AWS profile "${profile}" cannot log in: ${identity.error}\n  Log in again (aws login --profile ${profile}, or aws sso login --profile ${profile}).`);
}

// 1b. Does the stack exist already? Then its config and outputs say where it lives.
const exists = pulumi.stackExists(stack);
if (typeof exists === "object") stop(`Pulumi: ${exists.error}\n  Log in once: pulumi login`);
let config = exists ? pulumi.readConfig(pulumiTarget) : {};
let outputs = exists ? pulumi.readOutputs(pulumiTarget) : {};
const configRegion = config["aws:region"]?.value;

// 1c. The region: --region, else the stack's aws:region, else the profile's, else ask.
if (args.region && configRegion && args.region !== configRegion) {
  stop(`--region ${args.region} differs from the stack's aws:region ${configRegion}. A stack lives in ONE region; leave out --region.`);
}
const region = args.region ?? configRegion ?? profileRegion(profile) ?? (await ask("AWS region for this stack?", "us-east-1"));
const awsTarget = { profile, region };

// 1d. A stack that already lives in ANOTHER account: the profile is wrong. Never continue (Pulumi
//     would try to change resources it cannot see, or create a second copy in the wrong account).
const stackAccount = accountOf(typeof outputs.publishRoleArn === "string" ? outputs.publishRoleArn : undefined);
if (stackAccount && stackAccount !== identity.account) {
  stop(`Stack "${stack}" lives in AWS account ${stackAccount}, but profile "${profile}" is account ${identity.account}. Use that account's profile.`);
}

info(`Account:  ${identity.account}`);
info(`Identity: ${identity.arn}`);
info(`Region:   ${region}`);
info(`Stack:    ${stack} (${exists ? "exists in Pulumi" : "new"})`);
if (!(await confirm(`Set up MiniTickets "${stack}" in account ${identity.account}, region ${region}?`))) stop("Stopped: not the right account or region.");

// 1e. Another MiniTickets stack in this account? Names never clash (each stack has its own prefix),
//     but they would SHARE the account's one GitHub OIDC provider, its budget and its Lambda limit.
const otherStacks = [...miniTicketsStacks(awsTarget)].filter((other) => other !== stack);
if (otherStacks.length === 0) {
  ok(`No other MiniTickets stack in this account${exists ? ` (only "${stack}")` : ""}.`);
} else {
  warn(`This account already holds another MiniTickets stack: ${otherStacks.join(", ")}.`);
  info("Your names will not clash (minitickets-<stack>-...), but both stacks then share the account's ONE");
  info("GitHub OIDC provider (step 3 imports it: destroying either stack later deletes it for both),");
  info("its Lambda concurrency limit and its bill. One account per stack is the clean setup.");
  if (!(await confirmWord("Use this account anyway?", stack))) stop("Stopped: the account holds another MiniTickets stack.");
}

// ───────────────────────── 2. Pulumi stack + config ─────────────────────────
heading("2. Pulumi stack and config");
const pulumiUser = pulumi.whoami();
if (!pulumiUser) stop("Not logged in to Pulumi Cloud. Run: pulumi login");
ok(`Pulumi user: ${pulumiUser}`);

// 2a. Create the stack if it is new (it stays NOT selected: your terminal keeps its current stack).
let stackReady = exists;
if (exists) {
  ok(`Stack "${stack}" exists.`);
} else if (mayChange(`create the Pulumi stack "${stack}" (pulumi stack init ${stack})`)) {
  const result = pulumi.initStack(pulumiTarget);
  if (!result.ok) stop(`pulumi stack init ${stack}: ${firstError(result)}`);
  ok(`Stack "${stack}" created.`);
  stackReady = true;
}

// 2b. The config the program needs. Existing values are KEPT (never overwritten): to change one,
//     use `pulumi config set` yourself. Missing ones are asked for (secrets hidden) or derived.
const repo = github.currentRepo();
if (!repo) stop("gh cannot see this repo. Run: gh auth login (then rerun).");
const subjectPrefix = github.oidcSubjectPrefix(repo);
if (!subjectPrefix) stop(`Could not read the OIDC subject of ${repo}: gh api repos/${repo}/actions/oidc/customization/sub`);

type Wanted = { key: string; label: string; secret: boolean; value: () => Promise<string> };
const wanted: Wanted[] = [
  { key: "aws:region", label: "AWS region", secret: false, value: async () => region },
  {
    key: "minitickets:domainName",
    label: "your domain for the app",
    secret: false,
    value: async () => {
      const domain = (await ask("Domain for the app (e.g. minitickets.example.com, a name you control at Cloudflare)?")).toLowerCase();
      if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) stop(`"${domain}" is not a domain name like minitickets.example.com.`);
      return domain;
    },
  },
  { key: "minitickets:alertEmail", label: "alert + budget email", secret: true, value: () => askSecret("Email address for alarms and budget alerts?") },
  { key: "minitickets:sesTestRecipient", label: "SES test recipient", secret: true, value: () => askSecret("Your own email address for test emails (SES sandbox)?") },
  { key: "minitickets:githubSubjectPrefix", label: "GitHub OIDC subject prefix", secret: false, value: async () => subjectPrefix },
  // 2c. The cost switches: OFF in a new stack. CD turns things on when you commit them as true.
  ...["dataEnabled", "computeEnabled", "entryEnabled", "cdnEnabled"].map((name) => ({
    key: `minitickets:${name}`,
    label: `switch ${name}`,
    secret: false,
    value: async () => "false",
  })),
];
const missingConfig: string[] = [];
for (const item of wanted) {
  const current = config[item.key];
  if (current) {
    ok(`${item.key} = ${current.secret ? "(secret, set)" : current.value}`);
    if (item.key === "minitickets:githubSubjectPrefix" && current.value !== subjectPrefix) {
      warn(`GitHub says the subject prefix is ${subjectPrefix}. The roles trust the config value: if CD's login fails, fix it with pulumi config set.`);
    }
    continue;
  }
  if (!mayChange(`set ${item.key} (${item.label})${item.secret ? " as a secret" : ""}`) || !stackReady) {
    missingConfig.push(item.key);
    continue;
  }
  const value = await item.value();
  if (!value) stop(`${item.key} cannot be empty.`);
  const result = pulumi.setConfig(pulumiTarget, item.key.replace(/^minitickets:/, ""), value, item.secret);
  if (!result.ok) stop(`pulumi config set ${item.key}: ${firstError(result)}`);
  ok(`${item.key} = ${item.secret ? "(secret, set)" : value}`);
}
config = stackReady ? pulumi.readConfig(pulumiTarget) : config;
const domainName = config["minitickets:domainName"]?.value;

// ───────────────────────── 3. Bootstrap resources ─────────────────────────
heading("3. What CD needs before its first run");
const targets = bootstrapTargets(stack);
const urns = targets.map((target) => target.urn);
info(`${targets.length} resources: the GitHub OIDC provider, the publish + deploy roles and their policies,`);
info("the 3 ECR repositories with their policies, and the 2 SSM parameters (scripts/bootstrap/targets.ts).");
let awsNothingToCreate = false;

if (!stackReady || missingConfig.length > 0) {
  warn(`Preview skipped: the stack ${stackReady ? `has no ${missingConfig.join(", ")} yet` : "does not exist yet"} (a dry run does not create it).`);
  info(`A real run would preview, then ask "Apply?": on a fresh account expect ${targets.length} to create.`);
} else {
  // 3a. The account's GitHub OIDC provider. An account may hold only ONE per URL, so if it exists
  //     but is not in this stack, Pulumi must IMPORT (adopt) it; creating it would fail.
  let state = pulumi.stateUrns(pulumiTarget);
  const providerArn = githubOidcProviderArn(awsTarget);
  const providerUrn = targets[0].urn;
  if (providerArn && state.has(providerUrn)) {
    ok("GitHub OIDC provider: exists and belongs to this stack.");
  } else if (providerArn) {
    warn(`This account already has a GitHub OIDC provider (${providerArn}), not managed by this stack.`);
    info("AWS allows only one per account, so a second one cannot be created. The bootstrap imports it:");
    info("Pulumi then manages the existing one (it may update its tags). Careful: `pulumi destroy` of this");
    info("stack would then DELETE it, also for anything else in the account that logs in from GitHub.");
    if (mayChange(`import the existing OIDC provider into "${stack}" (pulumi import)`)) {
      if (!(await confirm("Import it?"))) stop("Stopped: the OIDC provider was not imported.");
      if (pulumi.importResource(pulumiTarget, OIDC_PROVIDER_TYPE, oidcProviderName(stack), providerArn) !== 0) stop("pulumi import failed (see above).");
      state = pulumi.stateUrns(pulumiTarget);
    }
  } else {
    ok("GitHub OIDC provider: none in this account yet, so it will be created.");
  }

  // 3b. Preview ONLY the targets, and count.
  const preview = pulumi.previewTargets(pulumiTarget, urns);
  if ("error" in preview) stop(`pulumi preview failed:\n${preview.error}`);
  const changing = [...preview.byUrn.entries()].filter(([, op]) => op !== "same");
  const inState = urns.filter((urn) => state.has(urn)).length;
  info(`Preview: ${Object.entries(preview.counts).map(([op, n]) => `${n} ${op}`).join(", ")}  (${inState} of ${targets.length} already in the stack)`);
  info(`Expected: ${targets.length} create on a fresh account, ${targets.length} same once bootstrapped.`);

  if (changing.length === 0 && inState === targets.length) {
    ok("Nothing to create: every bootstrap resource exists and matches the code.");
    awsNothingToCreate = true;
  } else {
    for (const [urn, op] of changing) info(`  ${op.padEnd(8)} ${targets.find((target) => target.urn === urn)?.what ?? urn}`);
    // 3c. The full preview, property by property, so "Apply?" is an informed answer.
    pulumi.showPreview(pulumiTarget, urns);
    if (changing.some(([, op]) => op.includes("delete") || op.includes("replace"))) {
      warn("The preview REPLACES or DELETES something. Read it above before you answer.");
    }
    if (mayChange(`apply ${changing.length} change(s) with pulumi up --target (only these ${targets.length} resources)`)) {
      if (!(await confirm("Apply?"))) stop("Stopped before pulumi up.");
      if (pulumi.upTargets(pulumiTarget, urns) !== 0) stop("pulumi up failed (see above). Rerun to continue.");
      const after = pulumi.stateUrns(pulumiTarget);
      const missing = targets.filter((target) => !after.has(target.urn));
      if (missing.length > 0) stop(`After pulumi up these are still not in the stack: ${missing.map((m) => m.what).join(", ")}`);
      ok(`All ${targets.length} bootstrap resources exist.`);
      outputs = pulumi.readOutputs(pulumiTarget);
    }
  }
}

// ───────────────────────── 4. GitHub ─────────────────────────
heading(`4. GitHub (${repo})`);
const me = github.currentUser();
if (!me) stop("gh cannot read your user. Run: gh auth login");
const environment = names.githubEnvironment;
const desired = githubVariables(stack, identity.account, region);

// 4a. The role ARNs are predictable; once the roles exist, the stack outputs must agree.
for (const [output, variable] of [["publishRoleArn", desired.repo.AWS_PUBLISH_ROLE_ARN], ["deployRoleArn", desired.environment.AWS_DEPLOY_ROLE_ARN]]) {
  if (typeof outputs[output] === "string" && outputs[output] !== variable) warn(`Stack output ${output} is ${outputs[output]}, expected ${variable}.`);
}

// 4b. The environment, with you as the required reviewer.
const reviewers = github.environmentReviewers(repo, environment);
const needsEnvironment = reviewers === undefined || !reviewers.includes(me.id);
if (!needsEnvironment) ok(`Environment "${environment}" exists, ${me.login} is a required reviewer.`);

// 4c. Each variable: keep (same value), set (missing) or change (different value).
type Row = { scope: string; name: string; from?: string; to: string };
const rows: Row[] = [];
const repoVars = github.listVariables(repo);
const envVars = reviewers === undefined ? {} : github.listVariables(repo, environment);
for (const [name, to] of Object.entries(desired.repo)) rows.push({ scope: "repo", name, from: repoVars[name], to });
for (const [name, to] of Object.entries(desired.environment)) rows.push({ scope: `env ${environment}`, name, from: envVars[name], to });
const toSet = rows.filter((row) => row.from !== row.to);
for (const row of rows.filter((r) => r.from === r.to)) ok(`${row.scope} ${row.name} = ${row.to}`);

// 4d. Repo variables are shared by EVERY stack: changing them moves publishing (or the default deploy).
const oldPublishAccount = accountOf(repoVars.AWS_PUBLISH_ROLE_ARN);
if (oldPublishAccount && oldPublishAccount !== identity.account) {
  warn(`Repo variable AWS_PUBLISH_ROLE_ARN points at account ${oldPublishAccount}. Changing it moves image publishing`);
  info(`to account ${identity.account}: the stack in ${oldPublishAccount} then gets no new images (cd.yml 7c).`);
}
if (repoVars.DEPLOY_ENVIRONMENT && repoVars.DEPLOY_ENVIRONMENT !== environment) {
  warn(`DEPLOY_ENVIRONMENT is "${repoVars.DEPLOY_ENVIRONMENT}": changing it sends every CI-started deploy to "${environment}".`);
}

// 4e. The Pulumi token: an environment or repo secret is enough (the environment's wins).
const envSecrets = reviewers === undefined ? [] : github.secretNames(repo, environment);
const hasToken = envSecrets.includes("PULUMI_ACCESS_TOKEN") || github.secretNames(repo).includes("PULUMI_ACCESS_TOKEN");
if (hasToken) ok("Secret PULUMI_ACCESS_TOKEN is set (repo or environment).");

if (!needsEnvironment && toSet.length === 0 && hasToken) {
  ok("Nothing to change on GitHub.");
} else {
  info("Will set:");
  if (needsEnvironment) info(`  environment "${environment}" with required reviewer ${me.login}`);
  for (const row of toSet) info(`  ${row.scope.padEnd(12)} ${row.name.padEnd(26)} ${row.from ? `${row.from} -> ` : ""}${row.to}`);
  if (!hasToken) info(`  env ${environment}    secret PULUMI_ACCESS_TOKEN (you paste it, hidden)`);
  if (mayChange(`make these ${toSet.length + (needsEnvironment ? 1 : 0) + (hasToken ? 0 : 1)} GitHub change(s)`)) {
    if (!(await confirm("Set all of this on GitHub?"))) stop("Stopped before the GitHub changes.");
    if (needsEnvironment) {
      const result = github.putEnvironment(repo, environment, me.id);
      if (!result.ok) stop(`Could not create environment ${environment}: ${firstError(result)}`);
      ok(`Environment "${environment}" with reviewer ${me.login}.`);
    }
    for (const row of toSet) {
      const result = github.setVariable(repo, row.name, row.to, row.scope === "repo" ? undefined : environment);
      if (!result.ok) stop(`gh variable set ${row.name}: ${firstError(result)}`);
      ok(`${row.scope} ${row.name} = ${row.to}`);
    }
    if (!hasToken) {
      info("Create a token: app.pulumi.com -> your avatar -> Personal access tokens -> Create token.");
      const token = await askSecret("Paste the Pulumi access token for PULUMI_ACCESS_TOKEN");
      if (!token) stop("No token pasted.");
      const result = github.setSecret(repo, "PULUMI_ACCESS_TOKEN", token, environment);
      if (!result.ok) stop(`gh secret set PULUMI_ACCESS_TOKEN: ${firstError(result)}`);
      ok(`Secret PULUMI_ACCESS_TOKEN set in environment "${environment}".`);
    }
  }
}

// ───────────────────────── 5. DNS ─────────────────────────
heading("5. DNS records (added by hand at Cloudflare)");
const records: DnsRecord[] = [];
const validation = outputs.certificateValidationRecord as { name: string; type: string; value: string } | null | undefined;
if (validation) records.push({ ...validation, why: "certificate (ACM validation, keep it: renewals use it)" });
const dkim = outputs.sesDkimRecords as { name: string; type: string; value: string }[] | null | undefined;
(dkim ?? []).forEach((record, i) => records.push({ ...record, why: `SES DKIM ${i + 1}/${dkim?.length}` }));

if (records.length === 0) {
  warn("No records yet: the first CD deploy creates the certificate and the SES identity.");
  manual.push("After the first CD deploy: rerun this command for the DNS records (step 5) and the checks (step 6).");
} else {
  const zone = domainName ? findZone(domainName) : undefined;
  printCloudflare(records, zone);
  const certificateArn = typeof outputs.certificateArn === "string" ? outputs.certificateArn : undefined;
  if (certificateArn) info(`Certificate status: ${certificateStatus(awsTarget, certificateArn) ?? "unknown"}`);
  const missing = await waitUntilLive(records, dryRun);
  if (missing.length > 0) manual.push(`Add at Cloudflare (DNS only): ${missing.map((record) => record.why).join(", ")}; then rerun to check.`);
}

// ───────────────────────── 6. Checks ─────────────────────────
const checks = accountChecks(awsTarget, {
  domainName,
  alertTopicArn: `arn:aws:sns:${region}:${identity.account}:${names.alertTopicName}`,
});
printSection({ name: "6. Account checks (what only AWS or your inbox can finish)", results: checks });
for (const check of checks) if (check.status !== "ok" && check.fix) manual.push(`${check.title}: ${check.fix.join(" ")}`);

// ───────────────────────── 7. Next steps ─────────────────────────
heading("7. Next steps");
const stackFile = `infra/Pulumi.${stack}.yaml`;
const fileStatus = capture("git", ["status", "--porcelain", "--", stackFile]).stdout.trim();
const steps: string[] = [];
if (!existsSync(path.join(INFRA, `Pulumi.${stack}.yaml`))) {
  steps.push(`(${stackFile} does not exist yet: a real run creates it in step 2.)`);
} else if (fileStatus) {
  steps.push(`Commit ${stackFile} (CD applies the COMMITTED file; secrets in it are encrypted): git add ${stackFile} && git commit -m "infra: add ${stack} stack config"`);
}
steps.push("Push to main. CI runs, then CD: publish pushes the 3 images, deploy waits for you.");
// The switches as committed decide what the deploy does (cd.yml step 31).
const switchesOn = config["minitickets:computeEnabled"]?.value === "true";
steps.push(
  `Actions -> CD -> the run -> "Review deployments" -> environment ${environment} -> Approve. ` +
    (switchesOn
      ? "computeEnabled is true, so it runs the normal two-phase deploy (migration, then the new version)."
      : "With all switches off it creates the always-on parts (network, queues, certificate, SES, alarms)."),
);
if (!switchesOn) {
  steps.push("Rerun this command: the DNS records (5) and checks (6) exist from then on.");
  steps.push(`To go live: set dataEnabled, computeEnabled, entryEnabled true in ${stackFile}, commit, push, approve.`);
}
const appRecord = outputs.appDnsRecord as { name: string; value: string } | null | undefined;
const appZone = domainName ? findZone(domainName) : undefined;
steps.push(
  appRecord
    ? `CNAME at Cloudflare: Name ${appZone ? nameInZone(appRecord.name, appZone) : appRecord.name}, Target ${appRecord.value}, DNS only. The ALB's name changes whenever it is re-created: check it on every deploy day.`
    : `After entry is on: CNAME ${domainName ?? "<domain>"} -> the new ALB (pulumi stack output appDnsRecord, or the deploy summary), DNS only.`,
);
steps.forEach((step, i) => info(`${i + 1}. ${step}`));

// ───────────────────────── Summary ─────────────────────────
heading("Summary");
if (awsNothingToCreate) ok("AWS: nothing to create.");
if (changes.length === 0) ok("Nothing changed: everything was already in place.");
else {
  info(dryRun ? "A real run would:" : "This run:");
  for (const change of changes) info(`  - ${change}`);
}
if (manual.length > 0) {
  info("Left for you by hand:");
  for (const item of manual) info(`  - ${item}`);
}
if (dryRun) info("Dry run: nothing was changed.");
