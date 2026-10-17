import { parseArgs } from "node:util";
import { isValidStackName } from "../../infra/src/names.ts";

// The command line of `pnpm infra:bootstrap`. Pure (no AWS, no prompts), so it is unit-tested.

export type BootstrapArgs = {
  stack: string;
  profile: string;
  // Empty = take it from the stack's config, else from the AWS profile (infra-bootstrap.ts step 1).
  region?: string;
  dryRun: boolean;
};

export const USAGE =
  "Usage: pnpm infra:bootstrap --stack <name> --profile <aws profile> [--region <aws region>] [--dry-run]";

// 1. Read the options. Unknown options or missing --stack / --profile give an error text (with the
//    usage line), never a half-filled object.
export function parseBootstrapArgs(argv: string[]): BootstrapArgs | { error: string } {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        stack: { type: "string" },
        profile: { type: "string" },
        region: { type: "string" },
        "dry-run": { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    return { error: `${(error as Error).message}\n${USAGE}` };
  }

  // 2. Both names are required: there is no "default" stack or account on purpose. Guessing the
  //    wrong one here could change the wrong AWS account.
  if (!values.stack || !values.profile) return { error: `--stack and --profile are required.\n${USAGE}` };

  // 3. The stack name ends up inside AWS names (infra/src/names.ts step 2): check it before anything runs.
  if (!isValidStackName(values.stack)) {
    return {
      error: `Stack name "${values.stack}" cannot be used: 2-20 lowercase letters, digits or single hyphens, starting with a letter.`,
    };
  }

  // 4. A region looks like "us-east-1" / "eu-west-2" / "ap-southeast-1".
  if (values.region !== undefined && !/^[a-z]{2}(-[a-z]+)+-\d$/.test(values.region)) {
    return { error: `"${values.region}" does not look like an AWS region (e.g. us-east-1).` };
  }

  return { stack: values.stack, profile: values.profile, region: values.region, dryRun: values["dry-run"] };
}
