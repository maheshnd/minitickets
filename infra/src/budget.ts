import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// The budget layer: an email warning when AWS spending gets high.
// See docs/13-infra-security-groups.md (last section) for the explanation.

const prefix = "minitickets-dev";

// 1. Read the email address from Pulumi config. require() stops with a clear error if it is
//    missing, so we never create a budget that emails nobody.
//    Set it with: pulumi config set alertEmail you@example.com
const config = new pulumi.Config();
const alertEmail = config.require("alertEmail");

// 2. Helper that builds one notification block, so the 4 alerts are not copy-pasted.
function notification(threshold: number, type: "ACTUAL" | "FORECASTED") {
  return {
    comparisonOperator: "GREATER_THAN",
    threshold,
    thresholdType: "PERCENTAGE", // percent of the $20 limit, not dollars
    notificationType: type,
    subscriberEmailAddresses: [alertEmail],
  };
}

// 3. Monthly cost budget
// WHAT: a $20 per month limit that emails us as spending approaches or passes it.
// WHY: cloud bills can grow quietly. This is our smoke alarm. It only warns, it never
//      stops anything.
// DEPENDS ON: nothing (the budget watches the whole AWS account, not one resource).
// ACTUAL alerts: 25%, 50%, 100% of what we have really spent so far.
// FORECASTED alert: AWS predicts the month-end total and warns if it will pass 100%.
// includeCredit false: credits are NOT counted as a discount. The budget tracks real
//   usage even while credits pay the bill, so we see what the project would cost once the
//   credits run out.
export const budget = new aws.budgets.Budget(`${prefix}-monthly-budget`, {
  name: `${prefix}-monthly-cost`,
  budgetType: "COST",
  limitAmount: "20",
  limitUnit: "USD",
  timeUnit: "MONTHLY",
  costTypes: {
    includeCredit: false,
  },
  notifications: [
    notification(25, "ACTUAL"),
    notification(50, "ACTUAL"),
    notification(100, "ACTUAL"),
    notification(100, "FORECASTED"),
  ],
  tags: { Project: "minitickets", Env: "dev", ManagedBy: "pulumi" },
});
