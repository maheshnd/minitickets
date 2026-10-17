import { capture, json, type Result } from "./shell.ts";

// Every AWS call the bootstrap makes. ALL of them only READ (get / list / describe): the only things
// that change AWS are `pulumi up` and `pulumi import` (pulumi.ts), after a confirmation.

export type AwsTarget = { profile: string; region: string };

function aws(target: AwsTarget, args: string[]): Result {
  return capture("aws", [...args, "--profile", target.profile, "--region", target.region, "--output", "json"]);
}

// 1. Who am I? The account id and the identity of the profile. Fails if the login expired.
export function callerIdentity(profile: string): { account: string; arn: string } | { error: string } {
  const result = capture("aws", ["sts", "get-caller-identity", "--profile", profile, "--output", "json"]);
  const identity = json<{ Account: string; Arn: string }>(result);
  if (!identity) return { error: (result.stderr || result.stdout).trim() };
  return { account: identity.Account, arn: identity.Arn };
}

// 2. The region written in the profile (~/.aws/config), if any.
export function profileRegion(profile: string): string | undefined {
  const result = capture("aws", ["configure", "get", "region", "--profile", profile]);
  return result.ok ? result.stdout.trim() || undefined : undefined;
}

// 3. Which MiniTickets stacks already have resources in this account, found three ways (so one
//    missing permission or region does not hide them):
//    - IAM roles minitickets-<stack>-gh-deploy (IAM is global: found from any region)
//    - ECR repositories minitickets-<stack>-api|web|worker (in this region)
//    - any resource tagged Project=minitickets: its Env tag is the stack (in this region)
export function miniTicketsStacks(target: AwsTarget): Set<string> {
  const stacks = new Set<string>();
  const roles = json<string[]>(
    aws(target, ["iam", "list-roles", "--query", "Roles[?starts_with(RoleName, 'minitickets-')].RoleName"]),
  );
  for (const role of roles ?? []) {
    const match = /^minitickets-(.+)-gh-deploy$/.exec(role);
    if (match) stacks.add(match[1]);
  }
  const repos = json<string[]>(
    aws(target, ["ecr", "describe-repositories", "--query", "repositories[?starts_with(repositoryName, 'minitickets-')].repositoryName"]),
  );
  for (const repo of repos ?? []) {
    const match = /^minitickets-(.+)-(api|web|worker)$/.exec(repo);
    if (match) stacks.add(match[1]);
  }
  const envTags = json<string[]>(
    aws(target, [
      "resourcegroupstaggingapi", "get-resources", "--tag-filters", "Key=Project,Values=minitickets",
      "--query", "ResourceTagMappingList[].Tags[?Key=='Env'].Value[]",
    ]),
  );
  for (const env of envTags ?? []) stacks.add(env);
  return stacks;
}

// 4. The account's GitHub OIDC provider, if there is one (an account may hold only ONE per URL).
export function githubOidcProviderArn(target: AwsTarget): string | undefined {
  const arns = json<string[]>(aws(target, ["iam", "list-open-id-connect-providers", "--query", "OpenIDConnectProviderList[].Arn"]));
  return arns?.find((arn) => arn.endsWith(":oidc-provider/token.actions.githubusercontent.com"));
}

// 5. The certificate's status: ISSUED, PENDING_VALIDATION, FAILED, ...
export function certificateStatus(target: AwsTarget, arn: string): string | undefined {
  const status = json<string>(aws(target, ["acm", "describe-certificate", "--certificate-arn", arn, "--query", "Certificate.Status"]));
  return status ?? undefined;
}

// 6. SES: the account (sandbox or not) and every identity with its status. Email-address identities
//    are personal data: the caller prints only THAT one exists and its status, never the address.
export type SesIdentity = { name: string; type: string; verified: boolean };
export function sesAccount(target: AwsTarget): { production: boolean; sendingEnabled: boolean } | undefined {
  const account = json<{ ProductionAccessEnabled?: boolean; SendingEnabled?: boolean }>(aws(target, ["sesv2", "get-account"]));
  return account ? { production: account.ProductionAccessEnabled === true, sendingEnabled: account.SendingEnabled !== false } : undefined;
}
export function sesIdentities(target: AwsTarget): SesIdentity[] | undefined {
  const list = json<{ EmailIdentities?: { IdentityName: string; IdentityType: string; VerificationStatus?: string; SendingEnabled?: boolean }[] }>(
    aws(target, ["sesv2", "list-email-identities"]),
  );
  return list?.EmailIdentities?.map((identity) => ({
    name: identity.IdentityName,
    type: identity.IdentityType,
    verified: identity.VerificationStatus === "SUCCESS",
  }));
}
export function sesDkimStatus(target: AwsTarget, domain: string): string | undefined {
  return json<string>(aws(target, ["sesv2", "get-email-identity", "--email-identity", domain, "--query", "DkimAttributes.Status"])) ?? undefined;
}

// 7. The alert topic's subscriptions. "PendingConfirmation" = the email link was not clicked yet.
//    undefined = the topic does not exist yet (the first CD deploy creates it).
export function topicSubscriptions(target: AwsTarget, topicArn: string): string[] | undefined {
  return json<string[]>(
    aws(target, ["sns", "list-subscriptions-by-topic", "--topic-arn", topicArn, "--query", "Subscriptions[].SubscriptionArn"]),
  );
}

// 8. Lambda: the account's concurrency limit (new accounts often get 10, the usual default is 1000).
export function lambdaConcurrencyLimit(target: AwsTarget): number | undefined {
  return json<number>(aws(target, ["lambda", "get-account-settings", "--query", "AccountLimit.ConcurrentExecutions"]));
}

// 9. CloudFront: how many distributions exist. There is NO read-only way to ask "may this account
//    create one?" (new accounts are sometimes blocked until AWS verifies them). Any existing
//    distribution proves it may; zero proves nothing.
export function cloudfrontDistributionCount(target: AwsTarget): number | undefined {
  return json<number>(aws(target, ["cloudfront", "list-distributions", "--query", "length(DistributionList.Items || `[]`)"]));
}
