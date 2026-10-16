// The explorer teaches service boundaries. Check its prose without calling AWS or trusting its metadata.

// 1. This independent registry fixes who owns each piece; changing a piece's `service` cannot bless a bad command.
const OWNERS: Record<string, string[]> = {
  docker: ["laptop-web", "laptop-api", "laptop-migrate", "laptop-postgres", "laptop-redis"],
  sts: ["account"],
  ec2: ["region", "az-a", "az-b", "internet", "vpc", "igw", "public-1", "public-2", "private-1", "private-2", "public-rt", "private-rt", "main-rt", "nacl", "alb-sg", "web-sg", "api-sg", "eni", "db-sg", "redis-sg"],
  resourcegroupstaggingapi: ["tags"],
  pulumi: ["pulumi"],
  budgets: ["budget"],
  browser: ["visitors"],
  github: ["github"],
  iam: ["iam"],
  cloudfront: ["cloudfront"],
  elbv2: ["alb", "web-tg", "api-tg"],
  ecs: ["web-task", "api-task", "ecs", "migration-task"],
  rds: ["rds"],
  elasticache: ["valkey"],
  ecr: ["ecr"],
  secretsmanager: ["secrets", "signing-secret"],
  logs: ["logs"],
  servicediscovery: ["namespace"],
  acm: ["cert"],
  ssm: ["ssm"],
  sns: ["sns-bookings", "alert-topic"],
  sqs: ["email-queue", "email-dlq", "tickets-queue", "tickets-dlq"],
  lambda: ["email-lambda", "ticket-lambda"],
  dynamodb: ["jobs-table", "tickets-table"],
  sesv2: ["ses"],
  s3api: ["s3-assets", "asset-cors"],
  cloudwatch: ["alarms", "dashboard"],
  scheduler: ["reminder-scheduler"],
  apigateway: ["checkin-api"],
  "application-autoscaling": ["ecs-autoscaling"],
};

// 2. Match the service at the START of the Console path, so appending a correct service cannot hide a wrong one.
const CONSOLES: Record<string, RegExp> = {
  docker: /^Docker Desktop\b/i,
  sts: /^AWS account\b/i,
  ec2: /^(?:VPC|EC2|AWS console)\b/i,
  resourcegroupstaggingapi: /^Resource Groups(?: &| and)? Tag Editor\b/i,
  pulumi: /^Pulumi\b/i,
  budgets: /^Billing and Cost Management\b/i,
  browser: /^Browser\b/i,
  github: /^GitHub\b/i,
  iam: /^IAM\b/i,
  cloudfront: /^CloudFront\b/i,
  elbv2: /^(?:EC2|Elastic Load Balancing)\b/i,
  ecs: /^ECS\b/i,
  rds: /^RDS\b/i,
  elasticache: /^ElastiCache\b/i,
  ecr: /^(?:Amazon )?ECR\b/i,
  secretsmanager: /^Secrets Manager\b/i,
  logs: /^CloudWatch(?: Logs\b|\s*→\s*(?:Logs|Log groups)\b)/i,
  servicediscovery: /^(?:AWS )?Cloud Map\b/i,
  acm: /^(?:ACM|Certificate Manager)\b/i,
  ssm: /^(?:Systems Manager|SSM)\b/i,
  sns: /^(?:Amazon )?SNS\b/i,
  sqs: /^(?:Amazon )?SQS\b/i,
  lambda: /^(?:AWS )?Lambda\b/i,
  dynamodb: /^DynamoDB\b/i,
  sesv2: /^(?:Amazon )?SES\b/i,
  s3api: /^(?:Amazon )?S3\b/i,
  cloudwatch: /^CloudWatch\s*→\s*(?:Alarms|Dashboards)\b/i,
  scheduler: /^EventBridge Scheduler\b/i,
  apigateway: /^API Gateway\b/i,
  "application-autoscaling": /^(?:Application Auto Scaling|ECS\s*→[^;\n]*Auto scaling)\b/i,
};

const TEXT_FIELDS = ["id", "name", "type", "city", "service", "what", "why", "console", "cli", "debug", "interview"];
const FILLER = [
  /built in code\b/i,
  /live AWS acceptance is separate\b/i,
  /implemented boundary\b/i,
  /committed stack switches and CD determine deployment\b/i,
  /verify live through CD acceptance\b/i,
  /see (?:the )?(?:card|code|source) (?:and |for )?(?:live acceptance|details)\b/i,
  /^(?:TODO|TBD|N\/A|not applicable)[.!]?$/i,
];
const GLOBAL_FLAGS = new Set(["--debug", "--no-verify-ssl", "--no-paginate", "--no-sign-request", "--no-cli-pager", "--cli-auto-prompt", "--no-cli-auto-prompt"]);
const GLOBAL_VALUES = new Set(["--profile", "--region", "--output", "--query", "--endpoint-url", "--ca-bundle", "--cli-read-timeout", "--cli-connect-timeout", "--color", "--cli-binary-format"]);
const RESOURCE_TARGETS: Record<string, string> = {
  "email-lambda": "minitickets-dev-worker",
  "ticket-lambda": "minitickets-dev-tickets",
  "jobs-table": "minitickets-dev-processed-jobs",
  "tickets-table": "minitickets-dev-tickets",
  "email-queue": "minitickets-dev-jobs",
  "email-dlq": "minitickets-dev-jobs-dlq",
  "tickets-queue": "minitickets-dev-tickets",
  "tickets-dlq": "minitickets-dev-tickets-dlq",
};

// 3. Tokenize only to inspect commands: quotes protect query strings, and every AWS invocation is checked.
//    No command is executed. Global AWS options before the service are handled too.
function cliServices(cli: string): string[] {
  const tokens = cli.match(/"(?:\\.|[^"\\])*"|'[^']*'|&&|\|\||[;|()\n]|[^\s;&|()]+/g) ?? [];
  const services: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] !== "aws") continue;
    let start = index - 1;
    while (start >= 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[start])) start--;
    if (start >= 0 && ![";", "\n", "&&", "||", "|", "("].includes(tokens[start])) continue;
    let next = index + 1;
    while (tokens[next]?.startsWith("--")) {
      const option = tokens[next].split("=")[0];
      if (GLOBAL_FLAGS.has(option)) next++;
      else if (GLOBAL_VALUES.has(option)) next += tokens[next].includes("=") ? 1 : 2;
      else break;
    }
    services.push(tokens[next] ?? "(missing service)");
  }
  return services;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 4. Require all teaching fields, including each setting and code-reference field, and reject stock filler anywhere in them.
export function checkExplorerContent(components: unknown): string[] {
  const problems: string[] = [];
  if (!Array.isArray(components) || components.length === 0) return ["components must be a nonempty array"];
  const seen = { what: new Map<string, string>(), why: new Map<string, string>() };

  for (const [index, raw] of components.entries()) {
    if (!isRecord(raw)) {
      problems.push(`component ${index}: must be an object`);
      continue;
    }
    const id = typeof raw.id === "string" ? raw.id : `#${index}`;
    function inspect(value: unknown, field: string): void {
      if (typeof value === "string") {
        if (!value.trim()) problems.push(`component "${id}": ${field} must not be empty`);
        for (const phrase of FILLER) {
          if (phrase.test(value.trim())) problems.push(`component "${id}": ${field} contains banned filler (${phrase.source})`);
        }
      } else if (Array.isArray(value) && value.length > 0) {
        value.forEach((entry, i) => inspect(entry, `${field}[${i}]`));
      } else if (isRecord(value) && Object.keys(value).length > 0) {
        for (const [key, entry] of Object.entries(value)) inspect(entry, `${field}.${key}`);
      } else problems.push(`component "${id}": ${field} must not be empty or missing`);
    }
    for (const field of TEXT_FIELDS) {
      inspect(raw[field], field);
      if (raw[field] !== undefined && typeof raw[field] !== "string") problems.push(`component "${id}": ${field} must be text`);
    }
    for (const field of ["settings", "code"]) {
      inspect(raw[field], field);
      if (!Array.isArray(raw[field])) problems.push(`component "${id}": ${field} must be an array`);
    }
    if (Array.isArray(raw.settings) && raw.settings.some(setting => typeof setting !== "string")) problems.push(`component "${id}": settings must contain text`);
    if (Array.isArray(raw.code)) {
      raw.code.forEach((ref, i) => {
        if (!isRecord(ref)) problems.push(`component "${id}": code[${i}] must be a code reference`);
        else for (const field of ["file", "symbol"]) {
          if (typeof ref[field] !== "string" || !ref[field].trim()) problems.push(`component "${id}": code[${i}].${field} must not be empty or missing`);
        }
      });
    }

    // 5. Punctuation, capitalization and extra spaces cannot disguise reused explanations.
    for (const field of ["what", "why"] as const) {
      if (typeof raw[field] !== "string" || !raw[field].trim()) continue;
      const text = raw[field].toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const previous = seen[field].get(text);
      if (previous) problems.push(`component "${id}": ${field} duplicates component "${previous}"`);
      else seen[field].set(text, id);
    }

    const owner = Object.entries(OWNERS).find(([, ids]) => ids.includes(id))?.[0];
    if (!owner) {
      problems.push(`component "${id}": add its service ownership to scripts/explorer-content.ts`);
      continue;
    }
    if (raw.service !== owner) problems.push(`component "${id}": service must be ${owner}, not ${String(raw.service)}`);
    if (typeof raw.console === "string" && !CONSOLES[owner].test(raw.console)) problems.push(`component "${id}": console path belongs to another service; expected ${owner}`);
    if (typeof raw.console === "string") {
      for (const nextPath of raw.console.split(/[;\n]/).slice(1)) {
        if (Object.values(CONSOLES).some(prefix => prefix.test(nextPath.trim())) && !CONSOLES[owner].test(nextPath.trim())) problems.push(`component "${id}": appended console path belongs to another service; expected ${owner}`);
      }
    }
    const resource = RESOURCE_TARGETS[id];
    if (resource) {
      // A word boundary alone would accept the jobs DLQ as the jobs queue; require the complete resource name.
      const target = new RegExp(`(?<![\\w-])${resource}(?![\\w-])`);
      for (const field of ["console", "cli"]) {
        if (typeof raw[field] === "string" && !target.test(raw[field])) problems.push(`component "${id}": ${field} must target its own resource ${resource}`);
      }
    }
    if (typeof raw.cli !== "string") continue;
    const services = cliServices(raw.cli);
    for (const service of services) {
      if (service !== owner) problems.push(`component "${id}": CLI service ${service} belongs to another component; expected ${owner}`);
    }
    if (services.length === 0) {
      const tools: Record<string, RegExp> = { docker: /^docker\s+compose\b/, pulumi: /^(?:cd infra\s*&&\s*)?pulumi\b/, github: /^gh\b/, browser: /^(?:curl|open)\b/ };
      if (!tools[owner]?.test(raw.cli.trim())) problems.push(`component "${id}": CLI must inspect its ${owner} service`);
    }
  }
  return problems;
}
