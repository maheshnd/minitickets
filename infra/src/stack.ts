// The names of THIS stack (names.ts), for the Pulumi program. Every layer imports `prefix` (or
// `names`) from here instead of writing "minitickets-dev" itself.
// pulumi.getStack() is the stack `pulumi up` / `pulumi preview` runs on (`--stack dev` -> "dev").
import * as pulumi from "@pulumi/pulumi";
import { isValidStackName, namesFor } from "./names";

// 1. Stop at once on a stack name AWS would refuse somewhere deep inside (names.ts step 2 says why).
const stackName = pulumi.getStack();
if (!isValidStackName(stackName)) {
  throw new pulumi.RunError(
    `Stack name "${stackName}" cannot be used: 2-20 lowercase letters, digits or single hyphens, starting ` +
      "with a letter (it becomes part of AWS names such as the load balancer's, max 32 characters).",
  );
}

// 2. All names of this stack, e.g. names.imageTagParameter = "/minitickets/dev/image-tag".
export const names = namesFor(stackName);

// 3. The one most files need: the start of every resource name, e.g. "minitickets-dev".
export const prefix = names.prefix;
