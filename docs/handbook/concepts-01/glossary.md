# Glossary: every term in plain English

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

Keep this open in a second tab. Each entry gives a one-line plain-English meaning, then the precise
meaning you would use in an interview, then where it appears in MiniTickets. Terms are grouped so that
related ideas sit together.

> Honesty labels from the [README](README.md#2-four-honesty-labels-read-this-before-anything-else)
> apply: "built in repository", "configured for deployment", "verified in live AWS", "conceptual".

---

## A. Cloud fundamentals

**AWS (Amazon Web Services)** — *Plain:* someone else's computers that you rent by the second.
*Precise:* a cloud provider offering on-demand compute, storage, networking and managed services
across geographic regions, billed on a pay-as-you-go model.

**Cloud / cloud computing** — *Plain:* using computers you do not own, over the internet.
*Precise:* on-demand delivery of compute, storage and services over a network with elastic capacity
and usage-based billing.

**Account** — *Plain:* your private, isolated space in AWS. *Precise:* the top-level container that
owns resources; every resource has an Amazon Resource Name identifying its account. MiniTickets uses a
dev account; example ids in this handbook are the placeholder `123456789012`.

**Region** — *Plain:* a group of data centres in one part of the world (e.g. `us-east-1`).
*Precise:* a geographic cluster of Availability Zones, isolated from other regions. MiniTickets'
committed config uses `us-east-1`.

**Availability Zone (AZ)** — *Plain:* one separate data centre inside a region. *Precise:* one or more
discrete data centres with independent power and cooling, connected to other AZs by low-latency links.
MiniTickets spreads its subnets across two AZs so one data-centre failure is survivable.

**Multi-AZ** — *Plain:* running in more than one data centre so a failure does not stop you.
*Precise:* designing so that the loss of a single Availability Zone does not take down the service.

**Shared responsibility model** — *Plain:* AWS secures the building; you secure your stuff inside it.
*Precise:* AWS is responsible for "security **of** the cloud" (physical, hypervisor, managed-service
internals); the customer is responsible for "security **in** the cloud" (your data, IAM, config,
patching of what you run). See [24](24-oidc-cicd.md)-style least-privilege chapters.

**Amazon Resource Name (ARN)** — *Plain:* the full name of one AWS thing. *Precise:* a globally unique
identifier like `arn:aws:sqs:us-east-1:123456789012:minitickets-dev-jobs`. IAM policies refer to
resources by ARN.

**Elasticity / autoscaling** — *Plain:* grow and shrink automatically with demand. *Precise:* adjusting
capacity to match load. MiniTickets keeps it simple (mostly 1 task) but ECS *can* autoscale.

---

## B. Networking

**VPC (Virtual Private Cloud)** — *Plain:* your own private network inside AWS. *Precise:* an isolated
virtual network you define with a CIDR block, containing subnets, route tables and gateways.
MiniTickets: `infra/src/network.ts`, CIDR `10.0.0.0/16`.

**CIDR block** — *Plain:* a range of IP addresses written like `10.0.0.0/16`. *Precise:* Classless
Inter-Domain Routing notation; the number after the slash is how many bits are fixed. `/16` = 65,536
addresses; `/24` = 256.

**Subnet** — *Plain:* a slice of your network that lives in one data centre. *Precise:* a range of IPs
within one AZ. MiniTickets has 2 **public** and 2 **private** subnets.

**Public subnet** — *Plain:* a subnet that can reach the internet through the front gate. *Precise:* a
subnet whose route table sends `0.0.0.0/0` to an Internet Gateway.

**Private subnet** — *Plain:* a subnet with no direct internet route. *Precise:* a subnet with no
route to an Internet Gateway; used for databases and caches. MiniTickets puts RDS and Valkey here.

**Route table** — *Plain:* the signpost saying where traffic goes. *Precise:* a set of routes mapping
destination CIDRs to targets (IGW, NAT, local). MiniTickets has a public table and a private table.

**Internet Gateway (IGW)** — *Plain:* the front door between your VPC and the internet. *Precise:* a
horizontally scaled, redundant VPC component that allows communication between the VPC and the
internet.

**NAT Gateway** — *Plain:* a one-way door letting private machines reach out but not be reached.
*Precise:* a managed NAT service in a public subnet letting private-subnet resources initiate outbound
traffic. **MiniTickets does not use one** — which is exactly why its private resources cannot call the
internet, and why the worker Lambdas run *outside* the VPC. 💡 *Conceptual alternative* in [02](02-vpc-and-networking.md).

**Security group** — *Plain:* a firewall attached to a resource; it lists what is allowed in.
*Precise:* a stateful virtual firewall at the resource's network interface, default-deny, rule-based,
referencing other security groups as sources. MiniTickets has 5: alb, web, api, db, redis
(`infra/src/security.ts`).

**Stateful (firewall)** — *Plain:* if you allow the request in, the reply automatically goes out.
*Precise:* return traffic for an allowed connection is automatically permitted; you do not need a
mirror egress rule.

**Ingress / egress** — *Plain:* incoming rules / outgoing rules. *Precise:* the two directions of
security-group and NACL rules.

**Network ACL (NACL)** — *Plain:* a second, subnet-level firewall that is stateless. *Precise:*
optional subnet-level access control evaluated before security groups. MiniTickets relies on default
NACLs plus security groups. 💡 *Conceptual.*

**Endpoint (VPC endpoint)** — *Plain:* a private shortcut to an AWS service without the internet.
*Precise:* a private connection to an AWS service (Gateway or Interface type) that avoids the public
internet. 💡 Relevant as an alternative in [02](02-vpc-and-networking.md); not built.

**Health check** — *Plain:* the load balancer pinging a container to see if it is alive. *Precise:* an
ALB feature that repeatedly calls a path (e.g. `/health`) and only routes to targets that pass.

---

## C. Identity and access

**IAM (Identity and Access Management)** — *Plain:* AWS's system for "who may do what".
*Precise:* the service that controls authentication and authorization for AWS APIs via users, groups,
roles and policies.

**Identity** — *Plain:* who you are. *Precise:* the principal making a request (user, role, service).

**Authentication (authn)** — *Plain:* proving who you are. *Precise:* verifying a principal's
credentials (password, temporary token, signature).

**Authorization (authz)** — *Plain:* what you are allowed to do. *Precise:* evaluating policies to
decide whether a request is permitted.

**Principal** — *Plain:* the "who" in a permission statement. *Precise:* the entity an IAM statement
applies to or that makes a request (an account, a role, a service like `lambda.amazonaws.com`).

**Policy** — *Plain:* a list of allowed or denied actions. *Precise:* a JSON document with `Effect`,
`Action`, `Resource` (and optionally `Condition`). **Identity-based** policies attach to a user/role;
**resource-based** policies attach to a resource (e.g. an SQS queue policy).

**Role** — *Plain:* a badge with a list of permissions that anyone allowed can wear temporarily.
*Precise:* an IAM identity with permissions but no permanent credentials, assumed to obtain temporary
credentials.

**Trust policy** — *Plain:* the rule saying who is allowed to wear the badge. *Precise:* the
role's assume-role policy document naming the principals permitted to call `sts:AssumeRole` on it.

**sts:AssumeRole** — *Plain:* the action of putting on a role's badge. *Precise:* the STS API call that
returns temporary credentials for a role, if the trust policy allows it.

**STS (Security Token Service)** — *Plain:* the office that hands out temporary badges.
*Precise:* the service that issues short-lived credentials for roles.

**Temporary credentials** — *Plain:* a badge that expires. *Precise:* a short-lived access key +
secret + session token issued by STS; safer than long-lived keys.

**Least privilege** — *Plain:* give only the permissions actually needed. *Precise:* designing policies
to grant the minimum actions on the minimum resources. MiniTickets applies this heavily: for example
the worker role may only read/delete its one queue and use its one table.

**Execution role vs task role** — *Plain:* the badge ECS wears to *start* your container versus the
badge your *code* wears while running. *Precise:* the task execution role lets the ECS agent pull
images and fetch secrets; the task role is assumed by the application code itself. MiniTickets defines
both in `infra/src/compute/iam.ts`.

**OIDC (OpenID Connect)** — *Plain:* a way for GitHub to prove who it is to AWS without a password.
*Precise:* an identity layer where an external provider (GitHub Actions) presents a signed token; AWS
validates it against an IAM OIDC provider and issues temporary credentials. MiniTickets: `cicd.ts`.

---

## D. Compute and delivery

**Container** — *Plain:* your app packaged with everything it needs to run, like a shipping container.
*Precise:* an isolated process image sharing the host kernel; portable and reproducible.

**Docker image / tag** — *Plain:* the recipe + contents of a container; a tag names a version.
*Precise:* a layered filesystem snapshot referenced by `repo:tag` (or digest).

**ECR (Elastic Container Registry)** — *Plain:* AWS's private shelf for container images.
*Precise:* a managed Docker registry. MiniTickets has three repositories: api, web, worker
(`infra/src/registry.ts`).

**ECS (Elastic Container Service)** — *Plain:* AWS's container runner. *Precise:* a managed
orchestrator for running containers as tasks and services.

**Cluster (ECS)** — *Plain:* a named folder for your services and tasks. *Precise:* a logical grouping;
empty clusters are free.

**Task definition** — *Plain:* the blueprint for one container run (image, CPU, memory, env, secrets).
*Precise:* a versioned JSON description; each change creates a new revision. `infra/src/compute/task.ts`.

**Task** — *Plain:* one running copy of a task definition. *Precise:* an instantiated task definition;
a short-lived unit.

**Service (ECS)** — *Plain:* keeps N copies of a task running and healthy. *Precise:* a scheduler that
maintains a desired count and integrates with a load balancer. `infra/src/compute/service.ts`.

**Fargate** — *Plain:* run containers without thinking about servers. *Precise:* a serverless compute
engine for ECS that provisions the host for you. MiniTickets uses `FARGATE` and `FARGATE_SPOT`.

**Fargate Spot** — *Plain:* cheaper Fargate that AWS can interrupt with two minutes' notice.
*Precise:* spare-capacity pricing for interruption-tolerant workloads.

**Service Connect** — *Plain:* containers finding each other by name inside ECS. *Precise:* ECS's
service-to-service networking that gives tasks a stable name (MiniTickets exposes the API as
`http://api:4000`).

**ALB (Application Load Balancer)** — *Plain:* the receptionist deciding which app gets the request.
*Precise:* a layer-7 load balancer that routes by path/host to target groups, with health checks.

**Listener / rule** — *Plain:* the port that accepts traffic / the condition that picks a target.
*Precise:* a listener watches a port/protocol; rules match host/path and forward to a target group.

**Target group** — *Plain:* the list of containers that can handle one kind of request.
*Precise:* a set of registered targets plus a health-check definition.

**CloudFront** — *Plain:* a CDN: hundreds of edge locations serving your content from nearby.
*Precise:* AWS's content delivery network, fronting an origin (here the ALB), terminating HTTPS,
caching. MiniTickets: `entry/cdn.ts`.

**Origin** — *Plain:* the real server behind a CDN. *Precise:* the upstream CloudFront fetches from on
a cache miss (the ALB here).

**Origin protection / origin secret** — *Plain:* a password the CDN says so outsiders cannot skip it.
*Precise:* a shared-secret header (`X-Origin-Verify`) required by the origin listener; MiniTickets:
`entry/origin-secret.ts`.

**CDN cache hit / miss / TTL** — *Plain:* the edge already has a copy / must fetch it / how long a copy
is kept. *Precise:* cache-behavior controls in CloudFront.

**TLS / HTTPS** — *Plain:* the padlock; encrypted web traffic. *Precise:* Transport Layer Security;
HTTPS is HTTP over TLS.

**Certificate / ACM** — *Plain:* a signed ID card for your website. *Precise:* an X.509 certificate
proving domain control, issued by a certificate authority. AWS Certificate Manager issues and renews
them; MiniTickets validates by DNS (`certificate.ts`).

**DNS** — *Plain:* the internet's phone book. *Precise:* the system mapping names to addresses; CNAME
/ A / TXT records. MiniTickets' DNS is managed at an external provider (Cloudflare mentioned in code).

**Load balancer vs reverse proxy** — *Plain:* both sit in front; a load balancer spreads traffic across
many servers, a reverse proxy fronts one.

---

## E. Data

**RDS (Relational Database Service)** — *Plain:* a managed SQL database. *Precise:* AWS's managed
relational engine (Postgres, MySQL, …) handling backups, patching, failover.
MiniTickets: `infra/src/data/postgres.ts`.

**PostgreSQL** — *Plain:* a popular open-source SQL database. *Precise:* an ACID relational database;
MiniTickets' main store.

**ACID** — *Plain:* a database's promise that transactions are all-or-nothing and safe.
*Precise:* Atomicity, Consistency, Isolation, Durability.

**Transaction** — *Plain:* a group of database changes that succeed or fail together.
*Precise:* a unit of work bounded by BEGIN/COMMIT with isolation guarantees.

**Row lock / `SELECT ... FOR UPDATE`** — *Plain:* "nobody else touches this row until I am done".
*Precise:* an exclusive lock taken on selected rows for the duration of a transaction.

**Race condition** — *Plain:* two operations interleaving to give a wrong result. *Precise:* an outcome
depending on uncontrolled timing. The "last ticket" problem.

**ElastiCache** — *Plain:* a managed in-memory cache. *Precise:* AWS's managed Redis/Valkey/Memcached.

**Redis / Valkey** — *Plain:* a super-fast in-memory key-value store. *Precise:* a data-structure
server used here for sessions; Valkey is a licence-compatible fork. `infra/src/data/cache.ts`.

**Session** — *Plain:* remembering that you are logged in. *Precise:* server-side state keyed by a
cookie (`sid`), stored in Redis here.

**DynamoDB** — *Plain:* a managed NoSQL key-value/table database. *Precise:* a serverless,
single-digit-millisecond key-value store with conditional writes and TTL. Used for job idempotency and
issued tickets.

**TTL (DynamoDB)** — *Plain:* "delete this item automatically after a time". *Precise:* an attribute
holding a Unix expiry after which DynamoDB removes the item (usually within days).

**Conditional write** — *Plain:* "only write if the current state is X". *Precise:* a DynamoDB
`ConditionExpression` that fails if the condition is not met; the basis of safe idempotency.

**S3 (Simple Storage Service)** — *Plain:* unlimited file storage on the internet. *Precise:* an
object store with buckets and keys; used here for ticket objects. `infra/src/tickets/storage.ts`.

**Bucket / object / key / prefix** — *Plain:* the container / the file / its path / a folder-like start
of a path. *Precise:* S3 has a flat namespace; "folders" are key prefixes.

**Secrets Manager** — *Plain:* a safe for passwords and keys. *Precise:* a managed service storing and
rotating secrets with IAM-controlled, audited access. `infra/src/data/secrets.ts`.

**KMS (Key Management Service)** — *Plain:* AWS's key locker for encryption. *Precise:* the service
that creates and controls encryption keys; managed keys encrypt most MiniTickets data at rest.

**Encryption at rest / in transit** — *Plain:* scrambled while stored / scrambled while travelling.
*Precise:* AES-style encryption on disk vs TLS on the wire.

**IAM database authentication** — *Plain:* logging into the database with an AWS identity instead of a
password. 💡 *Conceptual alternative*; MiniTickets uses an RDS-managed password secret instead.

---

## F. Asynchronous work

**Synchronous vs asynchronous** — *Plain:* the customer waits for it vs it happens in the background.
*Precise:* in-request vs out-of-band processing. Email and ticket rendering are asynchronous here.

**Message** — *Plain:* a small piece of work/data passed to a queue or topic. *Precise:* an event
payload; in MiniTickets a JSON booking confirmation.

**Producer / consumer** — *Plain:* who sends work / who does it. *Precise:* publisher vs subscriber
of a stream/topic/queue.

**Pub/Sub (publish–subscribe)** — *Plain:* one publisher, many independent listeners.
*Precise:* a messaging pattern where a topic fans out to subscribers.

**SNS (Simple Notification Service)** — *Plain:* a loudspeaker; publish once, many get a copy.
*Precise:* a managed pub/sub topic service. `infra/src/jobs/booking-events.ts`, `observability/alert-topic.ts`.

**SQS (Simple Queue Service)** — *Plain:* a to-do list a worker reads from. *Precise:* a managed,
durable message queue. `infra/src/jobs/queues.ts`.

**Standard vs FIFO queue** — *Plain:* standard is fast and may repeat/reorder; FIFO keeps order and
deduplicates. MiniTickets uses standard queues.

**Polling (short vs long)** — *Plain:* asking "any work?" repeatedly / waiting for work to appear.
*Precise:* SQS receiving modes; Lambda's event source mapping uses long polling.

**Event source mapping** — *Plain:* the glue that lets Lambda read a queue for you. *Precise:* a Lambda
resource that polls a stream/queue and invokes the function. `infra/src/jobs/queue-trigger.ts`.

**Batch** — *Plain:* several messages handled in one call. *Precise:* the array Lambda passes; up to 10
here.

**Partial batch failure / `batchItemFailures`** — *Plain:* "these few failed, the rest are fine".
*Precise:* Lambda's `ReportBatchItemFailures` response so only failed messages retry.
`apps/worker/src/batch.ts`.

**Visibility timeout** — *Plain:* how long a message hides while a worker handles it. *Precise:* the
hiding window after receive; if not deleted in time it becomes visible again (60 s email, 180 s tickets).

**ChangeMessageVisibility** — *Plain:* extend or shorten that hiding window on purpose. *Precise:* the
SQS API the worker uses to apply its own backoff. `apps/worker/src/retry-later.ts`.

**At-least-once delivery** — *Plain:* a message will arrive, maybe more than once.
*Precise:* a delivery guarantee where duplicates are possible; consumers must be idempotent.

**Exactly-once** — *Plain:* arrives exactly one time. *Precise:* not actually guaranteed between two
systems; MiniTickets achieves "effectively once" via idempotency, honestly explained in
`handlers/booking-confirmed.ts`.

**Idempotency / idempotent consumer** — *Plain:* doing it twice has the same effect as once.
*Precise:* an operation whose repeated application is safe; implemented here with a business-key
memory table.

**Backoff / exponential backoff** — *Plain:* wait longer after each failure. *Precise:* increasing the
delay between retries; MiniTickets: 10 s → 40 s → 120 s.

**Jitter** — *Plain:* a random sprinkle added to backoff so retries do not all fire at once.
*Precise:* randomized delay. **Not built** in MiniTickets (noted in `apps/worker/src/backoff.ts`).

**DLQ (Dead-Letter Queue)** — *Plain:* the repair tray for messages that kept failing.
*Precise:* a queue that receives messages from a source queue after `maxReceiveCount` receives.
Flagship chapter [19](19-dead-letter-queue.md).

**`maxReceiveCount` / redrive policy** — *Plain:* how many tries before the message is set aside.
*Precise:* the source queue's redrive policy naming the DLQ and the receive budget (3 here).

**Redrive / message move task** — *Plain:* moving failed messages back to try again.
*Precise:* `StartMessageMoveTask` re-injects DLQ messages into the source (or another) queue.

**Lambda** — *Plain:* run a function on AWS with no server, billed per run.
*Precise:* a serverless functions service invoked by events; cold starts, concurrency limits apply.
`infra/src/jobs/worker-lambda.ts`.

**Cold start** — *Plain:* the extra delay when a fresh Lambda starts. *Precise:* initializing the
runtime and your module top-level before handling the first event.

**Reserved concurrency** — *Plain:* a cap on how many Lambdas of this function run at once.
*Precise:* a per-function limit that also throttles; important not to starve a shared queue here.

**Outbox pattern (transactional outbox)** — *Plain:* save the event in the same database transaction
as the change, then publish it afterwards. *Precise:* a reliable-messaging pattern that avoids the
"committed but not published" gap. Chapter [15](15-transactional-outbox.md).

**Outbox relay** — *Plain:* the small background process that publishes saved events.
*Precise:* a poller reading pending outbox rows and delivering them. `apps/api/src/services/outbox.ts`.

**`FOR UPDATE SKIP LOCKED`** — *Plain:* lock the rows I pick; let other workers pick different ones.
*Precise:* Postgres row-locking clause enabling safe concurrent batch claiming.

**SES (Simple Email Service)** — *Plain:* AWS's email sender. *Precise:* a managed email-sending (and
receiving) service with verified identities. `infra/src/jobs/email.ts`, `worker/ses-mailer.ts`.

**SES sandbox** — *Plain:* a trial mode where you can only email verified addresses.
*Precise:* the default new-account restriction (200/day, 1/s, verified recipients only).
**MiniTickets likely still runs here unless production access was requested.**

**DKIM** — *Plain:* cryptographic proof that an email really came from your domain.
*Precise:* DomainKeys Identified Mail; SES publishes 3 CNAME records you add to DNS.

**Fan-out** — *Plain:* one event copied to many destinations. *Precise:* the SNS-to-multiple-queues
pattern MiniTickets uses for email and tickets.

---

## G. Operations

**Observability** — *Plain:* being able to see what the system is doing. *Precise:* logs, metrics and
traces together.

**CloudWatch** — *Plain:* AWS's monitoring dashboard, log store and alarm system. *Precise:* the
service providing metrics, log groups, alarms and dashboards. `observability/*`.

**Log group / log stream** — *Plain:* a folder of logs / one source's sequence of lines.
*Precise:* CloudWatch Logs containers.

**Structured logging** — *Plain:* logs written as machine-readable JSON. *Precise:* each line a JSON
object; enables Logs Insights queries. MiniTickets logs JSON with a `correlationId`.

**Correlation ID** — *Plain:* a tag following one booking across all services. *Precise:* an id
propagated through the outbox, SNS, SQS and worker logs.

**Metric** — *Plain:* a number tracked over time (e.g. queue depth). *Precise:* a CloudWatch
time-series such as `ApproximateNumberOfMessagesVisible`.

**Alarm** — *Plain:* an alert when a metric crosses a line. *Precise:* a CloudWatch rule comparing a
metric to a threshold over periods, changing between OK / ALARM / INSUFFICIENT_DATA.

**Alarm action** — *Plain:* what happens when an alarm fires. *Precise:* the target notified (here an
SNS topic that emails a human).

**Dashboard** — *Plain:* a page of charts. *Precise:* a CloudWatch dashboard assembling metric and
alarm widgets.

**Logs Insights** — *Plain:* a search language for log lines. *Precise:* CloudWatch's query engine over
log groups.

**Runbook** — *Plain:* the steps to follow when something breaks. *Precise:* an operational procedure
document.

**On-call / paging** — *Plain:* the person who must act when an alarm fires. *Precise:* the rotation
responsible for incidents; MiniTickets uses email alerts to one owner.

**SSM Parameter Store** — *Plain:* a small settings board in AWS. *Precise:* AWS Systems Manager's
parameter service; used here to record the deployed image tag. `infra/src/release.ts`.

**Deploy guard** — *Plain:* a check that stops a stale deploy. *Precise:* MiniTickets compares the
deployed commit parameter before applying infrastructure.

**AWS Budgets** — *Plain:* an email when spending gets high. *Precise:* a cost monitor with threshold
alerts. `infra/src/budget.ts`.

**Infrastructure as Code (IaC)** — *Plain:* describing your cloud in files instead of clicking.
*Precise:* managing resources declaratively; MiniTickets uses **Pulumi** (TypeScript).

**Pulumi** — *Plain:* a tool that builds AWS resources from TypeScript code. *Precise:* an IaC engine
with a state file tracking resources. `infra/index.ts`.

**Drift** — *Plain:* when reality and your code disagree. *Precise:* a difference between deployed
resources and the IaC/config that should define them.

**CI / CD** — *Plain:* automatic testing / automatic shipping. *Precise:* continuous integration and
continuous delivery/deployment pipelines. `.github/workflows/`.

**Blue/green, canary, rolling deploy** — *Plain:* ways to ship without downtime. MiniTickets relies on
ECS rolling deployments and health checks; canary is 💡 *conceptual*.

**RTO / RPO** — *Plain:* how fast you recover / how much data you may lose. *Precise:* Recovery Time
Objective and Recovery Point Objective.

---

## H. Cost

**Pay-as-you-go** — *Plain:* you pay for what you use, by the second or request.

**Free tier** — *Plain:* a small monthly allowance that costs nothing. Many MiniTickets components sit
inside it at low traffic.

**Request-billed** — *Plain:* charged per operation, not per hour. SQS, SNS and Lambda are like this;
an idle queue costs nothing.

**Idle cost** — *Plain:* money spent even when nobody uses the system. RDS and ElastiCache charge per
hour even when idle — which is why MiniTickets puts them behind on/off switches.

**Cost switch** — *Plain:* a config flag that turns a whole layer on or off to save money.
MiniTickets: `dataEnabled`, `computeEnabled`, `entryEnabled`, `cdnEnabled`.

---

## Where a term lives in the code

| Term | First file to look at |
| --- | --- |
| VPC, subnets, IGW, routes | `infra/src/network.ts` |
| Security groups | `infra/src/security.ts` |
| IAM roles, trust, least privilege | `infra/src/compute/iam.ts`, `infra/src/jobs/worker-iam.ts`, `infra/src/cicd.ts` |
| ECR | `infra/src/registry.ts` |
| ECS, task, service, Fargate | `infra/src/compute/*` |
| ALB, listener, target group | `infra/src/entry/alb.ts`, `listener.ts`, `target-groups.ts` |
| TLS/ACM | `infra/src/certificate.ts` |
| CloudFront, origin secret | `infra/src/entry/cdn.ts`, `origin-secret.ts` |
| RDS Postgres | `infra/src/data/postgres.ts` |
| Valkey | `infra/src/data/cache.ts` |
| Secrets, KMS | `infra/src/data/secrets.ts` |
| DynamoDB | `infra/src/jobs/processed-jobs-table.ts`, `infra/src/tickets/storage.ts` |
| S3 | `infra/src/tickets/storage.ts` |
| Outbox | `apps/api/src/services/outbox.ts`, `queries/outbox.ts` |
| SNS | `infra/src/jobs/booking-events.ts` |
| SQS, DLQ | `infra/src/jobs/queues.ts` |
| Lambda | `infra/src/jobs/worker-lambda.ts` |
| DLQ | `infra/src/jobs/queues.ts`, `apps/worker/src/batch.ts` |
| SES | `infra/src/jobs/email.ts`, `apps/worker/src/ses-mailer.ts` |
| CloudWatch | `infra/src/observability/*` |
| SSM | `infra/src/release.ts` |
| Budgets | `infra/src/budget.ts` |
| OIDC | `infra/src/cicd.ts` |

Next: [Chapter 01 — What is AWS?](01-what-is-aws.md), or the [flagship DLQ chapter](19-dead-letter-queue.md)
if you already know the basics.
