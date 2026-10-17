import {
  cloudfrontDistributionCount,
  lambdaConcurrencyLimit,
  sesAccount,
  sesDkimStatus,
  sesIdentities,
  topicSubscriptions,
  type AwsTarget,
} from "./aws.ts";
import type { CheckResult } from "../stack/results.ts";

// Step 6 of the bootstrap: things only AWS (or your inbox) can finish, checked READ-ONLY.
// Each check says exactly what to click when something is missing. Same ✓ / ! / ✗ format as
// `pnpm stack:check` (scripts/stack/results.ts).

// The worker triggers' maximumConcurrency (infra/src/jobs/queue-trigger.ts: 5, tickets/lambda.ts: 2).
const LAMBDA_IN_PARALLEL = 5 + 2;

export function accountChecks(target: AwsTarget, inputs: { domainName?: string; alertTopicArn: string }): CheckResult[] {
  const results: CheckResult[] = [];

  // 1. SES: the domain (DKIM records live?), your test address (link clicked?), and the sandbox.
  //    Email addresses are personal data: never printed, only "your test address".
  const identities = sesIdentities(target);
  if (identities === undefined) {
    results.push({ status: "warn", title: "SES: could not read the email identities (permission or region?)" });
  } else {
    const domain = inputs.domainName ? identities.find((identity) => identity.name === inputs.domainName) : undefined;
    if (!inputs.domainName) {
      results.push({ status: "warn", title: "SES: no domainName in the stack config, so no sender identity" });
    } else if (!domain) {
      results.push({ status: "warn", title: `SES: identity ${inputs.domainName} not created yet`, detail: ["The first CD deploy creates it. Rerun the bootstrap afterwards."] });
    } else {
      const dkim = sesDkimStatus(target, inputs.domainName);
      results.push(
        domain.verified
          ? { status: "ok", title: `SES: ${inputs.domainName} verified (DKIM ${dkim ?? "?"})` }
          : {
              status: "warn",
              title: `SES: ${inputs.domainName} not verified yet (DKIM ${dkim ?? "?"})`,
              fix: ["Add the 3 DKIM records of step 5. SES checks them by itself (minutes, at most 72 h)."],
            },
      );
    }
    const addresses = identities.filter((identity) => identity.type === "EMAIL_ADDRESS");
    if (addresses.length === 0) {
      results.push({ status: "warn", title: "SES: your test address is not an identity yet", detail: ["The first CD deploy creates it (sesTestRecipient)."] });
    }
    for (const address of addresses) {
      results.push(
        address.verified
          ? { status: "ok", title: "SES: your test address is verified" }
          : {
              status: "warn",
              title: "SES: your test address is NOT verified yet",
              fix: ['Open the email "Amazon Web Services - Email Address Verification Request" and click its link (once).'],
            },
      );
    }
  }
  const account = sesAccount(target);
  if (account && !account.production) {
    results.push({
      status: "warn",
      title: "SES: the account is in the SANDBOX (it may send only to verified addresses)",
      detail: ["Fine for testing with your own address. For real visitors' emails:"],
      fix: ["SES console -> Account dashboard -> Request production access (AWS answers within about a day)."],
    });
  } else if (account) {
    results.push({ status: "ok", title: "SES: production access (may send to any address)" });
  }

  // 2. SNS: the alarm emails arrive only after you confirmed the subscription once.
  const subscriptions = topicSubscriptions(target, inputs.alertTopicArn);
  if (subscriptions === undefined) {
    results.push({ status: "warn", title: "Alerts: topic not created yet", detail: ["The first CD deploy creates it. Rerun the bootstrap afterwards."] });
  } else if (subscriptions.length === 0) {
    results.push({ status: "warn", title: "Alerts: the topic has no email subscription", fix: ["Check alertEmail in the stack config, then deploy again."] });
  } else if (subscriptions.some((arn) => arn === "PendingConfirmation")) {
    results.push({
      status: "warn",
      title: "Alerts: email subscription waits for your confirmation",
      fix: ['Open the email "AWS Notification - Subscription Confirmation" sent to your alert address and click "Confirm subscription".'],
    });
  } else {
    results.push({ status: "ok", title: "Alerts: email subscription confirmed" });
  }

  // 3. Lambda: the account's concurrency limit. AWS keeps 10 always free, so with a limit of 10 no
  //    function may RESERVE any (workerReservedConcurrency must stay unset, index.ts 20b).
  const limit = lambdaConcurrencyLimit(target);
  if (limit === undefined) {
    results.push({ status: "warn", title: "Lambda: could not read the concurrency limit" });
  } else if (limit < 1000) {
    results.push({
      status: limit < LAMBDA_IN_PARALLEL ? "fail" : "warn",
      title: `Lambda: concurrency limit ${limit} (new accounts often get 10; the usual default is 1000)`,
      detail: [
        `The two queue triggers run at most ${LAMBDA_IN_PARALLEL} copies at once, so ${limit} ${limit < LAMBDA_IN_PARALLEL ? "is NOT enough" : "is enough"}.`,
        "AWS keeps part of the limit unreserved (10 when the limit is 10), so keep workerReservedConcurrency unset.",
      ],
      fix: ["Service Quotas -> AWS services -> AWS Lambda -> Concurrent executions -> Request increase at account level -> 1000."],
    });
  } else {
    results.push({ status: "ok", title: `Lambda: concurrency limit ${limit}` });
  }

  // 4. CloudFront: needed only with cdnEnabled true. New accounts may be refused until AWS verifies
  //    them, and there is no read-only way to ask. An existing distribution proves it works.
  const distributions = cloudfrontDistributionCount(target);
  if (distributions !== undefined && distributions > 0) {
    results.push({ status: "ok", title: `CloudFront: this account already has ${distributions} distribution(s), so it may create them` });
  } else {
    results.push({
      status: "warn",
      title: "CloudFront: unknown whether this account may create distributions (cannot be checked without creating one)",
      detail: [
        "Only matters with cdnEnabled true (the bootstrap sets false: the ALB serves HTTPS itself).",
        'If a deploy with cdnEnabled true fails with "Your account must be verified before you can add new CloudFront resources":',
      ],
      fix: ["AWS Support Center -> Create case -> Account and billing -> ask AWS to verify the account for CloudFront (not sure of the exact category name; any account case reaches them)."],
    });
  }
  return results;
}
