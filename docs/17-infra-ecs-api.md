# Step 11e: ECS cluster and the API service

## 1. In one sentence

This step runs our **api container in AWS** (ECS on Fargate), gives it exactly the permissions it needs, connects it to the real Postgres and Valkey over verified TLS, and puts it behind a second **on/off switch** called `computeEnabled`.

There is still no load balancer, so nobody on the internet can reach the api yet. That is Step 11f.

## 2. The big picture

```mermaid
flowchart TB
    subgraph cluster["ECS cluster minitickets-dev"]
        subgraph service["Service minitickets-dev-api<br/>keeps 1 task running"]
            subgraph task["Task (one running copy)<br/>Fargate Spot, ARM64, 0.25 vCPU, 512 MB"]
                container["Container api<br/>node dist/server.js :4000"]
            end
        end
    end
    taskdef["Task definition<br/>minitickets-dev-api:N<br/>the recipe"] -.->|"used to start"| task
```

Back to the office building from [Step 11a](12-infra-network.md). Until now the building had floors, badge readers and a filing cabinet, but **no staff**. This step hires the first worker (the api), gives them a badge (security group), a key card for exactly two lockers (IAM), and a manager who replaces them if they fall ill (the ECS service).

### The files

| File                            | Job                                                                 |
| ------------------------------- | ------------------------------------------------------------------- |
| `infra/src/compute/logs.ts`     | CloudWatch log group `/minitickets/dev/api`, 7 days                 |
| `infra/src/compute/cluster.ts`  | ECS cluster + capacity providers FARGATE and FARGATE_SPOT           |
| `infra/src/compute/iam.ts`      | Execution role and task role                                        |
| `infra/src/compute/task.ts`     | Task definition: image, size, env vars, secrets, logs, health check |
| `infra/src/compute/service.ts`  | Service: 1 task, Spot, public subnet, circuit breaker, ECS Exec     |
| `infra/index.ts`                | The `computeEnabled` switch and `apiImageTag`; wires the five files |
| `scripts/run-migrations.sh`     | `pnpm infra:migrate`: runs the migrations as a one-off task         |
| `apps/api/src/config/database.ts` | `DATABASE_URL` (local) **or** `DB_*` pieces with SSL (AWS)        |
| `apps/api/Dockerfile`           | Adds the RDS certificate bundle and `NODE_EXTRA_CA_CERTS`           |

## 3. The concepts

### 3.1 Cluster, service, task, task definition

Four words that are easy to mix up. A restaurant kitchen helps:

| ECS word            | Kitchen comparison                         | What it really is                                                   |
| ------------------- | ------------------------------------------ | ------------------------------------------------------------------- |
| **Cluster**         | The kitchen                                | A named group that services and tasks belong to. Costs nothing.     |
| **Task definition** | The recipe card                            | A JSON description: image, CPU, memory, env vars, secrets, logs     |
| **Task**            | One cook working from the recipe           | One running copy of the recipe: one or more containers              |
| **Service**         | The shift manager                          | Keeps N tasks running, replaces failed ones, rolls out new recipes  |

```mermaid
flowchart LR
    td["Task definition<br/>recipe, revision :3"] --> svc["Service<br/>wants 1 task"]
    svc -->|"starts and watches"| t1["Task<br/>running"]
    t1 --> c1["Container api"]
    svc -.->|"if it dies, start a new one"| t2["Task<br/>replacement"]
```

**Why we need all four.** The task definition says **what** to run. The service says **how many** and keeps that true over time. The cluster is just the place they live. A task you start by hand (like our migration task) has no manager: when it stops, it stays stopped.

Every change to a task definition makes a new **revision** (`minitickets-dev-api:1`, `:2`, ...). Old revisions stay. That is what makes a rollback possible.

### 3.2 Fargate vs EC2

**What it is.** ECS can run containers in two ways:

- **EC2 launch type:** you rent virtual machines (EC2 instances), put them in the cluster, and ECS packs containers onto them. You patch and size the machines.
- **Fargate:** you only say "0.25 vCPU and 512 MB". AWS finds a machine, runs the task, and hides the machine from you. You pay per second for what the task asks for.

```mermaid
flowchart TB
    subgraph ec2["EC2 launch type"]
        vm["Your VM: you patch it,<br/>pay for it even when empty"] --> ca["container"]
        vm --> cb["container"]
    end
    subgraph fg["Fargate"]
        f1["AWS machine, hidden"] --> cf["our container"]
    end
```

**Why we chose Fargate.** One small container does not fill a VM. With Fargate there is nothing to patch, nothing idle, and nothing to forget to turn off apart from the task itself.

### 3.3 Fargate Spot

**What it is.** Spot is AWS's spare capacity, sold about **70% cheaper**. The catch: AWS can take it back at any time. The task gets a 2-minute warning (SIGTERM, which our graceful shutdown in `server.ts` handles) and then stops. The service sees a missing task and starts a new one.

```mermaid
sequenceDiagram
    participant AWS
    participant T as api task on Spot
    participant S as ECS service
    AWS->>T: need this capacity back (SIGTERM, 2 minutes)
    T->>T: finish requests, close pool and redis
    T-->>S: task stopped
    S->>AWS: start a replacement task
    Note over T,S: api is down for 1-2 minutes
```

**Why we use it.** Dev can live with a short outage. **Production should not run on Spot alone**: there an interruption means real users get errors. A common mix is a base of normal FARGATE tasks plus extra Spot tasks.

The migration task uses normal **FARGATE**: a migration interrupted halfway is worse than paying a fraction of a cent more.

### 3.4 Why two IAM roles

An **IAM role** is a badge with a list of permissions that someone wears for a while. Each role has:

- a **trust policy**: WHO may wear it,
- a **permission policy**: WHAT the wearer may do,
- and it is **attached** to a resource that uses it.

Our two roles are worn by different people at different moments.

**(1) Execution role** (`minitickets-dev-api-execution-role`)

```mermaid
flowchart LR
    who["TRUST: ecs-tasks.amazonaws.com<br/>only for our account"] --> role["Execution role"]
    role --> p1["PERMISSIONS:<br/>AmazonECSTaskExecutionRolePolicy<br/>pull image from ECR, write logs"]
    role --> p2["PERMISSIONS:<br/>secretsmanager:GetSecretValue<br/>on ONLY our 2 secret ARNs"]
    role --> used["USED BY: task definition<br/>executionRoleArn<br/>worn by the ECS agent at START"]
```

**(2) Task role** (`minitickets-dev-api-task-role`)

```mermaid
flowchart LR
    who["TRUST: ecs-tasks.amazonaws.com<br/>only for our account"] --> role["Task role"]
    role --> p1["PERMISSIONS:<br/>4 ssmmessages actions<br/>for ECS Exec only"]
    role --> used["USED BY: task definition<br/>taskRoleArn<br/>worn by our running container"]
```

**Why two.** They separate "getting the task ready" from "running our code":

- The **execution role** is used by ECS itself, **before** our code starts: pull the image, read the secrets, create the log stream.
- The **task role** is what **our code** (and anything running inside the container) can do with AWS. Ours can only open an ECS Exec channel. It cannot read secrets, touch S3, or anything else.

So if someone broke into our api process, they would hold the task role, not the execution role. They would find the passwords in the env vars of that one process, but they could not use AWS to read any other secret.

**Least privilege** in the secrets policy: the resource list is exactly two ARNs, not `*`. No `kms:Decrypt` is needed, because both secrets use the default AWS-managed key, which Secrets Manager decrypts for anyone allowed to read the secret.

### 3.5 The confused deputy problem

**What it is.** A **deputy** is a trusted helper that acts for others. ECS is a deputy for **every** AWS customer. Our trust policy says "ECS may wear this role". Without more, ECS working for **another** account could be tricked into wearing our role, if the other account learned our role's ARN (ARNs are not secret).

```mermaid
sequenceDiagram
    participant E as Evil account
    participant ECS as ECS service (the deputy)
    participant R as Our execution role
    E->>ECS: run my task, use role arn:...:our-role
    ECS->>R: assume role, SourceAccount = evil account
    R--xECS: refused, SourceAccount must be ours
```

**The fix.** The trust policy has a condition: `aws:SourceAccount` must equal **our** account id. ECS always says which account it is working for, so it can only wear our roles while working for us.

Real-life comparison: a courier may collect parcels from your office. The condition is the receptionist asking "which company sent you?" before handing anything over.

### 3.6 Task startup, step by step

```mermaid
sequenceDiagram
    participant ECS as ECS agent (execution role)
    participant ECR
    participant SM as Secrets Manager
    participant C as api container (task role)
    ECS->>ECR: pull image apiRepoUrl:apiImageTag
    ECS->>SM: GetSecretValue on the RDS secret and redis-url
    SM-->>ECS: values
    ECS->>C: start with env vars + secret env vars
    C->>C: config/env.ts validates, server listens on 4000
    ECS->>C: health check: node calls /health
    Note over C: our code now runs with the TASK role
```

If any step before "start" fails (wrong tag, missing permission), the container never runs. The task's **stopped reason** then tells you which step failed. Logs are empty in that case, because our code never printed anything.

### 3.7 Where the secrets go

```mermaid
flowchart LR
    sm1["RDS master secret (JSON)<br/>username, password"] -->|":username::"| u["DB_USER"]
    sm1 -->|":password::"| p["DB_PASSWORD"]
    sm2["redis-url secret (string)"] --> r["REDIS_URL"]
    u --> app["api process<br/>config/env.ts"]
    p --> app
    r --> app
```

The task definition stores only **where** each secret is (`valueFrom`), never the value. The RDS secret is JSON, so we pick one key with `<secret ARN>:username::`. The two empty parts at the end mean "the current version".

**Why the api now accepts `DB_HOST`, `DB_PORT`, ... instead of one URL.** ECS can put a secret value into its own env var, but it cannot glue pieces together into `postgres://user:password@host/db`. So `apps/api/src/config/database.ts` accepts **either** `DATABASE_URL` (local, Docker Compose, CI: unchanged) **or** all five `DB_*` pieces (AWS). Setting both, or only some of the pieces, stops the api at startup with a clear message. The migration runner uses the same rules.

### 3.8 TLS to RDS, with verified certificates

**What it is.** RDS refuses connections without TLS (`rds.force_ssl = 1`). TLS does two jobs:

1. **Encryption:** nobody on the network can read the password or the data.
2. **Identity:** the server proves, with a **certificate**, that it really is our database.

Job 2 only happens if the client **checks** the certificate. A certificate is trusted when it is signed by a **certificate authority (CA)** the client already trusts.

```mermaid
flowchart LR
    ca["Amazon RDS CA<br/>in rds-global-bundle.pem"] -->|"signs"| cert["Certificate for<br/>minitickets-dev-db...rds.amazonaws.com"]
    cert --> check{"api checks:<br/>signed by a trusted CA?<br/>name = DB_HOST?"}
    check -->|"yes"| ok["connect"]
    check -->|"no"| stop["refuse"]
```

**The catch.** Node trusts the well-known public CAs (the ones websites use). The RDS CA is **not** one of them, so a strict check fails with "self-signed certificate in certificate chain".

There are two ways out:

| Way                                     | Result                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `rejectUnauthorized: false`             | Encrypted, but **anyone in the middle can pretend to be the database** and collect our password. Never. |
| Trust the RDS CA, keep checking (ours)  | Encrypted **and** we know who we are talking to                        |

**What we did.**

- The api Dockerfile downloads AWS's global RDS bundle (every RDS CA, all regions) to `/usr/local/share/rds-global-bundle.pem` and sets `NODE_EXTRA_CA_CERTS` to it. Node **adds** those CAs to its normal list when it starts.
- When `DB_HOST` is used, `database.ts` turns on `ssl: { rejectUnauthorized: true }`. pg also checks that the certificate's name matches `DB_HOST`.
- Locally nothing changes: `DATABASE_URL` means no SSL (the Docker Postgres has none), and the extra CAs in the image are simply never used.

We tested the image: Node loads all 111 CAs as the `node` user, and with `DB_*` set against the local (no-SSL) Postgres the api **refuses** to connect ("The server does not support SSL connections"). That proves SSL is required and not silently skipped.

### 3.9 TLS to Valkey

**What it is.** The `REDIS_URL` secret starts with `rediss://` (two s). ioredis sees that and turns on TLS **with** certificate checks by itself. ElastiCache certificates are signed by Amazon's public CA, which Node already trusts. So no code change and no extra file were needed.

```mermaid
flowchart LR
    url["REDIS_URL = rediss://:token@host:6379"] --> io["ioredis: tls on,<br/>certificate checked"]
    io --> vk[("Valkey<br/>TLS only")]
```

### 3.10 The network path

```mermaid
flowchart LR
    subgraph pub["Public subnet"]
        task["api task<br/>wears api group<br/>public IP"]
    end
    subgraph priv["Private subnets"]
        rds[("RDS<br/>db group")]
        vk[("Valkey<br/>redis group")]
    end
    task -->|"5432, allowed: source = api group"| rds
    task -->|"6379, allowed: source = api group"| vk
    task -->|"443 out via internet gateway"| aws["ECR, Secrets Manager,<br/>CloudWatch, SSM"]
    net["Internet"] -.->|"blocked: api group allows<br/>only the alb group"| task
```

The rules come from [Step 11b](13-infra-security-groups.md). The db and redis groups have allowed the **api group** since then, but nothing wore that badge. Now the api task does, so it is the **only** thing that can reach the database and the cache.

**Why a public subnet with a public IP? (the trade-off)** We have **no NAT gateway** (about $33 a month, see [Step 11a](12-infra-network.md)). A task in a **private** subnet would have no way out to the internet. ECR, Secrets Manager and CloudWatch are reached over the internet, so the task could not even start. In a public subnet with a public IP, it goes out through the internet gateway.

Is a public IP dangerous? It makes the task **addressable**, not **open**. The api security group still blocks every inbound connection except port 4000 from the load-balancer group, and no load balancer exists yet. Production would put tasks in private subnets with a NAT gateway or VPC endpoints, so they have no public address at all.

### 3.11 Health checks and the deployment circuit breaker

**What it is.**

- **Container health check:** every 15 seconds ECS runs `node -e "fetch('http://localhost:4000/health')..."` **inside** the container (the slim image has no curl). Three failures in a row = UNHEALTHY, and the service replaces the task. It checks `/health`, not `/ready`: a short database hiccup must not make ECS kill a working api.
- **Circuit breaker:** during a deployment, if new tasks keep failing to start or to become healthy, ECS gives up instead of retrying forever, and **rolls back** to the last revision that worked.

```mermaid
flowchart TB
    dep["New revision :4<br/>pulumi up"] --> start["Start new task"]
    start --> hc{"Healthy?"}
    hc -->|"yes"| done["Old task :3 stopped<br/>deployment COMPLETED"]
    hc -->|"no, again and again"| cb["Circuit breaker trips"]
    cb --> rb["Rollback: keep running :3<br/>deployment FAILED"]
```

**Why we need it.** A broken image (bad env var, crash on start) would otherwise loop forever: start, crash, start, crash, each attempt billed. With the circuit breaker the old version keeps serving and the failure is reported.

Note: on the **very first** deployment there is no older revision to roll back to. The deployment just fails, and the stopped reason and logs say why.

### 3.12 ECS Exec: "I can't connect from my laptop"

**The problem.** RDS and Valkey live in private subnets ([Step 11c](14-infra-data.md) explains the three locks). Your laptop cannot reach them, so how do you check that the api can?

**What ECS Exec is.** A way to open a shell **inside the running container** from your laptop. The container is inside the VPC and wears the api badge, so from that shell you can reach everything the api can.

```mermaid
sequenceDiagram
    participant L as Your laptop (aws CLI + plugin)
    participant SSM as AWS Systems Manager
    participant A as agent inside the api task
    A->>SSM: open channel (task role: ssmmessages)
    L->>SSM: aws ecs execute-command
    SSM->>A: your keystrokes
    A->>A: run node fetch to localhost 4000 ready
    A-->>L: 200 ready
```

No inbound port is opened. The agent inside the task (added by Fargate) calls **out** to Systems Manager, and your laptop also calls Systems Manager. Systems Manager joins the two. That is why it needs:

- `enableExecuteCommand: true` on the service,
- the 4 `ssmmessages` actions on the **task role** (the agent runs inside our task),
- `initProcessEnabled: true` in the task definition (a tiny init process that cleans up the shells you open),
- the **Session Manager plugin** on your laptop (`brew install --cask session-manager-plugin`). It is not installed yet.

### 3.13 Migrations as a one-off task

**What it is.** `pnpm infra:migrate` starts **one task** from the same task definition, but replaces its command with `node dist/migrate.js`. It waits for the task to stop, prints the exit code and the last log lines, and exits with that code.

```mermaid
flowchart LR
    script["pnpm infra:migrate"] -->|"run-task, command override"| task["One-off task<br/>FARGATE, same image,<br/>same secrets, same network"]
    task -->|"apply SQL files"| rds[("RDS")]
    task -->|"exit 0"| script
    script --> out["prints exit code<br/>and last log lines"]
```

**Why a one-off task, not part of the api.** Same reason as in Docker Compose ([Step 11](11-docker.md)): with several api tasks starting together, they would all try to migrate at once. A separate job runs once and then stops. Using the **same task definition** means the migration uses exactly the code and SQL files of the deployed image, with the same database settings and network access.

**Order on deploy day.** The migration task needs the cluster and the task definition, which are part of the compute layer. So compute must be on first. The api starts fine without tables (it only listens, and `/health` and `/ready` need no tables). Then we migrate, and only then do signups work. For a first deploy in dev that gap is harmless. In production, a pipeline runs the migration with the new revision **before** updating the service, and every migration is written so the old code still works with the new tables.

### 3.14 Logs

**What it is.** The `awslogs` driver sends every line the container prints to the CloudWatch log group `/minitickets/dev/api`. Each task writes its own **stream**, named `api/api/<task id>`.

```mermaid
flowchart LR
    c["container stdout<br/>Fastify JSON logs"] --> drv["awslogs driver"]
    drv --> lg["Log group /minitickets/dev/api<br/>stream api/api/task-id"]
    lg -->|"after 7 days"| gone["deleted"]
```

**Why 7 days.** Without a retention setting, CloudWatch keeps logs **forever** and bills for the storage. Dev logs older than a week are never read.

### 3.15 The compute switch

```mermaid
flowchart TB
    c{"computeEnabled?"}
    c -->|"false (default)"| none["No compute resources"]
    c -->|"true"| d{"dataEnabled?"}
    d -->|"false"| err["Stop with a clear error:<br/>the api needs the database"]
    d -->|"true"| tag{"apiImageTag set?"}
    tag -->|"no"| err2["Stop: missing apiImageTag"]
    tag -->|"yes"| on["10 compute resources created"]
```

- `computeEnabled` (default `false`) creates or deletes the 10 compute resources: log group, cluster, capacity providers, 2 roles, 3 policy pieces, task definition, service.
- `apiImageTag` has **no default**. It must be a git SHA you pushed with `pnpm images:push`. A default like `latest` would hide **which** code runs.
- Network, security groups, budget, registry and (if on) the data layer are not touched.

### 3.16 Cost per hour

Approximate prices in us-east-1. Check the AWS pricing pages for today's numbers.

| Item                                             | Per hour      |
| ------------------------------------------------ | ------------- |
| Fargate Spot, ARM, 0.25 vCPU + 0.5 GB             | ~$0.003 (Spot prices move) |
| Same on normal Fargate, for comparison           | ~$0.010       |
| Public IPv4 address on the task                  | $0.005        |
| CloudWatch Logs (a few MB)                       | ~$0          |
| Cluster, task definition, roles, log group       | $0            |
| Migration task (1 minute on normal Fargate)      | ~$0.0002 each run |
| **Compute total**                                | **~$0.008**   |
| Data layer ([Step 11c](14-infra-data.md))        | ~$0.033       |
| **Everything on**                                | **~$0.04**    |

So about **4 cents an hour** with data and compute on: a 3-hour deploy-day session costs about 12 cents. Surprise: the **public IP costs more than the Spot task itself**. A NAT gateway (about $0.045 an hour plus traffic) would cost more than everything else together, which is why we accepted the public subnet trade-off.

### 3.17 Known limitation: the rotating database password

**What it is.** RDS changes (rotates) the master password every **7 days**. ECS reads the secret **only when a task starts**. Our running api keeps the old password in `DB_PASSWORD`.

```mermaid
sequenceDiagram
    participant RDS
    participant SM as Secrets Manager
    participant A as running api task
    Note over A: started with password v1
    RDS->>SM: rotate: password v2
    A->>RDS: existing connections still work
    A->>RDS: NEW connection with v1
    RDS--xA: password authentication failed
```

**What breaks.** Connections that are already open keep working (Postgres does not log out existing sessions). But the pool closes idle connections after a short time and opens new ones, and every **new** connection fails. `/ready` turns 503 and logins and signups fail, until the task is restarted. Restarting is enough, because a new task reads the new password:

```bash
aws ecs update-service --cluster minitickets-dev --service minitickets-dev-api --force-new-deployment
```

**Why it is fine for us.** We switch the data layer on for a few hours and then off. Each time it is a brand-new database with a brand-new password, so a 7-day rotation never happens during a session.

**Production fixes.**

1. **Read the secret on connect, with caching.** pg accepts `password` as an async function. The api reads the secret from Secrets Manager (cached for a few minutes) whenever it opens a connection, and re-reads it if login fails. The task role then needs `GetSecretValue` on that one secret.
2. **Restart on rotation.** An EventBridge rule watches for the rotation event and forces a new deployment of the service.
3. Or avoid the master password entirely: a separate app user, or IAM database authentication (short-lived tokens instead of a password).

## 4. Dependency order

```mermaid
flowchart TB
    data["Data layer: RDS, Valkey, secrets<br/>Step 11c"] --> iam["IAM roles<br/>need the 2 secret ARNs"]
    reg["ECR + pushed image<br/>Step 11d"] --> task["Task definition"]
    iam --> task
    logs["Log group"] --> task
    data --> task
    cluster["Cluster + capacity providers"] --> svc["Service"]
    task --> svc
    net["Public subnets + api group<br/>Steps 11a, 11b"] --> svc
```

- The roles need the secret ARNs, so the data layer must exist first. That is why `computeEnabled` refuses to work without `dataEnabled`.
- The task definition needs the roles, the log group, the image tag and the database address.
- The service needs the cluster **with its capacity providers attached** (it asks for FARGATE_SPOT), the task definition, the public subnets and the api group.
- Two waits are made explicit in code: the cluster name is taken from the capacity-provider resource, and each role ARN is passed on only after its policies are attached. Without that, the service or the first task could start a few seconds too early and fail.

## 5. What breaks if this is wrong or missing

| Mistake                                                   | What happens                                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `apiImageTag` points at a tag that was never pushed       | Task stops: `CannotPullContainerError ... not found`                         |
| Image built for x86 but task is ARM64                     | Container exits at once: `exec format error` ([Step 11d](16-infra-ecr.md))  |
| Execution role cannot read a secret                       | Task stops: `ResourceInitializationError: unable to pull secrets`            |
| Task in a private subnet (no NAT) or no public IP         | Task cannot reach ECR: `ResourceInitializationError ... i/o timeout`         |
| api not wearing the api group                             | Database and Valkey connections time out; `/ready` returns 503               |
| RDS CA not in the image                                   | `self-signed certificate in certificate chain`; `/ready` returns 503         |
| `rejectUnauthorized: false` "to make it work"             | Works, but anyone in the middle can impersonate the database and take the password |
| `redis://` instead of `rediss://`                         | Connection resets: Valkey only speaks TLS                                    |
| No `aws:SourceAccount` condition                          | Confused deputy: ECS acting for another account could use our role           |
| Health check against `/ready`                             | A database blip makes ECS kill healthy api tasks                             |
| No circuit breaker                                        | A broken image restarts forever, billed each time                           |
| No log retention                                          | Logs are kept and billed forever                                             |
| Migrations not run                                        | `/ready` is 200 but signup fails: `relation "users" does not exist`         |
| Password rotated while a task runs (section 3.17)         | New connections fail until the service is restarted                          |
| Data switched off while compute is on                     | Pulumi refuses with a clear error (the api needs the database)               |

## 6. How this connects

**Uses from earlier layers**

- `publicSubnetIds` from the network layer ([Step 11a](12-infra-network.md)): where the task runs.
- `apiSgId` from the security layer ([Step 11b](13-infra-security-groups.md)): the badge that the db and redis groups already trust.
- `dbEndpoint`, `dbPort`, `dbMasterSecretArn`, `redisUrlSecretArn` from the data layer ([Step 11c](14-infra-data.md)): the database address and the two secrets.
- `apiRepoUrl` and the ARM64 image from the registry ([Step 11d](16-infra-ecr.md)).
- The function-per-layer wiring from [Step 11d (dependencies)](15-infra-dependencies.md): five new functions, connected only in `index.ts`.
- The migration runner and health endpoints from [Step 11](11-docker.md).

**Used by later layers**

- Step 11f (load balancer) will attach a target group to this service, allow it in through the alb group, route `/trpc/*` here, and replace the `WEB_ORIGIN` placeholder with the real address.
- A web service will follow the same pattern (task definition + service) with the web image.
- `apiLogGroup`, `clusterName` and `apiServiceName` are what you use to debug on deploy day.

See [00-architecture.md](00-architecture.md) for the whole picture.

## 7. Deploy day: commands in order

You run all of these. Set the AWS profile once per terminal:

```bash
cd infra
export AWS_PROFILE=ticketlite AWS_REGION=us-east-1
```

**1. Push new images and set the tag** (the api image changed in this step)

```bash
cd ..                      # repo root; the working tree must be clean
pnpm images:push           # builds arm64 images, tag = short git SHA
cd infra
pulumi config set apiImageTag "$(git rev-parse --short HEAD)"
```

`pulumi config set` edits `Pulumi.dev.yaml`. Commit that change (or keep it uncommitted until the end of the day), because `pnpm images:push` refuses to run with uncommitted changes.

**2. Turn on data, wait**

```bash
pulumi config set dataEnabled true
pulumi preview             # expect: 7 to create
pulumi up                  # 10-15 minutes
```

**3. Turn on compute, wait for the service to be stable**

```bash
pulumi config set computeEnabled true
pulumi preview             # expect: 10 to create
pulumi up
aws ecs wait services-stable --cluster minitickets-dev --services minitickets-dev-api
```

The wait returns when one task is RUNNING and the deployment is done (usually 1-3 minutes). If it fails, look at the stopped reason and the logs (step 5).

**4. Run the migrations, expect exit code 0**

```bash
cd .. && pnpm infra:migrate && cd infra
```

Expect `Exit code: 0` and `migrations applied` in the log lines.

**5. Verify**

```bash
# a. Service: 1 running, deployment completed
aws ecs describe-services --cluster minitickets-dev --services minitickets-dev-api \
  --query 'services[0].{status:status,running:runningCount,desired:desiredCount,rollout:deployments[0].rolloutState}'

# b. Task: RUNNING and HEALTHY, on Spot, ECS Exec agent running
TASK=$(aws ecs list-tasks --cluster minitickets-dev --service-name minitickets-dev-api --query 'taskArns[0]' --output text)
aws ecs describe-tasks --cluster minitickets-dev --tasks "$TASK" \
  --query 'tasks[0].{status:lastStatus,health:healthStatus,capacity:capacityProviderName,exec:containers[0].managedAgents[0].lastStatus}'

# c. Logs: expect a "Server listening at http://...:4000" line and no "Invalid ..." errors
aws logs tail /minitickets/dev/api --since 30m

# d. ECS Exec (needs: brew install --cask session-manager-plugin), then call /ready from inside
aws ecs execute-command --cluster minitickets-dev --task "$TASK" --container api --interactive --command "sh"
#    inside the container shell:
node -e "fetch('http://localhost:4000/ready').then(async (r) => console.log(r.status, await r.text()))"
#    expect: 200 {"status":"ready"}   (Postgres and Valkey both answered)
exit
```

**6. Turn off compute and data, confirm only those are deleted**

```bash
pulumi config set computeEnabled false
pulumi config set dataEnabled false
pulumi preview             # expect: 17 to delete, 32 unchanged. Nothing else!
pulumi up
```

Turn compute off **first** (or both together, as above). Turning only data off while compute is on is refused by the program.

## 8. Interview questions

1. **Cluster vs service vs task vs task definition?** The task definition is the recipe. A task is one running copy of it. A service keeps N tasks running and replaces failed ones. A cluster is the group they belong to.
2. **Execution role vs task role?** The execution role is used by ECS to start the task: pull the image, read secrets, write logs. The task role is what the application code inside the container can do with AWS.
3. **What is the confused deputy problem and how do you prevent it here?** A trusted service is tricked into using its access for someone else. An `aws:SourceAccount` condition in the trust policy makes ECS use our role only when acting for our account.
4. **Fargate vs EC2 launch type?** Fargate: you set CPU and memory per task and AWS manages the machines. EC2: you run and patch your own instances, which can be cheaper at large, steady scale.
5. **When is Fargate Spot a good choice?** For work that can be interrupted with 2 minutes' warning: dev, batch jobs, extra capacity on top of on-demand. Not as the only capacity for user-facing production.
6. **Why not set `rejectUnauthorized: false` for RDS?** It keeps encryption but drops identity checking, so a man-in-the-middle could impersonate the database and capture credentials. Trust the RDS CA instead.
7. **What does the deployment circuit breaker do?** It stops a deployment whose new tasks keep failing and rolls back to the last working revision.
8. **How do you run database migrations on ECS?** As a one-off task from the same task definition with a command override, before (or separately from) the service rollout, so only one process migrates.

## 9. Check yourself

1. The task stops before any log line appears, with "unable to pull secrets". Which role do you check, and which policy in it?
2. You set the health check to `/ready`. RDS reboots for 2 minutes during maintenance. What does ECS do to your api, and why is that worse than doing nothing?
3. A teammate moves the api tasks into the private subnets "for security" without changing anything else. What happens on the next deployment, and what would you need to add?
