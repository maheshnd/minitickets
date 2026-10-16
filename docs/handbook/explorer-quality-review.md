# Explorer quality review — part 1

History: see [CHANGELOG.md](CHANGELOG.md) or run `pnpm docs:history`

This pass audits all 67 components and keeps the managed-service districts inside the same city map. Review the ten complete component ledgers below, then open [the explorer](guides/infra-explorer.html).

## Changes and evidence

- Before the pass, 34 components belonged to repeated what/why groups; 41 contained generic deployment filler. All 67 now have distinct what/why explanations and complete service-specific fields.
- Updated 205 single-component tour stops so their explanations, source references, Console paths and CLI inspections use the corrected component content.
- Corrected CloudWatch Logs, ticket Lambda, processed-jobs table, signing-secret and CORS source references. Included all three ECR repositories and all four log groups.
- Removed ten historical network resource IDs and fixed AZ names: code selects the first two available zones rather than promising fixed AZ names/IDs. Account-dependent values use source formulas and discovery commands.
- The alarm map follows the actual four alarm specifications: email DLQ, email queue age, worker invocation errors and ALB 5xx. The ticket DLQ has no alarm in this implementation.
- All 67 nodes share one SVG. Messaging, Functions, Serverless data, Email, Watchtower and Delivery sit outside the VPC wall, inside the region. The JSON catalogue owns both content and geometry; there is no separate serverless grid.
- Fit uses built chapter bounds, highlights newly built pieces and preserves a 12px label floor. Smaller screens may scroll to retain readable labels. Planned pieces stay faint and can be inspected with an explicit proposed status.

## Verification

- `pnpm docs:check`: passed; 151 cards, 141 anchor slugs, 331 anchor places, including the new content checks and matching embedded/catalogue data.
- `pnpm exec vitest run scripts/explorer-content.test.ts`: 43 passed. Mutations cover empty fields/settings/references, repeated prose, filler, wrong services and copied same-service resource targets.
- `pnpm exec tsc -p scripts`: passed.
- `pnpm exec eslint scripts/check-concepts.ts scripts/explorer-content.ts scripts/explorer-content.test.ts`: passed.
- `git diff --check`: passed.
- Headless Chromium loaded the standalone file offline at 1600×1200. Captured full-page and map-only Fit screenshots for every requested chapter/theme; visually reviewed all twelve map captures. Browser errors: 0. Visible built and planned text overlaps: 0.
- At 1280×900, the last chapter retained a minimum label size of 12.01px; the code grid stayed hidden. Actual clicks on email Lambda and proposed reminder centered each with zero world-coordinate error at 2.2×. Escape worked; returning to chapter 1 restored Fit with no dimmed built pieces.
- Screenshot gallery and measurements are local verification artifacts at `/tmp/minitickets-explorer-quality/` (`screenshots.html`, `measurements.json`, `interaction-checks.json`); they are not committed source.
- No AWS CLI examples were executed. Live AWS configuration/delivery, application e2e tests and other browsers were not checked; application and infrastructure code did not change.

| Chapter | Light: smallest visible label | Dark: smallest visible label | Text overlaps (both themes) |
| --- | --- | --- | --- |
| 1 | 25.34px | 25.34px | 0 / 0 |
| 2 | 14.82px | 14.82px | 0 / 0 |
| 8 | 12.15px | 12.15px | 0 / 0 |
| 14 | 12.15px | 12.15px | 0 / 0 |
| 20 | 12.15px | 12.15px | 0 / 0 |
| 24 | 12.15px | 12.15px | 0 / 0 |

## Ten randomly sampled components

Selection is reproducible: Python `random.Random(20261016).sample(components, 10)`, using catalogue order. These are the complete teaching fields, copied from the audited JSON. Proposed components are included if sampled.

### 1. minitickets-dev-private-1 (`private-1`)

Chapter 2 · service `ec2` · built when its chapter is reached

**What it is:** minitickets-dev-private-1 is the 10.0.10.0/24 subnet in the first available zone, associated with the private route table.

**Why we need it:** The first private subnet contributes an isolated placement option to the RDS and Valkey subnet groups.

**Key settings:**

- CIDR 10.0.10.0/24
- availabilityZone=azNames[0]
- mapPublicIpOnLaunch=false
- Explicit route-table association: minitickets-dev-private-rt

**Code:**

- `infra/src/network.ts` → `privateCidrs`
- `infra/src/network.ts` → `privateSubnets`

**Console path:** VPC → Subnets → minitickets-dev-private-1 → Details and Route table

**CLI:**

```bash
aws ec2 describe-subnets --filters Name=tag:Name,Values=minitickets-dev-private-1 --query "Subnets[].{Cidr:CidrBlock,Zone:AvailabilityZone,AutoPublicIp:MapPublicIpOnLaunch}"
```

**Debug tip:** For private-1, verify there is only a local route and no public IP. Database access still also requires the correct security group and credentials.

**Interview line:** private-1 has local VPC reachability without internet routing. Private placement and database authentication protect different boundaries.

### 2. ECS target tracking · not built (`ecs-autoscaling`)

Chapter 22 · service `application-autoscaling` · explain-only

**What it is:** ECS target tracking is an explain-only capacity design; current API and web services both keep desiredCount=1.

**Why we need it:** Adding replicas could handle more application requests, but requires bounded cost and datastore capacity before a sale-day traffic spike.

**Key settings:**

- No scalable target or scaling policy exists
- A proposed policy would set explicit minimum/maximum task counts and cooldowns
- Possible signals CPU or ALB requests per target need measurement
- Built sale-day controls are shared rate limits and advisory inventory; Postgres remains seat authority

**Code:**

- `docs/handbook/guides/interview-scenarios.md` → `Question: P8: how would ECS autoscaling help`

**Console path:** ECS → Clusters → minitickets-dev → Services → minitickets-dev-api → Auto scaling (no policy is defined)

**CLI:**

```bash
aws application-autoscaling describe-scalable-targets --service-namespace ecs
```

**Debug tip:** More API tasks multiply database pools and lock contention. Measure latency, DB connections and demand before choosing targets or limits.

**Interview line:** Autoscaling changes compute capacity, not seat inventory. The current implementation deliberately separates load shedding from authoritative Postgres booking.

### 3. minitickets-dev-worker (`email-lambda`)

Chapter 15 · service `lambda` · built

**What it is:** The minitickets-dev-worker Lambda consumes email jobs, skips recorded completions, sends through SES and records successful job keys in DynamoDB.

**Why we need it:** Confirmation emails should run outside the booking transaction so a slow or failed mail provider does not roll back a valid booking.

**Key settings:**

- Container image from minitickets-dev-worker ECR; arm64
- Memory 256 MB; timeout 10 s; no VPC attachment
- Event source: minitickets-dev-jobs; batch 10; maximumConcurrency=5
- ReportBatchItemFailures enabled; reserved concurrency defaults to -1
- PROCESSED_JOBS_TABLE and optional MAIL_FROM configured; log group /minitickets/dev/worker

**Code:**

- `infra/src/jobs/worker-lambda.ts` → `createWorkerLambda`
- `infra/src/jobs/queue-trigger.ts` → `createQueueTrigger`
- `apps/worker/src/lambda.ts` → `handler`

**Console path:** Lambda → Functions → minitickets-dev-worker → Configuration and SQS trigger

**CLI:**

```bash
aws lambda get-function-configuration --function-name minitickets-dev-worker --query "{Name:FunctionName,Memory:MemorySize,Timeout:Timeout,Architecture:Architectures,Vpc:VpcConfig,Logging:LoggingConfig}"
```

**Debug tip:** Lambda Errors counts thrown invocation failures, not caught per-message failures returned in batchItemFailures. Inspect the jobs DLQ and worker JSON logs as well.

**Interview line:** This worker is outside the VPC because its message contains all email facts and it calls only AWS APIs. Dedup cannot eliminate send-before-record or simultaneous-worker duplicates.

### 4. minitickets-dev-db-sg (`db-sg`)

Chapter 3 · service `ec2` · built when its chapter is reached

**What it is:** minitickets-dev-db-sg protects the RDS network interfaces with an API-group-only TCP 5432 ingress rule and no outbound rules.

**Why we need it:** Only task ENIs wearing minitickets-dev-api-sg, including the one-off migration task, should connect to the private SQL database.

**Key settings:**

- TCP 5432 only from minitickets-dev-api-sg
- No outbound rules; stateful replies still work
- Attached to RDS through vpcSecurityGroupIds

**Code:**

- `infra/src/security.ts` → `createSecurityGroups`
- `infra/src/data/postgres.ts` → `vpcSecurityGroupIds`

**Console path:** VPC → Security groups → minitickets-dev-db-sg → Inbound rules and Outbound rules

**CLI:**

```bash
aws ec2 describe-security-groups --filters Name=tag:Name,Values=minitickets-dev-db-sg --query "SecurityGroups[].{Id:GroupId,Ingress:IpPermissions,Egress:IpPermissionsEgress}"
```

**Debug tip:** A timeout suggests reachability or firewall trouble; password and TLS errors prove the socket reached Postgres. The migration must wear the API group.

**Interview line:** The database firewall trusts a caller security group rather than an unstable task IP; SQL authentication remains a separate requirement.

### 5. minitickets-dev-alb-sg (`alb-sg`)

Chapter 3 · service `ec2` · built when its chapter is reached

**What it is:** minitickets-dev-alb-sg is the stateful firewall on the load balancer; its inbound rules select either direct browser access or CloudFront-only origin access.

**Why we need it:** ALB ingress must match the selected public-entry mode while allowing replies and forwarding to application targets.

**Key settings:**

- ALB-only mode: TCP 80 and 443 from allowedCidrs, default 0.0.0.0/0
- CloudFront mode instead: TCP 80 from com.amazonaws.global.cloudfront.origin-facing
- All outbound IPv4 traffic allowed

**Code:**

- `infra/src/security.ts` → `createSecurityGroups`
- `infra/src/entry/alb-public-ingress.ts` → `createAlbPublicIngress`

**Console path:** VPC → Security groups → minitickets-dev-alb-sg → Inbound rules and Outbound rules

**CLI:**

```bash
aws ec2 describe-security-groups --filters Name=tag:Name,Values=minitickets-dev-alb-sg --query "SecurityGroups[].{Id:GroupId,Ingress:IpPermissions,Egress:IpPermissionsEgress}"
```

**Debug tip:** A security-group timeout occurs before an ALB listener can redirect or route. Match the entry mode to its active ingress rules.

**Interview line:** The ALB firewall selects allowed sources; listeners separately decide TLS, redirects and path routing.

### 6. minitickets-dev-monthly-cost (`budget`)

Chapter 1 · service `budgets` · built when its chapter is reached

**What it is:** The minitickets-dev-monthly-cost account budget emails warnings against a 20 USD monthly cost limit.

**Why we need it:** A small learning environment needs visible spending alerts even when credits hide the amount the owner actually pays.

**Key settings:**

- Budget type COST; period MONTHLY; limit 20 USD
- Actual alerts at 25%, 50%, 100%; forecast alert at 100%
- includeCredit=false; account-wide, without a project-tag filter
- Notification destination comes from alertEmail config

**Code:**

- `infra/src/budget.ts` → `createBudget`
- `infra/src/budget.ts` → `notification`

**Console path:** Billing and Cost Management → Budgets → minitickets-dev-monthly-cost → Alerts

**CLI:**

```bash
aws budgets describe-budget --account-id "$AWS_ACCOUNT_ID" --budget-name minitickets-dev-monthly-cost
```

**Debug tip:** Set AWS_ACCOUNT_ID to the account ID returned by the account card CLI. This budget only warns; it cannot stop resources or spending. Check subscriber and budget filters when totals differ from project estimates.

**Interview line:** This budget warns on account cost and forecast; it is observability for spend, not a hard spending cap.

### 7. us-east-1 (N. Virginia) (`region`)

Chapter 1 · service `ec2` · built when its chapter is reached

**What it is:** The committed Pulumi stack selects us-east-1 for regional resources such as the VPC, ECS services, queues and databases.

**Why we need it:** Keeping the API and its data in one region avoids accidental lookups and deployments against unrelated regional copies.

**Key settings:**

- aws:region=us-east-1 in infra/Pulumi.dev.yaml
- Console display name US East (N. Virginia)
- IAM and CloudFront are global; subnets belong to one regional AZ

**Code:**

- `infra/Pulumi.dev.yaml` → `aws:region`
- `infra/src/network.ts` → `getAvailabilityZonesOutput`

**Console path:** AWS console → Region selector → US East (N. Virginia) us-east-1

**CLI:**

```bash
aws ec2 describe-regions --region us-east-1 --region-names us-east-1 --query "Regions[].RegionName"
```

**Debug tip:** A resource missing from the console may be in another selected region. Compare the selector and CLI --region with us-east-1.

**Interview line:** Region is geographic scope; an availability zone is an isolated location within it. MiniTickets provisions regional resources in us-east-1.

### 8. minitickets-dev-cert (`cert`)

Chapter 10 · service `acm` · built when its chapter is reached

**What it is:** ACM requests a DNS-validated certificate for minitickets.theversehub.in and the HTTPS listener waits for it to be issued.

**Why we need it:** The current direct-ALB entry mode needs a certificate matching the public application hostname before it can accept TLS.

**Key settings:**

- Domain minitickets.theversehub.in; validation method DNS
- Created whenever domainName is set, independent of entryEnabled
- DNS CNAME must be added at the external provider
- Listener validation wait is capped at 10 minutes

**Code:**

- `infra/src/certificate.ts` → `createCertificate`
- `infra/src/entry/https-listener.ts` → `CertificateValidation`

**Console path:** ACM → Certificates → Domain minitickets.theversehub.in → Status and Domains

**CLI:**

```bash
aws acm list-certificates --query "CertificateSummaryList[?DomainName=='minitickets.theversehub.in'].{Arn:CertificateArn,Domain:DomainName,Status:Status}"
```

**Debug tip:** Pending validation means DNS proof is missing or not visible. Confirm the CNAME is DNS-only at the provider; the certificate does not create the application DNS record.

**Interview line:** ACM proves domain ownership with DNS and supplies the regional ALB certificate. TLS termination is the listener action that actually uses it.

### 9. Reminder scheduler · not built (`reminder-scheduler`)

Chapter 20 · service `scheduler` · explain-only

**What it is:** The reminder scheduler is an explain-only design: a daily EventBridge schedule would invoke a reminder worker that queries ticket dates and publishes reminder jobs.

**Why we need it:** Customers could receive a reminder before an event without adding a constantly running timer process to the API.

**Key settings:**

- No schedule, reminder Lambda or scheduler role exists
- Proposed source infra/src/jobs/reminders.ts; proposed paginated by-event-date reader
- Scheduler trust would be scheduler.amazonaws.com with invoke permission for one function
- Schedule time zone, missed-run rules and reminder retention remain product decisions

**Code:**

- `docs/handbook/guides/interview-scenarios.md` → `Question: P5: where would scheduled reminders go`

**Console path:** EventBridge Scheduler → Schedules → proposed reminder schedule (no MiniTickets resource is defined)

**CLI:**

```bash
aws scheduler list-schedules --name-prefix minitickets
```

**Debug tip:** A proposed daily invocation is not exactly once. The design needs bounded date-index pages and stable ticket/date/type deduplication before implementation.

**Interview line:** The existing ticket date index could support reminders, but the schedule, handler, job contract and permissions remain unbuilt designs.

### 10. minitickets-dev-processed-jobs (`jobs-table`)

Chapter 16 · service `dynamodb` · built

**What it is:** The DynamoDB table minitickets-dev-processed-jobs stores completed email job keys such as booking.confirmed:<bookingId>.

**Why we need it:** The email consumer needs durable memory of successful work across retries, Lambda instances and later queue redrives.

**Key settings:**

- Partition key jobKey, type String; no sort key
- PAY_PER_REQUEST billing
- TTL attribute expiresAt; worker remembers completions for 30 days
- Point-in-time recovery=false; deletion protection=false
- Worker role permits GetItem and conditional PutItem only

**Code:**

- `infra/src/jobs/processed-jobs-table.ts` → `createProcessedJobsTable`
- `apps/worker/src/processed-jobs.ts` → `REMEMBER_DAYS`

**Console path:** DynamoDB → Tables → minitickets-dev-processed-jobs → Overview and Additional settings

**CLI:**

```bash
aws dynamodb describe-table --table-name minitickets-dev-processed-jobs --query "Table.{Name:TableName,Keys:KeySchema,Billing:BillingModeSummary.BillingMode}"
```

**Debug tip:** A completed row suppresses later repeats, but two workers can both pass the pre-send read. TTL deletion is asynchronous and does not make email delivery exactly once.

**Interview line:** This is completion deduplication keyed by job identity, not a transaction with SES. Sending and marking done have a crash window.
