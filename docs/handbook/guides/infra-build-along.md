# The infra build-along

History: see [CHANGELOG.md](../CHANGELOG.md) or run `pnpm docs:history`

**In one line:** our app runs on my laptop (web, api, Postgres, Redis in Docker). Now we move it to
AWS, one piece at a time, and every piece is a real line of our code that you can find in the AWS
console.

**Who this is for:** you built the app, so you know it well. You don't know AWS yet, and the
`infra/` folder (about 4,000 lines) feels too big. After this guide you should be able to picture
how everything connects, find every setting from the code in the AWS console, explain it in an
interview, and later design and debug it yourself.

**How to read it:** one chapter at a time, 10-15 minutes each. Keep
[the explorer](infra-explorer.html) open next to it (download the repo and double-click the file;
GitHub only shows its source). The explorer draws the same city map, and its Next button grows the
map chapter by chapter, just like this guide.

| Chapter | It adds | Status |
| ------- | ------- | ------ |
| [0. The app on my laptop](#chapter-0-the-app-on-my-laptop) | What we are moving, and the city we will build | written |
| [1. AWS basics](#chapter-1-aws-basics) | The land (account), the country (region), the districts (AZs), name plates (tags), the planner (Pulumi), the treasurer (budget) | written |
| [2. The network (VPC)](#chapter-2-the-network-vpc) | The city wall, neighborhoods, the city gate and road signs | written |
| [Map so far](#map-so-far) | Everything up to here, with the real console names | written |
| [Chapter index](#chapter-index) | Chapters 3-24, including explain-only alternatives | written |

Every chapter has the same 13 parts: last time and the problem, in the city, the picture, how it
really works, our code, how it connects, code → console → CLI, a console mission, follow one thing,
when it breaks, the small details, interview, and check yourself.

**Before you run any command in this guide:** open a terminal and type
`export AWS_PROFILE=ticketlite` and `export AWS_DEFAULT_REGION=us-east-1` once. The first one says
which AWS login to use, the second which region (chapter 1 explains both). Every `aws` command
below assumes them. Every command here only **reads**. The only command that changes AWS is
`pulumi up`, and in this project the owner runs it, never a guide.

---

## The city: one map for everything

AWS is a city. This whole guide uses this one comparison and no other, so the words always mean
the same thing. Here is the whole city on day one, including the parts we build later.

| AWS word | In the city | Chapter |
| -------- | ----------- | ------- |
| **Region** | The country | 1 |
| **Availability zone (AZ)** | A separate district with its own power supply | 1 |
| **VPC** | Your private gated city | 2 |
| **Subnet** | A neighborhood. Public = on the main road. Private = behind walls | 2 |
| **Internet gateway** | The city gate | 2 |
| **Route table** | Road signs | 2 |
| **Security group** | A guard at each building door, with a guest list | 3 |
| **ECR** | The warehouse of packed apps | 7 |
| **ECS task** | A worker | 8 |
| **ECS service** | The manager who keeps enough workers on shift | 8 |
| **CloudWatch** | The city's diary | 8 |
| **IAM role** | A staff badge | 9 |
| **Trust policy** | Who may wear the badge | 9 |
| **Secrets Manager** | A locked key safe | 6 |
| **ALB** | The reception desk | 10 |
| **Target group** | A department's on-duty staff list | 10 |

A few more words, in the same city (we add a row whenever a chapter needs one):

| AWS word | In the city | Chapter |
| -------- | ----------- | ------- |
| **AWS account** | The deed to your land: everything you build is registered to it, and the bills go to it | 1 |
| **Tags** | Name plates screwed onto every building | 1 |
| **Pulumi** (our tool) | The city planner: a blueprint (our code) and a record book of what was built (the state) | 1 |
| **AWS Budgets** | The treasurer, who writes to you when spending gets high | 1 |
| **CIDR block** | The range of house numbers a city or a neighborhood may use | 2 |
| **NAT gateway** | A one-way exit door: people from inside can go out, nobody can come in (we don't build one) | 2 |
| **Network ACL** | A checkpoint at a neighborhood's edge (AWS gives a default one that lets everyone through) | 2 |
| **Main route table** | The default road sign AWS puts up for any neighborhood that has no sign of its own | 2 |

---

## Chapter 0: The app on my laptop

### 1. Last time and the problem

**Last time:** nothing yet. You built minitickets. It runs on your laptop: a web app, an api, a
Postgres database and Redis, started with Docker. It works.

**The problem:** it only works *on your laptop*. Close the lid and minitickets is gone. Nobody else
can open it. We want it on the internet, always on, safe and cheap. AWS can do all of that, but it
has hundreds of services, and our `infra/` folder is already about 4,000 lines. Where do you start?

You start with what you already have: list what runs today, and what each piece needs. Then you
move one piece at a time.

### 2. In the city

Right now the app lives in your own house (the laptop), not in the city. Everything is in one room:
the pieces talk to each other directly, there are no walls, no guards, no badges, no locked safe.
You are the owner of the house, so every door is open to you.

AWS is a city (see [the city table](#the-city-one-map-for-everything)). Moving into it means each
piece of the app gets its own place: the database moves to a neighborhood behind walls, the web app
and the api become workers, a reception desk greets visitors, guards check every door, and
passwords go into a locked key safe.

### 3. The picture

What runs on the laptop today, with `pnpm app:up` (everything in Docker, the closest thing to AWS):

```mermaid
flowchart LR
    browser["Your browser"]
    subgraph laptop["My laptop: Docker"]
        web["web container<br/>Next.js :3000<br/>(localhost:3100)"]
        api["api container<br/>Fastify + tRPC :4000<br/>(localhost:4100)"]
        migrate["migrate container<br/>runs once, then stops"]
        pg["postgres container<br/>Postgres 17.6 :5432"]
        redis["redis container<br/>Redis 7.4.5 :6379"]
    end
    aws["AWS: the city<br/>(chapters 1-15)"]
    browser -->|"pages"| web
    browser -->|"/trpc calls"| api
    web -->|"http://api:4000"| api
    api -->|"postgres:5432"| pg
    api -->|"redis:6379"| redis
    migrate -->|"SQL migrations"| pg
    laptop -.->|"we move it,<br/>one piece at a time"| aws
    classDef new fill:#fff1a8,stroke:#8a6d00,stroke-width:2px,color:#1f1f1f
    classDef planned fill:#ffffff,stroke:#9a9384,stroke-dasharray:5 4,color:#6b6559
    class web,api,migrate,pg,redis new
    class aws planned
```

The city we will build (all of it is still a plan, dashed). This is the growing map: from
chapter 1 on, each chapter turns some of it solid.

```mermaid
flowchart LR
    visitors["Visitors"]
    subgraph city["AWS"]
        desk["Reception desk<br/>ALB (ch 10)"]
        web["web workers<br/>ECS (ch 8)"]
        api["api workers<br/>ECS (ch 8)"]
        db["Postgres<br/>RDS (ch 5)"]
        cache["Valkey cache<br/>ElastiCache (ch 5)"]
        safe["Key safe<br/>Secrets Manager (ch 6)"]
        store["Warehouse<br/>ECR (ch 7)"]
        diary["Diary<br/>CloudWatch (ch 8)"]
        badges["Badges<br/>IAM roles (ch 9)"]
    end
    visitors --> desk
    desk --> web
    desk --> api
    web --> api
    api --> db
    api --> cache
    safe -.-> api
    store -.-> web
    classDef planned fill:#ffffff,stroke:#9a9384,stroke-dasharray:5 4,color:#6b6559
    class desk,web,api,db,cache,safe,store,diary,badges planned
```

### 4. How it really works

Here is what happens when you open `http://localhost:3100/events` with `pnpm app:up` running:

1. Your browser asks the **web** container for the page.
2. The web server needs the events list, so it calls the **api** at `http://api:4000`. Inside
   Docker, `api` is a name: Docker turns that name into the api container's address.
3. The api first looks in **Redis**. If the list is there and fresh (younger than 30 seconds), it
   answers at once.
4. If not, the api asks **Postgres**, stores the answer in Redis, and answers.
5. The web server builds the HTML and sends it to your browser.
6. When you click around, your browser calls the api **directly** at `localhost:4100/trpc/...`.

Each piece needs a few things to start. This is the list we must recreate on AWS:

| Piece | What it does | What it needs to start |
| ----- | ------------ | ---------------------- |
| **web** (Next.js) | Builds the pages | The api's address (`API_INTERNAL_URL`), and `REVALIDATE_SECRET` |
| **api** (Fastify + tRPC) | Holds the rules, talks to the data stores (Postgres and Redis) | Postgres, Redis, the web address for CORS (`WEB_ORIGIN`; CORS is the rule that tells a browser which website may call the api), optional pair `WEB_INTERNAL_URL` + `REVALIDATE_SECRET` |
| **Postgres** | Keeps users and events forever | Disk space (a Docker volume: a folder Docker keeps outside the container, so data survives a restart), a user and a password |
| **Redis** | Keeps sessions and a 30-second events cache | Disk space, a port |
| **migrate** | Creates and updates the tables, once | Postgres, before the api starts |

The api checks its settings when it starts and stops at once if one is missing (`apps/api/src/config/env.ts`
→ `EnvSchema`). That will save us on AWS too: a missing setting shows up as a clear message in the
logs, not as a strange bug later.

### 5. Our code

| File | Function or part | What it decides |
| ---- | ---------------- | --------------- |
| `docker-compose.yml` | services `postgres`, `redis`, `migrate`, `api`, `web` | What runs locally, which ports, which versions |
| `apps/api/src/config/env.ts` | `EnvSchema` | Every setting the api needs (checked at start) |
| `apps/api/src/config/database.ts` | `DatabaseEnvSchema` | The database address: one URL locally, five parts on AWS |
| `apps/api/Dockerfile`, `apps/web/Dockerfile` | how each image is built | The same images run locally and on AWS |
| `infra/index.ts` | the whole file | Wires every AWS layer together, top to bottom |

The key settings, in plain words:

- `docker-compose.yml` → `postgres:17.6`: the exact Postgres version on the laptop.
- `docker-compose.yml` → `redis:7.4.5`: the exact Redis version.
- `docker-compose.yml` → `4100:4000`: "port 4100 on my laptop goes to port 4000 in the api container".
- `docker-compose.yml` → `http://api:4000`: the web server reaches the api by its name, not by an address.
- `apps/api/.env.example` → `DATABASE_URL`: the whole database address and password in one line.

**The infra folder, tamed.** Every file in `infra/src/` is one layer, and one chapter of this guide.
`infra/index.ts` calls them in order, and you can read it top to bottom:

| Chapter | File(s) in `infra/src/` | Entry function |
| ------- | ----------------------- | -------------- |
| 1 | `tags.ts`, `budget.ts` | `tagsFor`, `createBudget` |
| 2 | `network.ts` | `createNetwork` |
| 3 | `security.ts` | `createSecurityGroups` |
| 5 | `data/postgres.ts`, `data/cache.ts` | `createPostgres`, `createCache` |
| 6 | `data/secrets.ts`, `compute/revalidate-secret.ts` | `createSecrets`, `createRevalidateSecret` |
| 7 | `registry.ts` | `createRegistry` |
| 8 | `compute/cluster.ts`, `compute/task.ts`, `compute/service.ts`, `compute/logs.ts`, web twins | `createCluster`, `createApiTask`, `createApiService`, `createLogs` |
| 9 | `compute/iam.ts`, `compute/web-iam.ts` | `createIamRoles`, `createWebIamRole` |
| 10 | `entry/alb.ts`, `entry/target-groups.ts`, `entry/https-listener.ts`, `certificate.ts` | `createAlb`, `createTargetGroups`, `createHttpsListener`, `createCertificate` |
| 11 | `compute/service-connect.ts` | `createServiceConnect` |
| 12 | `entry/cdn.ts`, `entry/listener.ts`, `entry/origin-secret.ts` | `createCdn`, `createListener`, `createOriginSecret` |
| 13 | `cicd.ts`, `release.ts`, `compute/migration-task.ts` | `createCicd`, `createRelease`, `createMigrationTask` |

### 6. How it connects

**Laptop → AWS.** Every piece on the laptop has a twin on AWS. Don't worry about the AWS names yet:
each one gets its own chapter, and the city column already tells you what it is. (**CD**, continuous
deployment, is our automatic pipeline that puts a new version live on AWS; chapter 13.)

| On my laptop | On AWS (real name) | City | Chapter |
| ------------ | ------------------ | ---- | ------- |
| Postgres 17.6 in Docker | RDS Postgres 17, `minitickets-dev-db`, in the private neighborhoods | Behind the walls | 5 |
| Redis 7.4.5 in Docker | ElastiCache Valkey 8.2, `minitickets-dev-valkey` (Valkey speaks the same language as Redis) | Behind the walls | 5 |
| Passwords in `.env` files | Secrets Manager (and an RDS-managed password) | Locked key safe | 6 |
| Images built by `docker compose` | ECR repositories `minitickets-dev-api`, `minitickets-dev-web` | Warehouse | 7 |
| api container | ECS service `minitickets-dev-api` and its task | Manager + worker | 8 |
| web container | ECS service `minitickets-dev-web` and its task | Manager + worker | 8 |
| Terminal output (logs) | CloudWatch log groups `/minitickets/dev/api`, `/minitickets/dev/web` | Diary | 8 |
| You, with every permission | IAM roles, one per job | Badges | 9 |
| `localhost:3100` in the browser | The ALB with HTTPS on `minitickets.theversehub.in` (today's committed setting) | Reception desk | 10 |
| Docker's names `api` and `web` | Service Connect names `http://api:4000`, `http://web:3000` | (named in ch 11) | 11 |
| — | CloudFront, only when `cdnEnabled` is true (today it is false) | Named in ch 12 | 12 |
| The `migrate` container | The migration task `minitickets-dev-migrate`, run by CD | Named in ch 13 | 13 |
| Docker's private network | VPC, subnets, route tables (ch 2) and security groups (ch 3) | The city, its roads and guards | 2, 3 |

**Reach / Allowed / Password.** Every connection on AWS must pass three separate checks. You will
see these three words in every chapter:

- **Reach:** can the bytes get there at all? (roads, road signs, guards at the door)
- **Allowed:** does AWS's permission system, IAM, say yes? (badges)
- **Password:** does the target accept the credentials? (keys from the key safe)

On the laptop, for the api talking to Postgres: **Reach** is Docker's network (the name `postgres`
and port 5432). **Allowed** does not exist: there is no IAM on a laptop. **Password** is the user and
password inside `DATABASE_URL`. On AWS each one gets its own separate piece, which is why AWS feels
bigger: chapter 2 and 3 build Reach, chapter 9 builds Allowed, chapter 6 builds Password.
More: [aws-foundations, chapter 3](../aws-foundations.md#3-the-three-questions-reach-allowed-password).

### 7. Code → Console → CLI

The "console" on the laptop is Docker Desktop. The AWS console comes in chapter 1.

| Setting | Code (file → value) | Where you see it on the laptop | Command | Its AWS twin |
| ------- | ------------------- | ------------------------------ | ------- | ------------ |
| api port | `docker-compose.yml` → `4100:4000` | Docker Desktop → Containers → `api` → column "Port(s)" | `docker compose ps` | Target group port 4000 (ch 10) |
| Postgres version | `docker-compose.yml` → `postgres:17.6` | Docker Desktop → Images | `docker compose exec postgres postgres --version` | `infra/src/data/postgres.ts` → `engineVersion` (ch 5) |
| Database address | `apps/api/.env.example` → `DATABASE_URL` | your `apps/api/.env` | `grep DATABASE_URL apps/api/.env` | `DB_HOST` and friends in `infra/src/compute/task.ts` → `createApiTask` (ch 8) |
| api health | `apps/api/src/app.ts` → `/health` | `http://localhost:4100/health` in the browser | `curl localhost:4100/health` | The target group health check (ch 10) |

### 8. Console mission

1. Start the app with `pnpm app:up`. Open Docker Desktop → Containers. Count the containers that
   are running. (`migrate` shows as exited: it ran once and stopped. That is correct.)
2. Open the [explorer](infra-explorer.html). It opens at chapter 0. Look at the faint pencil
   outlines: that is the city we will build. Click one of the five laptop boxes to see its AWS twin.
3. Sign in to the [AWS console](https://console.aws.amazon.com/). Top right, find the region
   selector. It should say **N. Virginia** (`us-east-1`). If not, switch to it.

**Question to answer by looking (in the explorer):** which two laptop pieces will live behind the
inner wall, in the private neighborhoods?

### 9. Follow one thing: the database address

Let's follow one setting from the laptop to AWS: where is the database?

1. **Laptop, `pnpm dev`:** `apps/api/.env` holds `DATABASE_URL=postgres://minitickets:minitickets@localhost:5432/minitickets`.
   Address, port, user and password, all in one line, in plain text.
2. **Laptop, `pnpm app:up`:** `docker-compose.yml` gives the api container the same kind of URL, but
   the host is `postgres` (the container's name), not `localhost`.
3. **The api code:** `apps/api/src/config/database.ts` → `DatabaseEnvSchema` accepts either that one
   URL, or five separate parts: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`. Never both.
4. **AWS:** `infra/src/compute/task.ts` → `createApiTask` sets `DB_HOST` to the RDS address and
   `DB_PORT`, `DB_NAME` as plain values. `DB_USER` and `DB_PASSWORD` are **not** in the code: the
   task definition (the settings ECS uses to start the api: image, port, settings; chapter 8) only
   names the key safe (a `valueFrom` pointing at a Secrets Manager secret), and
   ECS fetches the real values when the task starts.
5. **AWS console** (needs the environment on): ECS → Task definitions → `minitickets-dev-api` →
   newest revision → container `api` → "Environment variables". `DB_HOST` shows its value;
   `DB_PASSWORD` shows only where it comes from.

Why it changes: on the laptop a password in a file is fine. On AWS, a password in code or in a task
definition would be readable by anyone who can read those. So the same app reads the same setting in
two ways. That is chapters 5, 6 and 9 in one sentence.

### 10. When it breaks

| Symptom | Where to look | Usual fix |
| ------- | ------------- | --------- |
| The api stops at start: "Invalid environment variables" | The api's own output (`docker compose logs api`) | A setting is missing. Copy `apps/api/.env.example` to `apps/api/.env` |
| The api refuses `REVALIDATE_SECRET=CHANGE-ME` | Same | Make a real one: `openssl rand -hex 32`, the same value for web and api |
| "port is already allocated" | `docker compose up` output | Another program uses the port. Stop it, or change the host side of the port |
| The web page loads, the events list fails | Browser DevTools → Network | The api is not running or its address is wrong |

On AWS the same kinds of failure look different, and the three questions sort them: a **timeout**
is almost always Reach, **AccessDenied** (the error AWS gives when IAM says no) is Allowed,
**authentication failed** is Password.

### 11. The small details

- **`localhost` means "this machine".** Inside a container, `localhost` is the container itself.
  That's why containers call each other by name (`api`, `postgres`). On AWS every task is its own
  small machine, so the same rule holds, and the names come from Service Connect (chapter 11).
- **`0.0.0.0` vs `127.0.0.1`.** `apps/api/src/config/env.ts` → `HOST` defaults to `127.0.0.1`, which only accepts calls
  from the same machine. In a container (and on AWS) it must be `0.0.0.0`, "accept calls from
  outside".
- **Versions differ a little.** Laptop: Postgres 17.6, Redis 7.4.5. AWS: Postgres "17" (AWS picks
  the minor version) and Valkey 8.2. Valkey is an open-source copy of Redis that speaks the same
  language, so our Redis client works with it.
- **TLS** (the encryption behind `https`). Locally Redis is `redis://`, plain. On AWS it is
  `rediss://` (two s's): encrypted.

### 12. Interview

**Say it in 30 seconds:** "Locally the app is four containers: a Next.js web app, a Fastify tRPC
api, Postgres and Redis, plus a one-off migration job. Moving to AWS, each becomes a managed piece:
web and api run as ECS tasks, Postgres becomes RDS, Redis becomes ElastiCache Valkey, passwords move
into Secrets Manager, and a load balancer becomes the single entry point. The network, firewalls and
permissions that Docker gave us for free must now be built on purpose."

**Likely questions:**

- *What changes when you move a docker-compose app to AWS?* The pieces stop sharing one machine. So
  you must build the network between them, a firewall for each, a way to pass secrets, and
  permissions for each piece. The app code barely changes.
- *Why not run docker compose on one EC2 server (a plain rented virtual machine)?* You could, and it is cheaper and simpler. But one
  machine is one point of failure, you patch it yourself, and the database has no managed backups.
  We chose managed services so each piece can fail, scale and be backed up on its own.
- *What are the three checks for any connection on AWS?* Reach (network), Allowed (IAM), Password
  (credentials). Each can fail on its own, with a different symptom.

### 13. Check yourself

1. Which laptop piece runs once and then stops, and what does it become on AWS?
2. Why does the web server call `http://api:4000`, while your browser calls `localhost:4100`?
3. For the api → Redis connection on the laptop, what is the answer to Reach, Allowed and Password?

**Next:** before we build anything on AWS, we need land to build on, a country, a way to build that
isn't clicking around, and a treasurer who warns us about the bill.

---

## Chapter 1: AWS basics

### 1. Last time and the problem

**Last time:** the app is five containers on the laptop. Each has a twin on AWS. Every connection on
AWS must pass three checks: Reach, Allowed, Password.

**The problem:** we can't build anything yet. Whose AWS is it? Where in the world will it run? If one
data centre burns, does the app die? How do we build dozens of pieces (78 in the stack today, with
everything on) without clicking each one, and without forgetting what we clicked? And how do we avoid
a surprise bill?

### 2. In the city

- The **AWS account** is the deed to your land. Everything you build is registered to it, and the
  bills go to it.
- A **region** is the country. Ours is `us-east-1` (North Virginia, USA). Things built in one country
  are invisible from another.
- An **availability zone (AZ)** is a separate district in that country with its own power supply. If
  one district loses power, the others keep going. We use two districts.
- **Tags** are name plates screwed onto every building: who owns it, which project, who built it.
- **Pulumi** is the city planner. It has a blueprint (our TypeScript code) and a record book of
  everything it has built (the **state**).
- **AWS Budgets** is the treasurer, who writes to you when spending gets close to a limit.

### 3. The picture

The growing map (new parts highlighted yellow, the plan dashed):

```mermaid
flowchart TB
    internet["The internet"]
    subgraph account["Your AWS account: the deed"]
        budget["Budget minitickets-dev-monthly-cost<br/>$20 a month, emails at 25 / 50 / 100%"]
        subgraph region["Region us-east-1: the country"]
            az1["District us-east-1a<br/>AZ ID use1-az1"]
            az2["District us-east-1b<br/>AZ ID use1-az2"]
            city["The city: VPC<br/>chapter 2"]
            app["Guards, workers, data,<br/>reception desk: chapters 3-13"]
        end
    end
    internet -.-> city
    classDef new fill:#fff1a8,stroke:#8a6d00,stroke-width:2px,color:#1f1f1f
    classDef planned fill:#ffffff,stroke:#9a9384,stroke-dasharray:5 4,color:#6b6559
    class budget,az1,az2 new
    class city,app planned
```

How it works inside: how Pulumi turns code into AWS resources.

```mermaid
flowchart LR
    code["Blueprint<br/>infra/*.ts"] --> preview["pulumi preview<br/>what WOULD change"]
    preview --> up["pulumi up<br/>make the changes"]
    up --> aws["AWS<br/>creates the resources"]
    aws -->|"real IDs, e.g. vpc-00b5…"| state["Record book<br/>state in Pulumi Cloud"]
    state --> outputs["Stack outputs<br/>pulumi stack output vpcId"]
    state -.->|"compared with the code<br/>on the next preview"| preview
```

### 4. How it really works

**1. The account: who you are.** Every AWS request is signed by someone. On the laptop that is your
CLI profile `ticketlite` (`export AWS_PROFILE=ticketlite`). In CD it is a role that GitHub borrows
(a role is an AWS identity made for one job: chapters 9 and 13). The account has a 12-digit number.
It is not a password, but don't paste it in public.

**2. Three kinds of places.** Some things exist once for the whole account (**global**: IAM
permissions, the budget, CloudFront). Most live in one region (**regional**: the VPC, the containers
(ECS), the database (RDS), the image warehouse (ECR), Secrets Manager). A few live in one district
(**zonal**: a subnet, a database instance, a running task). If
you open the console in the wrong region, our VPC is simply not there. Nothing was deleted; you are
looking at the wrong country.

**3. Two districts.** `infra/src/network.ts` → `createNetwork` asks AWS "which AZs are available in
this region?" and keeps the first two. In our account those are `us-east-1a` and `us-east-1b`. The
name (`us-east-1a`) is a label for *your* account: AWS shuffles the names per account. The real,
shared name is the **AZ ID**: ours are `use1-az1` and `use1-az2`.

**4. Pulumi, step by step.** Pulumi is our infrastructure-as-code tool: we describe the AWS pieces in
TypeScript, and Pulumi makes AWS match.

1. **Code.** `infra/index.ts` calls one function per layer, for example `createNetwork()`.
2. **Preview.** `pulumi preview` runs the code, compares the result with the **state** (the record
   book), and prints the plan: `+ create`, `~ update`, `- delete`, `+- replace` (delete and create
   again: watch for this one, it can lose data). Nothing changes yet.
3. **Up.** `pulumi up` shows the same plan, asks "yes?", then calls AWS for each change, in the right
   order: a subnet waits for its VPC because it uses the VPC's ID.
4. **State.** AWS answers with real IDs (like `vpc-00b5d32f044694518`). Pulumi writes them into the
   state. Ours is stored in Pulumi Cloud, which also **locks** it during an update, so two `pulumi up`
   runs can't collide.
5. **Outputs.** Values that `infra/index.ts` exports (`export const vpcId`) become **stack outputs**.
   `pulumi stack output vpcId` prints one. Scripts and CD read them.

Our **stack** (one copy of the whole setup) is called `dev`. Its settings live in
`infra/Pulumi.dev.yaml`.

**5. Names and tags.** Every name starts with `minitickets-dev-` (project, then environment), so
you can spot our things in any list. `infra/src/tags.ts` → `tagsFor` adds four tags to almost every
resource: `Project=minitickets`, `Env=dev`, `ManagedBy=pulumi`, and `Name=<the name>`. The console
shows the `Name` tag as the title; without it you would only see IDs. (Pulumi also names resources
itself: if a resource has a `name` field we leave empty, Pulumi adds a random suffix. That's why our
code sets `name:` on things like roles and services: the console name is exactly the one in the code.)

**6. The on/off switches, and what costs money.** Some parts are billed every hour they exist, used
or not. So `infra/index.ts` has switches, set in the committed `infra/Pulumi.dev.yaml`:

| Switch | Turns on | About per hour | Today (committed) |
| ------ | -------- | -------------- | ----------------- |
| always on | network, security groups, budget, ECR, the roles GitHub uses to deploy (ch 13), the note of which version is deployed (an SSM parameter, ch 13), the HTTPS certificate (ch 10) | ~$0 (ECR: cents a month) | on |
| `dataEnabled` | RDS Postgres, Valkey, secrets | ~$0.033 | `true` |
| `computeEnabled` | the cluster, the api service and its roles, the migration task, logs | ~$0.008 | `true` |
| `entryEnabled` | the ALB, the web service and its role, Service Connect | ~$0.04 | `true` |
| `cdnEnabled` | CloudFront in front of the ALB, instead of HTTPS on our own domain | ~$0 | `false` |

Everything on is about $0.08 an hour, about $2 a day. (Numbers from the
[cost story](../infra-story.md#the-cost-story): approximate `us-east-1` prices from the step docs,
not measured on a bill.) The rules: compute needs data, entry needs data and compute; if not,
`infra/index.ts` stops with a clear `RunError` message (Pulumi's way to stop a run with just that
message). To flip a switch: edit
`infra/Pulumi.dev.yaml`, commit, push, approve the CD deploy job. Never `pulumi up` from the laptop
with uncommitted switches: the next CD run applies the committed file again and undoes it.

**7. The budget: the treasurer's warning.** `infra/src/budget.ts` → `createBudget` creates one monthly cost
budget named `minitickets-dev-monthly-cost`: $20 a month. It emails `alertEmail` when the real spend
passes 25%, 50% and 100%, and when AWS *forecasts* the month will pass 100%. It only warns: it never
stops anything. `includeCredit: false` means AWS credits don't hide the real cost: you see what the
project would cost without them.

### 5. Our code

| File → function | What it does |
| --------------- | ------------ |
| `infra/Pulumi.yaml` → `minitickets` | The project name and language (Node.js) |
| `infra/Pulumi.dev.yaml` → `aws:region` | The `dev` stack's settings: region, switches, encrypted email |
| `infra/src/tags.ts` → `tagsFor` | The four tags for every resource |
| `infra/src/network.ts` → `getAvailabilityZonesOutput` | Asks for the AZs, keeps the first two (`azNames`) |
| `infra/src/budget.ts` → `createBudget` | The $20 budget and its four alerts |
| `infra/index.ts` → `dataEnabled` | Reads the switches and calls each layer in order |

The key settings, in plain words:

- `infra/Pulumi.dev.yaml` → `aws:region`: everything goes to `us-east-1`.
- `infra/src/tags.ts` → `commonTags`: `Project=minitickets`, `Env=dev`, `ManagedBy=pulumi`.
- `infra/src/network.ts` → `slice(0, 2)`: two districts, the minimum an ALB (the load balancer) and an
  RDS subnet group (the list of subnets a database may use) accept. Both come in later chapters.
- `infra/src/budget.ts` → `limitAmount`: `"20"` dollars a month.
- `infra/src/budget.ts` → `includeCredit`: `false`, so credits don't hide the cost.
- `infra/Pulumi.dev.yaml` → `minitickets:alertEmail`: stored as `secure:` text, encrypted by Pulumi.

### 6. How it connects

- **Needs from chapter 0:** the list of pieces to move. Nothing in AWS yet.
- **Gives to later chapters:** the region and the two AZs (chapter 2 puts one public and one private
  neighborhood in each district), the `minitickets-dev-` names and tags (every chapter), and the
  switches, which decide whether chapters 5-12 exist on AWS right now.
- **Reach:** a wrong region looks like a Reach problem ("not found"), but it is just the wrong
  country. **Allowed:** Pulumi can only build what your login is allowed to build. Locally that is
  your profile's IAM permissions; in CD it is the deploy role (chapter 13). **Password:** none here.

### 7. Code → Console → CLI

| Setting | Code (file → exact value) | Console: click path → where the value appears | CLI |
| ------- | ------------------------- | --------------------------------------------- | --- |
| Region | `infra/Pulumi.dev.yaml` → `aws:region: us-east-1` | Top bar → region selector shows **N. Virginia** (`us-east-1`) | `pulumi config get aws:region` |
| Account | (none: your login decides) | Top right, your account name → the menu shows the **Account ID** | `aws sts get-caller-identity` |
| Two AZs | `infra/src/network.ts` → `slice(0, 2)` | VPC → Subnets → columns **Availability Zone** (`us-east-1a`, `us-east-1b`) and **Availability Zone ID** (`use1-az1`, `use1-az2`) | `aws ec2 describe-availability-zones --output table` |
| Tags | `infra/src/tags.ts` → `commonTags` | Any resource → **Tags** tab: `Project`, `Env`, `ManagedBy`, `Name` | `aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=minitickets` |
| Stack and its state | `infra/Pulumi.dev.yaml` (stack `dev`) | Pulumi Cloud (run `pulumi console`) → stack `dev` → **Resources** tab | `pulumi stack --show-ids` (every resource with its AWS ID) |
| Switches | `infra/Pulumi.dev.yaml` → `minitickets:dataEnabled: "true"` | Not in AWS. You see the effect: RDS → Databases lists `minitickets-dev-db` only when it is on | `pulumi config` |
| Budget limit | `infra/src/budget.ts` → `limitAmount` = `"20"` | Billing and Cost Management → Budgets → `minitickets-dev-monthly-cost` → the amount **$20.00** | `aws budgets describe-budget --account-id <id> --budget-name minitickets-dev-monthly-cost` |
| Budget alerts | `infra/src/budget.ts` → `notification` (25, 50, 100 actual; 100 forecasted) | Same page → the **Alerts** section, one row per threshold | `aws budgets describe-notifications-for-budget --account-id <id> --budget-name minitickets-dev-monthly-cost` |
| Credits ignored | `infra/src/budget.ts` → `includeCredit` = `false` | The budget's settings (I am not sure of the exact console label; the CLI field is `CostTypes.IncludeCredit`) | `aws budgets describe-budget ...` → `CostTypes` |

`<id>` is your account ID: `aws sts get-caller-identity --query Account --output text`.

### 8. Console mission

1. **Tag Editor.** In the console search bar type "Tag Editor" (it lives in **Resource Groups &
   Tag Editor**). Regions: `us-east-1`. Resource types: "All supported resource types". Tags: key
   `Project`, value `minitickets`. Click **Search resources**. You see every tagged piece of ours in
   one list, with its Name.
2. **Pulumi Cloud.** In `infra/`, run `pulumi console`. It opens the `dev` stack in the browser.
   Open the **Resources** tab: every resource Pulumi is responsible for.
3. **Budgets.** Billing and Cost Management → Budgets → `minitickets-dev-monthly-cost`.

**Question to answer by looking:** Pulumi's resource count and Tag Editor's count are different.
Find two kinds of resources that are in one list but not the other, and say why. (Hint: what is
Pulumi's own bookkeeping, and what can't carry a tag?)

### 9. Follow one thing: the tag `Project=minitickets`

1. **Code:** `infra/src/tags.ts` → `commonTags` defines it once. `tagsFor` adds a `Name`.
2. **Every layer file** passes `tags: tagsFor("minitickets-dev-...")` to each resource, for example
   `infra/src/network.ts` → `createNetwork` for the VPC and subnets. The budget writes the same three
   tags by hand (`infra/src/budget.ts` → `createBudget`), without a Name.
3. **Pulumi state:** each resource records its tags; Pulumi Cloud → Resources → a resource shows them.
4. **AWS console:** the **Tags** tab of the VPC, a subnet, a route table…, and Tag Editor's search.
5. **Billing:** to split the bill by `Project`, a tag must first be **activated** in Billing and Cost
   Management → Cost allocation tags. AWS only counts it from then on, not backwards. I could not
   check whether ours is active (my AWS session had expired); look there.
6. **CLI:** `aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=minitickets`.

Why it matters: when something unknown costs money, the tag tells you whose it is. In an account
with ten projects, that is the only fast answer.

### 10. When it breaks

| Symptom | Where to look | Usual fix |
| ------- | ------------- | --------- |
| The console shows no VPC, no subnets, "nothing here" | The region selector | Switch to N. Virginia (`us-east-1`) |
| A CLI command says a resource doesn't exist, though Pulumi made it | Your region setting | `export AWS_DEFAULT_REGION=us-east-1` or add `--region us-east-1` |
| "Your session has expired. Please reauthenticate using 'aws login'" | The message itself | Run the login command it names, then retry |
| `pulumi up` stops: "Missing required configuration variable 'minitickets:alertEmail'" | `infra/Pulumi.dev.yaml` | `pulumi config set --secret alertEmail you@example.com` |
| `pulumi up` stops: "computeEnabled is true but dataEnabled is false…" | `infra/index.ts` → `RunError` | Turn on what the message names, or turn the other switch off |
| `pulumi up` fails because another update is running | Pulumi Cloud → stack → Updates | Wait: probably CD is deploying. Never cancel it |
| A budget email arrives | Billing → Bills, and Cost Explorer (AWS's page that breaks the bill down) by service | Find what is on; turn the switches off (commit, push, approve) |

### 11. The small details

- **AZ names are per account.** `us-east-1a` in your account may be another district than
  `us-east-1a` in mine. Compare AZ IDs (`use1-az1`), never names.
- **Billing is late.** Budget numbers are updated a few times a day, not live. A forgotten switch
  costs hours before the email comes. That's why the 25% alert exists.
- **The forecast alert** fires before the money is spent: AWS projects the month-end total.
- **Pulumi compares with its record book, not with AWS.** If someone clicks a change in the console,
  `pulumi preview` doesn't see it. `pulumi refresh` reads AWS and updates the record book first.
- **Secrets in config.** `alertEmail` is `secure:` in `infra/Pulumi.dev.yaml`: encrypted, safe to
  commit. Image tags are never committed there (CD sets them), so a committed file can't pin old code.
- **The budget price.** The [cost story](../infra-story.md#the-cost-story) counts it as $0. I have
  not checked AWS's current Budgets price list.

### 12. Interview

**Say it in 30 seconds:** "We run in one AWS account, in `us-east-1`, across two availability zones.
Everything is Pulumi TypeScript: one function per layer, wired in `index.ts`, previewed before every
change, with the state kept in Pulumi Cloud. Every resource is named `minitickets-dev-…` and tagged
by project and environment. The hourly-billed layers sit behind switches in the committed stack
config, and a $20 budget emails us at 25, 50 and 100%, plus a forecast alert."

**Likely questions:**

- *What is the difference between a region and an AZ?* A region is a geographic area. An AZ is one
  isolated group of data centres inside it, with its own power and network. Spreading over two AZs
  survives the loss of one.
- *Why infrastructure as code instead of the console?* It is reviewable, repeatable and can be torn
  down and rebuilt. The preview shows exactly what will change before anything does.
- *How do you stop a dev environment from costing too much?* Switches that delete the hourly-billed
  layers when not in use, a budget with early and forecast alerts, and tags to see who spends what.

### 13. Check yourself

1. You open the VPC console and see no `minitickets-dev-vpc`. Name the first thing you check.
2. Why do we compare AZ IDs, not AZ names, between two accounts?
3. `pulumi preview` shows `+-` next to the database. Why should you stop and read before typing yes?

**Next:** we own land, in a country, with two districts. But there is no city yet: no walls, no
neighborhoods, no gate. Nowhere for the app to live.

---

## Chapter 2: The network (VPC)

### 1. Last time and the problem

**Last time:** we have an account (our land), a region `us-east-1` (the country) and two AZs (the
districts). Pulumi builds from code and keeps a record book. A $20 budget watches the bill.

**The problem:** there is nowhere to put anything. A database, a container, a load balancer: each
needs an address in a network. We want one network that is ours alone, where the internet can reach
the reception desk but never the database.

### 2. In the city

We build our own **private gated city** (the VPC). Inside its wall, the land is split into
**neighborhoods** (subnets). Two are on the **main road** (public): visitors can come there. Two are
**behind walls** (private): the only way in is from inside the city. Each district gets one of each,
so if one district loses power, the other still has both.

The wall has one **city gate** (the internet gateway), the only way between the city and the outside
world. At each neighborhood's exit stands a **road sign** (a route table). The main-road sign says
"to the outside world: through the gate". The sign behind the walls says only "inside the city: this
way". There is no road from there to the gate.

So "public" is not a property of the neighborhood. It is only what its road sign says.

### 3. The picture

The growing map (new parts highlighted):

```mermaid
flowchart TB
    internet["The internet"]
    subgraph account["Your AWS account"]
        budget["Budget<br/>$20 a month"]
        subgraph region["Region us-east-1"]
            subgraph vpc["City wall: minitickets-dev-vpc 10.0.0.0/16"]
                igw["City gate<br/>minitickets-dev-igw"]
                prt["Road sign public-rt<br/>0.0.0.0/0 → gate"]
                vrt["Road sign private-rt<br/>local only"]
                subgraph aza["District us-east-1a"]
                    pub1["public-1<br/>10.0.0.0/24"]
                    priv1["private-1<br/>10.0.10.0/24"]
                end
                subgraph azb["District us-east-1b"]
                    pub2["public-2<br/>10.0.1.0/24"]
                    priv2["private-2<br/>10.0.11.0/24"]
                end
            end
            app["Guards, workers, data,<br/>reception desk: chapters 3-13"]
        end
    end
    internet <--> igw
    prt -->|"0.0.0.0/0"| igw
    pub1 --- prt
    pub2 --- prt
    priv1 --- vrt
    priv2 --- vrt
    classDef new fill:#fff1a8,stroke:#8a6d00,stroke-width:2px,color:#1f1f1f
    classDef built fill:#f3efe6,stroke:#5b4a3a,color:#1f1f1f
    classDef planned fill:#ffffff,stroke:#9a9384,stroke-dasharray:5 4,color:#6b6559
    class igw,prt,vrt,pub1,pub2,priv1,priv2 new
    class budget built
    class app planned
```

How it works inside: how a road sign picks a road. Network data travels in small pieces called
**packets**. Every packet leaving a neighborhood is checked against its sign, and **the most specific
matching line wins**.

```mermaid
flowchart TB
    pkt["A packet leaves public-1<br/>going to some address"] --> q{"Is the address<br/>inside 10.0.0.0/16?"}
    q -->|"yes: e.g. 10.0.10.25"| local["Route 10.0.0.0/16 → local<br/>stays inside the city"]
    q -->|"no: e.g. 52.94.0.10"| def{"Does the sign have<br/>0.0.0.0/0?"}
    def -->|"public-rt: yes"| gate["→ igw: out through the gate"]
    def -->|"private-rt: no"| drop["No road: the packet is dropped"]
```

### 4. How it really works

**1. The VPC and its house numbers.** A VPC is a private network that only we use. Every machine in
it gets an address. We use **IPv4** addresses, the classic kind: four numbers from 0 to 255, like
`10.0.0.5`. Inside the computer that is 32 **bits** (binary digits, 0 or 1), 8 per number.

We give the VPC a **CIDR block**: the range of addresses (house numbers) it may hand out. Ours is
`10.0.0.0/16`. The number after the slash says how many of the 32 bits are fixed: 16 fixed (the
first two numbers, `10.0`), 16 free, so 2^16 = 65,536 addresses: every address that starts with `10.0.`.

**2. Four neighborhoods.** Each subnet takes a smaller slice: `/24` means 24 bits fixed, 8 free,
256 addresses. Every subnet lives in exactly one AZ.

| Subnet (console Name) | CIDR | House numbers | AZ (ID) | Public IP on launch |
| --------------------- | ---- | ------------- | ------- | ------------------- |
| `minitickets-dev-public-1` | `10.0.0.0/24` | 10.0.0.0 – 10.0.0.255 | `us-east-1a` (`use1-az1`) | yes |
| `minitickets-dev-public-2` | `10.0.1.0/24` | 10.0.1.0 – 10.0.1.255 | `us-east-1b` (`use1-az2`) | yes |
| `minitickets-dev-private-1` | `10.0.10.0/24` | 10.0.10.0 – 10.0.10.255 | `us-east-1a` (`use1-az1`) | no |
| `minitickets-dev-private-2` | `10.0.11.0/24` | 10.0.11.0 – 10.0.11.255 | `us-east-1b` (`use1-az2`) | no |

The gap (0, 1 public; 10, 11 private) is on purpose: you can tell the kind from the number.

**3. The gate.** The internet gateway `minitickets-dev-igw` is attached to the VPC. It is the only way
between the VPC and the internet, in both directions. AWS runs it on many machines and not inside
one district, so losing a district does not close the gate. On its own it does nothing: a road sign
must point at it.

**4. The road signs.** A route table is a list of lines "addresses → where to send them". AWS adds
one line to every table by itself: `10.0.0.0/16 → local` (anything inside the city stays inside).

| Road sign (console Name) | Lines | Used by |
| ------------------------ | ----- | ------- |
| `minitickets-dev-public-rt` | `10.0.0.0/16 → local`, `0.0.0.0/0 → igw-038f7386d8ae5817d` | public-1, public-2 |
| `minitickets-dev-private-rt` | `10.0.0.0/16 → local` | private-1, private-2 |
| (no name) the main route table, made by AWS | `10.0.0.0/16 → local` | nobody (all four subnets have their own sign) |

`0.0.0.0/0` means "every address" (0 bits fixed). Because the most specific line wins, it only
catches what no other line matches: the whole internet.

**5. Associations.** A sign does nothing until a neighborhood is linked to it. That link is a
**route table association**. We make four: `minitickets-dev-public-rta-1`, `-2` and
`minitickets-dev-private-rta-1`, `-2`. A subnet with no association silently uses the main route
table.

**6. What "public" really means.** A thing in a public subnet is reachable from the internet only
when **all four** are true:

1. its subnet's sign has `0.0.0.0/0 → igw` (this chapter),
2. it has a public IP address (`mapPublicIpOnLaunch: true` hands one out; chapter 4),
3. a guard at its door lets the visitor in (security group; chapter 3),
4. something is actually listening.

Right now 1 is true for public-1 and public-2, and nothing else exists. The city has roads, no
buildings. Private subnets fail at 1 and 2: no road to the gate and no public address, so the
internet has no way in, and nothing inside can go out.

**7. Why no NAT gateway.** A NAT gateway (NAT: network address translation) is a one-way exit
door: things in a private neighborhood could go out to the internet (to download images, call AWS),
while nobody can come in. It costs about
$0.045 an hour (about $33 a month) plus a fee per GB, more than everything else we run together. Our
databases never need to go out. Our containers do (to pull their image from ECR, read secrets, write
logs), so we put them in the **public** neighborhoods with a public IP instead, and let the guards
(chapter 3) block every visitor except the reception desk. In production we would move them behind
the walls and add a NAT gateway or VPC endpoints (private doors straight to AWS services).

Where things will live:

| Neighborhood | What lives there (later chapters) | Why |
| ------------ | --------------------------------- | --- |
| public-1, public-2 | the ALB (ch 10), api and web tasks (ch 8) | The ALB must be reachable; tasks need a way out without NAT |
| private-1, private-2 | RDS Postgres and Valkey (ch 5) | Nobody outside should ever reach the data |

### 5. Our code

Everything is in `infra/src/network.ts` → `createNetwork`. It creates 12 resources: 1 VPC, 1
internet gateway, 4 subnets, 2 route tables, 4 associations. Its comments number the steps 1-9.

| Step in `createNetwork` | Variable | Creates |
| ----------------------- | -------- | ------- |
| 1 | `azs`, `azNames` | (a lookup, not a resource) the first two AZs |
| 2 | `vpc` | `minitickets-dev-vpc` |
| 3 | `internetGateway` | `minitickets-dev-igw` |
| 4, 5 | `publicSubnets`, `privateSubnets` | `minitickets-dev-public-1/2`, `minitickets-dev-private-1/2` |
| 6, 7 | `publicRouteTable`, `privateRouteTable` | `minitickets-dev-public-rt`, `minitickets-dev-private-rt` |
| 8 | `RouteTableAssociation` (×4) | `minitickets-dev-public-rta-1/2`, `minitickets-dev-private-rta-1/2` |
| 9 | the `return` | `vpcId`, `publicSubnetIds`, `privateSubnetIds` for later layers |

The key settings, in plain words:

- `infra/src/network.ts` → `10.0.0.0/16`: the city's house numbers, 65,536 of them.
- `infra/src/network.ts` → `publicCidrs`: `10.0.0.0/24` and `10.0.1.0/24`.
- `infra/src/network.ts` → `privateCidrs`: `10.0.10.0/24` and `10.0.11.0/24`.
- `infra/src/network.ts` → `mapPublicIpOnLaunch`: `true` in public subnets, `false` in private.
- `infra/src/network.ts` → `0.0.0.0/0`: the one line that makes the public sign public.
- `infra/src/network.ts` → `enableDnsHostnames`: with `enableDnsSupport`, machines can use **DNS**
  (the lookup that turns a name into an address), for example the database's name in chapter 5.

### 6. How it connects

- **Needs from chapter 1:** the region (`us-east-1`), the two AZs, the `minitickets-dev-` names and
  `tagsFor`.
- **Gives to later chapters** (through `infra/index.ts`, the only file that passes values between
  layers):
  - `vpcId` → security groups (chapter 3; a guard belongs to one city) and target groups (chapter 10).
  - `publicSubnetIds` → the ALB (chapter 10) and the api and web services (chapter 8).
  - `privateSubnetIds` → Postgres and Valkey (chapter 5).
- **Reach:** this chapter *is* the road part of Reach. The `local` line lets every neighborhood reach
  every other, across both districts. The `0.0.0.0/0` line lets the public ones reach the internet.
  Guards (chapter 3) are the other half of Reach. **Allowed:** not involved (no IAM in routing).
  **Password:** not involved.

Who talks to whom, so far (nothing runs yet, these are only the roads):

```mermaid
flowchart LR
    internet["internet"] <-->|"igw attached to the VPC"| igw["minitickets-dev-igw"]
    pub["public-1, public-2"] -->|"route 0.0.0.0/0 → igw"| igw
    pub <-->|"route 10.0.0.0/16 → local"| priv["private-1, private-2"]
```

### 7. Code → Console → CLI

Set this once in your terminal: `VPC=$(cd infra && pulumi stack output vpcId)`. All commands only read.

| Setting | Code (file → exact value) | Console: click path → where the value appears | CLI |
| ------- | ------------------------- | --------------------------------------------- | --- |
| VPC range | `infra/src/network.ts` → `cidrBlock: "10.0.0.0/16"` | VPC → Your VPCs → `minitickets-dev-vpc` → Details → **IPv4 CIDR** | `aws ec2 describe-vpcs --vpc-ids $VPC --query "Vpcs[0].CidrBlock"` |
| DNS on | `infra/src/network.ts` → `enableDnsSupport: true`, `enableDnsHostnames: true` | Same page → **DNS resolution: Enabled**, **DNS hostnames: Enabled** | `aws ec2 describe-vpc-attribute --vpc-id $VPC --attribute enableDnsHostnames` |
| The gate | `infra/src/network.ts` → `internetGateway` (`vpcId: vpc.id`) | VPC → Internet gateways → `minitickets-dev-igw` → **State: Attached**, **VPC ID** | `aws ec2 describe-internet-gateways --filters Name=attachment.vpc-id,Values=$VPC` |
| Subnet ranges and AZs | `infra/src/network.ts` → `publicCidrs`, `privateCidrs`, `availabilityZone` | VPC → Subnets → columns **IPv4 CIDR**, **Availability Zone**, **Availability Zone ID** | `aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC --output table` |
| Public IP on launch | `infra/src/network.ts` → `mapPublicIpOnLaunch: true` (public) / `false` (private) | VPC → Subnets → a subnet → Details → **Auto-assign public IPv4 address**: Yes / No | `aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC --query "Subnets[].MapPublicIpOnLaunch"` |
| The internet line | `infra/src/network.ts` → `routes: [{ cidrBlock: "0.0.0.0/0", gatewayId: internetGateway.id }]` | VPC → Route tables → `minitickets-dev-public-rt` → **Routes** tab → Destination `0.0.0.0/0`, Target `igw-…`, Status Active | `aws ec2 describe-route-tables --filters Name=vpc-id,Values=$VPC --query "RouteTables[].Routes"` |
| Private sign | `infra/src/network.ts` → `privateRouteTable` (no `routes`) | VPC → Route tables → `minitickets-dev-private-rt` → **Routes** tab → only `10.0.0.0/16` → `local` | same command |
| Associations | `infra/src/network.ts` → `RouteTableAssociation` | A route table → **Subnet associations** tab → **Explicit subnet associations** (2 each) | `aws ec2 describe-route-tables --filters Name=vpc-id,Values=$VPC --query "RouteTables[].Associations[].SubnetId"` |
| Outputs | `infra/index.ts` → `export const vpcId` | Pulumi Cloud (`pulumi console`) → stack `dev` → **Outputs** on the overview page | `pulumi stack output` |

### 8. Console mission

The network is always on (it costs nothing), so you can do this any time.

1. VPC → Your VPCs → click `minitickets-dev-vpc` → the **Resource map** tab. AWS draws the city for
   you: the VPC, its subnets, its route tables and its "network connections" (our gate), with lines
   between them. Hover over a subnet: the console highlights what it is connected to.
2. Resource Groups & Tag Editor → Tag Editor → region `us-east-1`, tag `Project` = `minitickets`.
   Find the four subnets and two route tables by Name.
3. `pulumi console` → stack `dev` → Resources: find `minitickets-dev-public-rta-1`. It is in Pulumi's
   list but not in Tag Editor (associations can't carry tags).

**Question to answer by looking:** the Resource map shows **three** route tables, but our code makes
two. Which one has no line to any subnet, what is its name in the console, and who made it?

### 9. Follow one thing: the VPC ID

Our VPC's ID is `vpc-00b5d32f044694518` (read from the stack while writing this guide; it stays the
same until the network is deleted and built again).

1. **Code:** the ID is **nowhere** in the code. `infra/src/network.ts` → `createNetwork` asks for a
   VPC (`new aws.ec2.Vpc("minitickets-dev-vpc", …)`), and AWS invents the ID when it creates it.
2. **Pulumi state:** Pulumi writes the ID into the record book. Pulumi Cloud → Resources →
   `minitickets-dev-vpc` shows it.
3. **Passed on in code:** `createNetwork` returns `vpcId: vpc.id`. `infra/index.ts` hands it to
   `createSecurityGroups({ vpcId: network.vpcId, … })` and `createTargetGroups({ vpcId: network.vpcId })`,
   and exports it: `export const vpcId`.
4. **Stack output:** `pulumi stack output vpcId` prints `vpc-00b5d32f044694518`.
5. **Console, in many places:** Your VPCs → column **VPC ID**. Subnets, Route tables, Internet
   gateways → column **VPC** / **VPC ID**. Security groups → column **VPC ID** (from chapter 3). EC2 →
   Target groups → **VPC ID** (chapter 10, when the environment is on).
6. **Its full address (ARN, Amazon Resource Name: AWS's unique name for one resource):**
   `arn:aws:ec2:us-east-1:<account-id>:vpc/vpc-00b5d32f044694518`.
7. **CLI:** every network command filters by it: `--filters Name=vpc-id,Values=vpc-00b5d32f044694518`.

Why it shows up everywhere: a subnet, a route table, a guard (security group) and a staff list
(target group) each belong to exactly one city. They can only be created with the city's ID in hand.

The same trip for a subnet: `minitickets-dev-public-1` is `subnet-09eb2bfebf3d03307`. It comes out of
`createNetwork` in `publicSubnetIds`, and later appears in the ALB's subnets (chapter 10) and in the
api service's network settings (chapter 8).

### 10. When it breaks

| Symptom | Where to look | Usual fix |
| ------- | ------------- | --------- |
| A container can't pull its image: "unable to pull", timeouts at task start | The subnet's route table (no `0.0.0.0/0 → igw`?) and the task's public IP (chapter 4) | Public subnet with a public IP, or a NAT gateway / VPC endpoints |
| A "public" thing is unreachable from the internet | Route table **Routes** tab; subnet **Auto-assign public IPv4**; then the security group (chapter 3) | Add the missing piece of the four in "what public really means" |
| A subnet behaves differently from its twin | Subnet → Details → **Route table** | It has no association and uses the main route table. Associate it |
| `pulumi up`: "The CIDR '10.0.1.0/24' conflicts with another subnet" | `publicCidrs` / `privateCidrs` | Ranges must not overlap; pick a free one |
| `pulumi up`: "The CIDR … is invalid for this VPC" (or similar) | The subnet range | It must sit inside `10.0.0.0/16` |
| A database in a private subnet is reachable from the internet | Someone added `0.0.0.0/0` to `private-rt` | Remove it. Private = no route to the gate |

The exact error wording from AWS may differ a little; the cause is the same.

### 11. The small details

- **CIDR in simple numbers.** `/16` = 65,536 addresses, `/24` = 256, `/28` = 16. Each step of 1 in
  the slash number halves the size. A VPC can be between `/16` (biggest) and `/28` (smallest).
- **5 addresses per subnet are AWS's.** In `10.0.0.0/24`: `.0` (the network itself), `.1` (the VPC
  router), `.2` (kept for the DNS server), `.3` (kept for later), `.255` (the last one). So 251 are usable.
- **Why `10.`?** `10.0.0.0/8` is one of the ranges set aside for private networks; it is never used
  on the public internet. Plan ranges so two VPCs you might connect one day don't overlap.
- **Why exactly 2 AZs.** It is the minimum an ALB and an RDS subnet group accept. In dev we run only
  one copy of the database, cache and each task, so the two-district *shape* is ready, but the
  redundancy is not paid for yet.
- **Public vs private is only the route table.** The word "public" in the name does nothing. Move
  `public-rt`'s internet line to `private-rt` and the names would lie.
- **NAT cost.** About $33 a month for one; production wants one per AZ for safety, so about $66. VPC
  endpoints for ECR, Secrets Manager and CloudWatch cost per hour per AZ too (I have not priced
  them for us).
- **The default network ACL.** Every VPC gets one checkpoint list (a network ACL), and ours applies
  to all four subnets because we make no other. It allows all traffic in and out (rule 100), then
  denies anything else (rule `*`, never reached). Unlike security groups it is *stateless* (replies
  are checked too). We leave it open and do our filtering with security groups (chapter 3). Ours is
  `acl-09a685b41658e7427`.
- **The main route table** (`rtb-08af5439534fccda6`, no Name) and the **default security group**
  (`sg-02176ee8be3cdb7c0`, named `default`) are also made by AWS with every VPC. Pulumi doesn't manage
  them, so they have no tags. Nothing of ours uses either.
- **The default VPC.** Your account may also have an AWS-made VPC with `172.31.0.0/16` and
  "Default VPC: Yes" in the list. It is not ours; we never use it.
- **Tags on the network.** The VPC, gate, subnets and route tables all carry `tagsFor` tags. The four
  associations have none: AWS doesn't support tags on them.

### 12. Interview

**Say it in 30 seconds:** "Our VPC is `10.0.0.0/16` in `us-east-1`, with a public and a private `/24`
subnet in each of two AZs. Public subnets have a route table with `0.0.0.0/0` to the internet
gateway; private ones only have the local route, so they can't reach or be reached from the
internet. Databases live in the private subnets. We skip a NAT gateway to save about $33 a month, so
our containers run in public subnets with public IPs, and security groups block everything except
the load balancer."

**Likely questions:**

- *What makes a subnet public?* Only its route table: a `0.0.0.0/0` route to an internet gateway.
  To actually be reachable, the resource also needs a public IP and a security group that allows it.
- *Internet gateway vs NAT gateway?* An internet gateway is two-way, for things with public IPs. A
  NAT gateway lets private things start connections out, while nothing outside can start one in.
- *Your containers are in public subnets. Isn't that unsafe?* The public IP makes them addressable,
  not open: their security group only allows the load balancer. For production I'd move them to
  private subnets with a NAT gateway or VPC endpoints, for defence in depth (more than one layer of
  protection, so one mistake is not enough).

### 13. Check yourself

1. You add `0.0.0.0/0 → igw` to `minitickets-dev-private-rt`. What changes, and why is it risky,
   even though the database has no public IP?
2. The VPC is `10.0.0.0/16`. Could you add a subnet `10.0.5.0/24`? And `10.1.0.0/24`? Why?
3. Why does the internet gateway survive the loss of one AZ, while a subnet doesn't?

**Next:** the city has roads, but every building door is wide open to anyone who finds it. Before
we let a single visitor in, each door needs a guard with a guest list.

---

## Chapter 3: Security groups

### 1. Last time and the problem

The roads exist. Guards now decide which building door accepts which visitor. Built in code; live acceptance is a separate check. 

### 2. In the city

The city request path: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["Security groups"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

ALB reaches web:3000 and API:4000; API reaches DB:5432 and Valkey:6379. Rules reference source groups rather than changing task IPs. SGs are stateful; a route and an allowed port are separate requirements.

### 5. Our code

`infra/src/security.ts` → `createSecurityGroups`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/security.ts` → `createSecurityGroups` | EC2 → Security Groups → minitickets-dev-*-sg → Inbound rules; compare configured name/settings with the code. Explain-only resources should be absent. | `aws ec2 describe-security-groups --filters Name=tag:Project,Values=minitickets` |

### 8. Console mission

Open **EC2 → Security Groups → minitickets-dev-*-sg → Inbound rules**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

A task can have a route and still time out at a closed building door. Compare source SG, destination port and task ENI before blaming the password.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

ALB reaches web:3000 and API:4000; API reaches DB:5432 and Valkey:6379. Rules reference source groups rather than changing task IPs. SGs are stateful; a route and an allowed port are separate requirements. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 4: Public IPs and network interfaces

### 1. Last time and the problem

A worker needs an address as well as a guest-list entry. Built in code; live acceptance is a separate check. 

### 2. In the city

The city request path: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["Public IPs and network interfaces"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

Fargate awsvpc gives each task an ENI with private address and attached groups. Public-subnet tasks use a public IP for outbound image/secrets access; that does not open inbound ports. Private data has no public entry. No NAT gateway is built.

### 5. Our code

`infra/src/compute/service.ts` → `createApiService`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/compute/service.ts` → `createApiService` | ECS → Clusters → minitickets-dev → Tasks → Networking → ENI; compare configured name/settings with the code. Explain-only resources should be absent. | `aws ec2 describe-network-interfaces --filters Name=tag:Project,Values=minitickets` |

### 8. Console mission

Open **ECS → Clusters → minitickets-dev → Tasks → Networking → ENI**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

A public subnet alone does not give a worker internet access. Check route, public-IP assignment and egress; public IPv4 and NAT have different running costs.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

Fargate awsvpc gives each task an ENI with private address and attached groups. Public-subnet tasks use a public IP for outbound image/secrets access; that does not open inbound ports. Private data has no public entry. No NAT gateway is built. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 5: The database and cache

### 1. Last time and the problem

Workers need durable records and a shared short-term memory behind the walls. Built in code; live acceptance is a separate check. 

### 2. In the city

The city request path: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["The database and cache"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

Postgres is the booking source of truth; Valkey holds sessions, cached event lists, token buckets and advisory inventory. A cache may evict data; SQL transactions and CHECK/unique constraints still protect seats. Data switches and retained backups are independent of compute.

### 5. Our code

`infra/src/data/postgres.ts` → `createPostgres`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/data/postgres.ts` → `createPostgres` | RDS → Databases → minitickets-dev-db; ElastiCache → Valkey caches; compare configured name/settings with the code. Explain-only resources should be absent. | `aws rds describe-db-instances --db-instance-identifier minitickets-dev-db` |

### 8. Console mission

Open **RDS → Databases → minitickets-dev-db; ElastiCache → Valkey caches**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

Follow the API ENI to private data subnets. Reach means route + SG, Allowed means the relevant service policy where used, Password means DB/Redis credentials and TLS. Never test by printing secret values.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

Postgres is the booking source of truth; Valkey holds sessions, cached event lists, token buckets and advisory inventory. A cache may evict data; SQL transactions and CHECK/unique constraints still protect seats. Data switches and retained backups are independent of compute. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 6: Secrets

### 1. Last time and the problem

The worker needs a key safe, not passwords written on its name plate. Built in code; live acceptance is a separate check. 

### 2. In the city

The city request path: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["Secrets"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

RDS manages the DB master secret; Valkey/revalidation/origin/signing secrets have distinct purposes and permissions. ECS execution roles inject selected secret fields at task start; application roles fetch only what runtime code needs. Secret ARNs are not secret values.

### 5. Our code

`infra/src/data/secrets.ts` → `createSecrets`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/data/secrets.ts` → `createSecrets` | Secrets Manager → Secrets → minitickets/dev/… → Overview (metadata only); compare configured name/settings with the code. Explain-only resources should be absent. | `aws secretsmanager list-secrets --query "SecretList[].Name"` |

### 8. Console mission

Open **Secrets Manager → Secrets → minitickets/dev/… → Overview (metadata only)**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

A task can reach the safe but lack its badge, or have a badge and use the wrong secret field. Rotation needs coordinated credentials and consumer restart/key-ring behavior; automatic ticket key rotation is not built.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

RDS manages the DB master secret; Valkey/revalidation/origin/signing secrets have distinct purposes and permissions. ECS execution roles inject selected secret fields at task start; application roles fetch only what runtime code needs. Secret ARNs are not secret values. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 7: ECR

### 1. Last time and the problem

Workers must fetch an immutable packed app from the warehouse. Built in code; live acceptance is a separate check. 

### 2. In the city

The warehouse: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["ECR"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

API, web and worker have separate repositories. Publish builds a git-SHA image once per service, then deployment uses that tag through SSM. Lifecycle policies preserve deployed/recent artifacts; latest is not the release authority. No registry password is committed.

### 5. Our code

`infra/src/registry.ts` → `createRegistry`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/registry.ts` → `createRegistry` | ECR → Private repositories → minitickets-dev-api / web / worker → Images; compare configured name/settings with the code. Explain-only resources should be absent. | `aws ecr describe-repositories --query "repositories[].repositoryName"` |

### 8. Console mission

Open **ECR → Private repositories → minitickets-dev-api / web / worker → Images**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

A successful push does not mean a task can pull. Compare image URI/architecture, execution-role ECR permissions and network egress.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

API, web and worker have separate repositories. Publish builds a git-SHA image once per service, then deployment uses that tag through SSM. Lifecycle policies preserve deployed/recent artifacts; latest is not the release authority. No registry password is committed. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 8: ECS

### 1. Last time and the problem

A manager must keep the right packed workers running and replace unhealthy ones. Built in code; live acceptance is a separate check. 

### 2. In the city

The city request path: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["ECS"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

Fargate arm64 tasks run API and web as separate services; task definitions pin image/env/secrets/roles. Readiness checks data dependencies; liveness only proves a process answers. A dedicated minitickets-dev-migrate task applies SQL before rollout, not inside every API task.

### 5. Our code

`infra/src/compute/task.ts` → `createApiTask`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/compute/task.ts` → `createApiTask` | ECS → Clusters → minitickets-dev → Services / Tasks; CloudWatch → Log groups; compare configured name/settings with the code. Explain-only resources should be absent. | `aws ecs list-services --cluster minitickets-dev` |

### 8. Console mission

Open **ECS → Clusters → minitickets-dev → Services / Tasks; CloudWatch → Log groups**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

A stopped task has a stoppedReason, exit code and log stream. A service Event often explains image-pull, secret, ENI or health-check failures faster than restarting it.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

Fargate arm64 tasks run API and web as separate services; task definitions pin image/env/secrets/roles. Readiness checks data dependencies; liveness only proves a process answers. A dedicated minitickets-dev-migrate task applies SQL before rollout, not inside every API task. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 9: IAM roles

### 1. Last time and the problem

The manager, workers and publisher need different staff badges. Built in code; live acceptance is a separate check. 

### 2. In the city

The staff badge: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["IAM roles"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

Trust says who may assume a role; permissions say which actions on which resource ARNs; attachment says which task/function/job uses it. ECS execution roles pull/log/inject secrets; the API task role publishes SNS, queries tickets and signs constrained S3 access; Lambda roles receive their own queue and touch their own outputs.

### 5. Our code

`infra/src/compute/iam.ts` → `createIamRoles`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/compute/iam.ts` → `createIamRoles` | IAM → Roles → minitickets-dev-* → Trust relationships / Permissions; compare configured name/settings with the code. Explain-only resources should be absent. | `aws iam list-roles --query "Roles[?starts_with(RoleName, `minitickets-dev`)].RoleName"` |

### 8. Console mission

Open **IAM → Roles → minitickets-dev-* → Trust relationships / Permissions**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

AccessDenied is not a network timeout. Identify the caller ARN and denied action/resource, inspect trust and permission separately, then check attached taskRoleArn vs executionRoleArn.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

Trust says who may assume a role; permissions say which actions on which resource ARNs; attachment says which task/function/job uses it. ECS execution roles pull/log/inject secrets; the API task role publishes SNS, queries tickets and signs constrained S3 access; Lambda roles receive their own queue and touch their own outputs. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 10: The ALB

### 1. Last time and the problem

Visitors need one HTTPS reception desk that sends pages and API calls to healthy staff. Built in code; live acceptance is a separate check. 

### 2. In the city

The reception desk: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["The ALB"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

ACM validates minitickets.theversehub.in; HTTPS listener routes /trpc/* to API and other paths to web. Target groups track health independently. ALB-only mode accepts the owner-selected source CIDRs; the committed cdnEnabled=false remains the current shape.

### 5. Our code

`infra/src/entry/https-listener.ts` → `createHttpsListener`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/entry/https-listener.ts` → `createHttpsListener` | EC2 → Load balancers → minitickets-dev → Listeners and rules; Target groups → Targets; compare configured name/settings with the code. Explain-only resources should be absent. | `aws elbv2 describe-load-balancers --names minitickets-dev` |

### 8. Console mission

Open **EC2 → Load balancers → minitickets-dev → Listeners and rules; Target groups → Targets**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

A 502/503 can mean no healthy targets, wrong container port or an application crash. Check listener rule, target health reason, task health and logs in that order.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

ACM validates minitickets.theversehub.in; HTTPS listener routes /trpc/* to API and other paths to web. Target groups track health independently. ALB-only mode accepts the owner-selected source CIDRs; the committed cdnEnabled=false remains the current shape. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 11: Service Connect

### 1. Last time and the problem

Web server rendering needs the API without going back through public reception. Built in code; live acceptance is a separate check. 

### 2. In the city

The city request path: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["Service Connect"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

Service Connect exposes api/web names via task-local proxies (API proxy 14000, web proxy 13000). API_INTERNAL_URL is server-only; browser requests still use the public /trpc route. Proxy port ingress differs from the application container port.

### 5. Our code

`infra/src/compute/service-connect.ts` → `createServiceConnect`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/compute/service-connect.ts` → `createServiceConnect` | ECS → Cluster → Service Connect; Cloud Map → Namespaces → minitickets.internal; compare configured name/settings with the code. Explain-only resources should be absent. | `aws servicediscovery list-namespaces` |

### 8. Console mission

Open **ECS → Cluster → Service Connect; Cloud Map → Namespaces → minitickets.internal**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

A browser can work while SSR fails. Check the internal name, Service Connect discovery and proxy SG rule. Localhost-originated internal calls are not trusted for forged X-Forwarded-For.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

Service Connect exposes api/web names via task-local proxies (API proxy 14000, web proxy 13000). API_INTERNAL_URL is server-only; browser requests still use the public /trpc route. Proxy port ingress differs from the application container port. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 12: CloudFront

### 1. Last time and the problem

An optional front layer can bring static files closer to visitors. Implemented, currently inactive while cdnEnabled=false. 

### 2. In the city

The city request path: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["CloudFront"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

CloudFront is implemented but currently inactive: cdnEnabled=false pending account verification. Static assets can be cached; private/RSC/API answers cannot. P10 nonce-bearing HTML is now private,no-store; the events policy min/default TTL 0 honors it. Origin protection uses a secret header and AWS prefix-list mode when enabled.

### 5. Our code

`infra/src/entry/cdn.ts` → `createCdn`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/entry/cdn.ts` → `createCdn` | CloudFront → Distributions → Behaviors / Origins (only if enabled); compare configured name/settings with the code. Explain-only resources should be absent. | `aws cloudfront list-distributions --query "DistributionList.Items[].DomainName"` |

### 8. Console mission

Open **CloudFront → Distributions → Behaviors / Origins (only if enabled)**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

Do not claim an inactive distribution is live. First diagnose the ALB path; then compare behavior, cache key, origin headers, DNS and certificate region.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

CloudFront is implemented but currently inactive: cdnEnabled=false pending account verification. Static assets can be cached; private/RSC/API answers cannot. P10 nonce-bearing HTML is now private,no-store; the events policy min/default TTL 0 honors it. Origin protection uses a secret header and AWS prefix-list mode when enabled. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 13: CI/CD

### 1. Last time and the problem

A publisher needs a short-lived badge and a deployment record, not laptop keys. Built in code; live acceptance is a separate check. 

### 2. In the city

The city request path: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["CI/CD"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

GitHub OIDC trust restricts repository/environment subjects. CI checks code/tests/audit and Trivy images; publish builds SHA artifacts once; approved deploy records the tag in SSM, migrates, then rolls services/Lambdas. Guards reject stale infrastructure code and superseded approved runs.

### 5. Our code

`infra/src/cicd.ts` → `createCicd`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/cicd.ts` → `createCicd` | GitHub → Actions → CI / CD; IAM → Identity providers; SSM → Parameter Store; compare configured name/settings with the code. Explain-only resources should be absent. | `aws ssm get-parameter --name /minitickets/dev/image-tag --query Parameter.Value` |

### 8. Console mission

Open **GitHub → Actions → CI / CD; IAM → Identity providers; SSM → Parameter Store**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

An old approved run must not delete newer resources. Distinguish app rollback (old image/current infra) from infra rollback and an additive migration; never locally overwrite the SSM release parameter.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

GitHub OIDC trust restricts repository/environment subjects. CI checks code/tests/audit and Trivy images; publish builds SHA artifacts once; approved deploy records the tag in SSM, migrates, then rolls services/Lambdas. Guards reject stale infrastructure code and superseded approved runs. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 14: Queues, DLQs and SNS fan-out

### 1. Last time and the problem

Booking commits need two durable consumers without losing messages between SQL and delivery. Built in code; live acceptance is a separate check. 

### 2. In the city

The city request path: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["Queues, DLQs and SNS fan-out"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

The API commits confirmation payload in a Postgres outbox with the booking. A relay publishes to SNS; raw subscriptions copy the event into separate jobs and tickets SQS queues, each with a DLQ/redrive policy. One consumer failure does not block the other.

### 5. Our code

`infra/src/jobs/booking-events.ts` → `createBookingEvents`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/jobs/booking-events.ts` → `createBookingEvents` | SNS → Topics → minitickets-dev-booking-events → Subscriptions; SQS → Queues; compare configured name/settings with the code. Explain-only resources should be absent. | `aws sns list-topics; aws sqs list-queues --queue-name-prefix minitickets-dev` |

### 8. Console mission

Open **SNS → Topics → minitickets-dev-booking-events → Subscriptions; SQS → Queues**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

SNS is fan-out, SQS is durable backlog and retry, the outbox closes the commit/publish gap. A relay can publish twice after an unknown acknowledgement; consumers must be idempotent.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

The API commits confirmation payload in a Postgres outbox with the booking. A relay publishes to SNS; raw subscriptions copy the event into separate jobs and tickets SQS queues, each with a DLQ/redrive policy. One consumer failure does not block the other. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 15: Lambda workers

### 1. Last time and the problem

Queue messages need workers that scale independently from the API. Built in code; live acceptance is a separate check. 

### 2. In the city

The city request path: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["Lambda workers"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

Email Lambda is 256 MB / 10 s; ticket Lambda is 512 MB / 30 s. Both use the published worker image with different commands. Event-source mappings use partial batch failure responses. They do not need the VPC because their stores are managed AWS APIs, not RDS.

### 5. Our code

`infra/src/jobs/worker-lambda.ts` → `createWorkerLambda`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/jobs/worker-lambda.ts` → `createWorkerLambda` | Lambda → Functions → minitickets-dev-worker / minitickets-dev-tickets → Configuration → Triggers; compare configured name/settings with the code. Explain-only resources should be absent. | `aws lambda get-function-configuration --function-name minitickets-dev-worker --query "{Timeout:Timeout,Memory:MemorySize,Role:Role}"` |

### 8. Console mission

Open **Lambda → Functions → minitickets-dev-worker / minitickets-dev-tickets → Configuration → Triggers**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

Visibility timeout must outlast processing/retry behavior; partial failure reports only failed message identifiers. Whole-batch failure replays successful siblings; concurrency limits can cause throttling/redrive.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

Email Lambda is 256 MB / 10 s; ticket Lambda is 512 MB / 30 s. Both use the published worker image with different commands. Event-source mappings use partial batch failure responses. They do not need the VPC because their stores are managed AWS APIs, not RDS. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 16: DynamoDB records

### 1. Last time and the problem

Consumers need durable dedupe and owner/date access patterns without an SQL connection pool. Built in code; live acceptance is a separate check. 

### 2. In the city

The city request path: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["DynamoDB records"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

Processed jobs use jobKey plus TTL. Ticket rows use userId/ticketId and by-event-date GSI for a future reminder path. Conditional writes reserve canonical ticket work and support idempotent repair; owner Query is strongly consistent, GSI reads are not. TTL is asynchronous cleanup, not an authorization clock.

### 5. Our code

`infra/src/tickets/storage.ts` → `createTicketStorage`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/tickets/storage.ts` → `createTicketStorage` | DynamoDB → Tables → minitickets-dev-processed-jobs / minitickets-dev-tickets → Indexes; compare configured name/settings with the code. Explain-only resources should be absent. | `aws dynamodb describe-table --table-name minitickets-dev-tickets --query "Table.{KeySchema:KeySchema,Indexes:GlobalSecondaryIndexes}"` |

### 8. Console mission

Open **DynamoDB → Tables → minitickets-dev-processed-jobs / minitickets-dev-tickets → Indexes**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

Design keys from reads before writing rows. A hot date partition, eventual GSI propagation and duplicate delivery are different failure modes; Query differs from scanning the whole table.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

Processed jobs use jobKey plus TTL. Ticket rows use userId/ticketId and by-event-date GSI for a future reminder path. Conditional writes reserve canonical ticket work and support idempotent repair; owner Query is strongly consistent, GSI reads are not. TTL is asynchronous cleanup, not an authorization clock. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 17: SES delivery

### 1. Last time and the problem

A confirmed booking needs an email delivery service with a verified sender. Built in code; live acceptance is a separate check. 

### 2. In the city

The city request path: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["SES delivery"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

SES identity/DKIM records prove sender ownership. Sandbox delivery requires verified recipients and is quota-limited; first AWS delivery remains acceptance work. Lambda IAM restricts sender identities and From address. Provider acceptance is not an exactly-once inbox guarantee.

### 5. Our code

`infra/src/jobs/email.ts` → `createEmail`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/jobs/email.ts` → `createEmail` | SES → Verified identities / Account dashboard → Sandbox and sending quota; compare configured name/settings with the code. Explain-only resources should be absent. | `aws sesv2 get-account --query "{Production:ProductionAccessEnabled,Quota:SendQuota}"` |

### 8. Console mission

Open **SES → Verified identities / Account dashboard → Sandbox and sending quota**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

If SES accepted but the consumer crashed before marking done, retry can send twice. DKIM improves authentication, not universal inbox placement; production access/quota is separate from IAM.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

SES identity/DKIM records prove sender ownership. Sandbox delivery requires verified recipients and is quota-limited; first AWS delivery remains acceptance work. Lambda IAM restricts sender identities and From address. Provider acceptance is not an exactly-once inbox guarantee. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 18: Private S3 assets and signed tickets

### 1. Last time and the problem

A ticket needs a private QR artifact and a short-lived way for its owner to read it. Built in code; live acceptance is a separate check. 

### 2. In the city

The city request path: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["Private S3 assets and signed tickets"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

Bucket ownership/public-access block, SSE-S3 and TLS-only policy protect assets. HMAC signs ticket claims; deterministic seat keys plus conditional Dynamo rows converge under duplicates. API owner-scopes reads and issues 120-second GET/download capabilities. Admin poster PUTs are constrained, staged, byte-checked and copied immutably; CORS is not authorization.

### 5. Our code

`infra/src/tickets/storage.ts` → `createTicketStorage`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/tickets/storage.ts` → `createTicketStorage` | S3 → minitickets-dev-ticket-assets-258237553751 → Permissions / Lifecycle; Secrets Manager → signing metadata; compare configured name/settings with the code. Explain-only resources should be absent. | `aws s3api get-public-access-block --bucket minitickets-dev-ticket-assets-258237553751` |

### 8. Console mission

Open **S3 → minitickets-dev-ticket-assets-258237553751 → Permissions / Lifecycle; Secrets Manager → signing metadata**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

Never log raw signed URLs or signing values. MIME/header checks are not malware scanning/full decoding. Scanner verification/redemption and automated key-ring rotation are explain-only, not shipped.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

Bucket ownership/public-access block, SSE-S3 and TLS-only policy protect assets. HMAC signs ticket claims; deterministic seat keys plus conditional Dynamo rows converge under duplicates. API owner-scopes reads and issues 120-second GET/download capabilities. Admin poster PUTs are constrained, staged, byte-checked and copied immutably; CORS is not authorization. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 19: Alarms and observability

### 1. Last time and the problem

The city diary must show one booking across API and consumers and call for help when backlog grows. Built in code; live acceptance is a separate check. 

### 2. In the city

The city request path: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["Alarms and observability"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

Correlation ids flow through request logs, outbox payload, SNS/SQS and Lambda JSON. CloudWatch alarms cover queue age, DLQ, worker errors/throttles; the dashboard combines metrics and saved queries. SNS email subscriptions need confirmation. Browser vitals are structured logs, not trusted billing data or custom metrics.

### 5. Our code

`infra/src/observability/alarms.ts` → `createAlarms`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/observability/alarms.ts` → `createAlarms` | CloudWatch → Alarms / Dashboards → minitickets-dev; SNS → minitickets-dev-alerts; compare configured name/settings with the code. Explain-only resources should be absent. | `aws logs tail /minitickets/dev/api --since 10m` |

### 8. Console mission

Open **CloudWatch → Alarms / Dashboards → minitickets-dev; SNS → minitickets-dev-alerts**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

An alarm without confirmed email delivery is silent. Missing data policy, evaluation periods and age vs depth matter; search by correlation id before guessing which process failed.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

Correlation ids flow through request logs, outbox payload, SNS/SQS and Lambda JSON. CloudWatch alarms cover queue age, DLQ, worker errors/throttles; the dashboard combines metrics and saved queries. SNS email subscriptions need confirmation. Browser vitals are structured logs, not trusted billing data or custom metrics. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 20: Reminder scheduler (explain-only)

### 1. Last time and the problem

A reminder the day before would branch from ticket date access into the existing email path. EXPLAIN-ONLY: not built. 

### 2. In the city

The city request path: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["Reminder scheduler"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

Not built: a daily Scheduler would invoke a reminder Lambda, query tomorrow in by-event-date, and enqueue one email job per ticket/day. No VPC/RDS is needed. The Scheduler badge would trust scheduler.amazonaws.com and allow InvokeFunction on only that function.

### 5. Our code

`infra/src/jobs/queues.ts` → `createJobQueues`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/jobs/queues.ts` → `createJobQueues` | EventBridge Scheduler → Schedules (no MiniTickets reminder resource built); compare configured name/settings with the code. Explain-only resources should be absent. | `aws scheduler list-schedules` |

### 8. Console mission

Open **EventBridge Scheduler → Schedules (no MiniTickets reminder resource built)**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

Where it would go: a new infra/src/jobs/reminders.ts and apps/worker/src/reminders handler/service beside current workers. Conditional ticket/day dedupe and paginated/sharded date queries prevent duplicate or unbounded sends.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

Not built: a daily Scheduler would invoke a reminder Lambda, query tomorrow in by-event-date, and enqueue one email job per ticket/day. No VPC/RDS is needed. The Scheduler badge would trust scheduler.amazonaws.com and allow InvokeFunction on only that function. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 21: Door check-in (explain-only)

### 1. Last time and the problem

The door would authenticate a QR and atomically consume it once. EXPLAIN-ONLY: not built. 

### 2. In the city

The city request path: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["Door check-in"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

Not built: REST API usage plans/API keys throttle staff devices, but are not staff authorization. A check-in Lambda would verify the HMAC then conditionally update valid→used in DynamoDB. Two scans race: one succeeds, one returns already-used time. A staff scanner would keep its key out of the bundle.

### 5. Our code

`apps/worker/src/tickets/token.ts` → `verifyTicket`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `apps/worker/src/tickets/token.ts` → `verifyTicket` | API Gateway → REST APIs / Usage plans (no MiniTickets check-in API built); compare configured name/settings with the code. Explain-only resources should be absent. | `aws apigateway get-rest-apis` |

### 8. Console mission

Open **API Gateway → REST APIs / Usage plans (no MiniTickets check-in API built)**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

Where it would go: apps/web/src/features/checkin plus a check-in Lambda and infra/src/tickets/checkin.ts. HTTP API lacks REST usage-plan features; camera input is untrusted and a signed QR alone is replayable.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

Not built: REST API usage plans/API keys throttle staff devices, but are not staff authorization. A check-in Lambda would verify the HMAC then conditionally update valid→used in DynamoDB. Two scans race: one succeeds, one returns already-used time. A staff scanner would keep its key out of the bundle. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 22: Autoscaling (explain-only)

### 1. Last time and the problem

A manager could add workers when traffic grows, but workers cannot create more seats. EXPLAIN-ONLY: not built. 

### 2. In the city

The city request path: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["Autoscaling"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

Not built: an ECS desired-count target, min 1/max 3, CPU or ALB requests-per-target policy and cost budget. P8 instead builds shared rate limiting and an advisory inventory gate; Postgres still enforces stock. Waiting room, queued booking and expiring customer seat holds are explain-only too.

### 5. Our code

`infra/src/compute/service.ts` → `createApiService`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/compute/service.ts` → `createApiService` | ECS → Service → Auto scaling (no target-tracking policy built); compare configured name/settings with the code. Explain-only resources should be absent. | `aws application-autoscaling describe-scalable-targets --service-namespace ecs` |

### 8. Console mission

Open **ECS → Service → Auto scaling (no target-tracking policy built)**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

Where it would go: a new infra/src/compute/autoscaling.ts after services/target groups. More tasks increase DB connections and contention; define a queue-depth/latency objective, cooldown and maximum spend before adding capacity.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

Not built: an ECS desired-count target, min 1/max 3, CPU or ALB requests-per-target policy and cost budget. P8 instead builds shared rate limiting and an advisory inventory gate; Postgres still enforces stock. Waiting room, queued booking and expiring customer seat holds are explain-only too. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 23: Debugging playbook

### 1. Last time and the problem

Follow the failed request through the city rather than restarting unrelated pieces. Built in code; live acceptance is a separate check. 

### 2. In the city

The city request path: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["Debugging playbook"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

Start at the observed symptom and correlation id. Reach checks DNS/routes/SG/ports; Allowed checks IAM caller/action/resource; Password checks secret field/version/TLS without printing values. Then inspect DB locks, pool timeouts, queue age, DLQ/error logs and release SHA.

### 5. Our code

`infra/src/observability/log-queries.ts` → `createLogQueries`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/src/observability/log-queries.ts` → `createLogQueries` | CloudWatch → Logs Insights → Saved queries; ECS → Service events / Stopped tasks; compare configured name/settings with the code. Explain-only resources should be absent. | `aws logs tail /minitickets/dev/api --since 10m` |

### 8. Console mission

Open **CloudWatch → Logs Insights → Saved queries; ECS → Service events / Stopped tasks**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

Change one explanation at a time. A 403 is not fixed by opening a subnet; a lock wait is not fixed by rotating an S3 key. Reproduce in disposable local resources and distinguish local proof from AWS acceptance.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

Start at the observed symptom and correlation id. Reach checks DNS/routes/SG/ports; Allowed checks IAM caller/action/resource; Password checks secret field/version/TLS without printing values. Then inspect DB locks, pool timeouts, queue age, DLQ/error logs and release SHA. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Chapter 24: The final poster

### 1. Last time and the problem

The whole city should fit in an explanation you can give without memorizing 100 service names. Built in code; live acceptance is a separate check. 

### 2. In the city

The city request path: follow the same guards, road signs, badges and key safe from the city table. This chapter adds a specific boundary; it does not replace the earlier ones.

### 3. The picture

```mermaid
flowchart LR
    before["Earlier city boundary"] -->|"Reach"| piece["The final poster"]
    badge["Staff badge / policy"] -->|"Allowed"| piece
    safe["Key safe where needed"] -->|"Password"| piece
```

### 4. How it really works

Browser→ALB→web/API→Postgres/Valkey is the synchronous path. Booking→outbox→SNS→two SQS queues→Lambdas→SES or S3/DynamoDB is the side path. OIDC/ECR/SSM/CD changes versions. SGs govern reach, IAM grants actions, secrets prove identity. Optional CloudFront and explain-only features remain distinct.

### 5. Our code

`infra/index.ts` → `import`. Read the WHAT/WHY comments, then [open the generated code tours](code-tours.html) and search this file. For explain-only chapters this is the existing integration point, not a claim that the proposed resource exists.

### 6. How it connects

Reach: a valid route/endpoint and security-group port. Allowed: the caller's exact IAM action/resource where AWS authorization applies. Password: the right secret field, session or signature where the operation requires one. Ask which of these three is actually failing before changing anything.

### 7. Code → Console → CLI

| Code / setting | Console path and expected evidence | Read-only CLI |
| --- | --- | --- |
| `infra/index.ts` → `import` | Use the explorer and Code → Console → CLI rows from each chapter; compare configured name/settings with the code. Explain-only resources should be absent. | `pnpm docs:check` |

### 8. Console mission

Open **Use the explorer and Code → Console → CLI rows from each chapter**. Use the built-in resource/target/relationship view where available. Read the configured endpoint, policy or trigger without revealing secrets. Question: which field proves this piece belongs to our stack, and which field proves its next hop is valid? Local emulator success is not proof of live IAM enforcement.

### 9. Follow one thing

Start with a booking id, request correlation id or SHA appropriate to this chapter. Find its entry boundary, the named code function, the next store/consumer and the resulting log. Record evidence at each handoff. In an explain-only chapter, sketch the proposed handoff instead of inventing deployed output.

### 10. When it breaks

Say which invariant each piece protects and which failure it cannot prevent. Then ask about traffic, latency, durability, privacy and budget before proposing another service.

### 11. Small details and cost

Keep the existing minitickets-dev names and tags. Check committed stack switches before interpreting a missing resource. No live writes are requested by this guide. Persistent stores/secrets/logs can still cost money while compute is off; an explain-only resource has no new bill because it is not created. [Deployment acceptance](../../20-deploy-day.md) gives measured local results and outstanding AWS checks.

### 12. Say it in an interview

Browser→ALB→web/API→Postgres/Valkey is the synchronous path. Booking→outbox→SNS→two SQS queues→Lambdas→SES or S3/DynamoDB is the side path. OIDC/ECR/SSM/CD changes versions. SGs govern reach, IAM grants actions, secrets prove identity. Optional CloudFront and explain-only features remain distinct. The trade-off is another independently failing boundary: name the invariant it protects and show the code/console evidence, rather than claiming a managed service makes failures impossible.

### 13. Check yourself

1. What did this piece add that the preceding city layers could not do?
2. Which failure is Reach, which is Allowed, and which is Password?
3. What would change at 10× traffic, and which proposed feature remains explain-only?

## Final system poster

```mermaid
flowchart TB
    browser["Browser"] --> alb["HTTPS ALB"]
    alb --> apps["Web / API Fargate"]
    apps --> stores["Postgres / Valkey"]
    stores -->|"outbox relay"| topic["SNS booking events"]
    topic --> queues["Separate SQS queues / DLQs"]
    queues --> workers["Email / ticket Lambdas"]
    workers --> outputs["SES / DynamoDB / private S3"]
```

GitHub OIDC → publish SHA images → ECR → SSM release tag → migration → ECS/Lambda rollout is the delivery path. CloudFront is optional/inactive. Reminder Scheduler, API Gateway check-in, SSE live seats, autoscaling and Lighthouse CI remain explain-only; the [interview scenarios](interview-scenarios.md) will connect their proposed locations.

## Map so far

Historical network-only checkpoint through chapter 2, with the names exactly as the AWS console shows them. Every arrow
says what allows it.

```mermaid
flowchart TB
    internet["The internet"]
    subgraph vpc["minitickets-dev-vpc · vpc-00b5d32f044694518 · 10.0.0.0/16"]
        igw["minitickets-dev-igw<br/>igw-038f7386d8ae5817d"]
        prt["minitickets-dev-public-rt<br/>rtb-05e17b5e39f52b3e3"]
        vrt["minitickets-dev-private-rt<br/>rtb-0a2e72b9a410ac899"]
        main["main route table (no name)<br/>rtb-08af5439534fccda6<br/>no subnet uses it"]
        pub1["minitickets-dev-public-1<br/>10.0.0.0/24 · us-east-1a"]
        pub2["minitickets-dev-public-2<br/>10.0.1.0/24 · us-east-1b"]
        priv1["minitickets-dev-private-1<br/>10.0.10.0/24 · us-east-1a"]
        priv2["minitickets-dev-private-2<br/>10.0.11.0/24 · us-east-1b"]
    end
    internet <-->|"igw attached to the VPC"| igw
    prt -->|"route 0.0.0.0/0 → igw"| igw
    pub1 -->|"association public-rta-1"| prt
    pub2 -->|"association public-rta-2"| prt
    priv1 -->|"association private-rta-1"| vrt
    priv2 -->|"association private-rta-2"| vrt
    pub1 <-.->|"route 10.0.0.0/16 → local<br/>(in every table)"| priv1
```

The `local` arrow is drawn once, but it joins every neighborhood to every other one, across both
districts.

Not drawn: the default network ACL `acl-09a685b41658e7427` (allows all traffic, on all four
subnets), the default security group, and the $20 budget (account-wide, chapter 1).

## Chapter index

Each chapter starts from the problem the one before leaves open.

| Chapter | The problem it solves | Status |
| ------- | ------- | --------------------- |
| [3. Security groups](#chapter-3-security-groups) | The roads exist. Guards now decide which building door accepts which visitor. | Written; verify live independently |
| [4. Public IPs and network interfaces](#chapter-4-public-ips-and-network-interfaces) | A worker needs an address as well as a guest-list entry. | Written; verify live independently |
| [5. The database and cache](#chapter-5-the-database-and-cache) | Workers need durable records and a shared short-term memory behind the walls. | Written; verify live independently |
| [6. Secrets](#chapter-6-secrets) | The worker needs a key safe, not passwords written on its name plate. | Written; verify live independently |
| [7. ECR](#chapter-7-ecr) | Workers must fetch an immutable packed app from the warehouse. | Written; verify live independently |
| [8. ECS](#chapter-8-ecs) | A manager must keep the right packed workers running and replace unhealthy ones. | Written; verify live independently |
| [9. IAM roles](#chapter-9-iam-roles) | The manager, workers and publisher need different staff badges. | Written; verify live independently |
| [10. The ALB](#chapter-10-the-alb) | Visitors need one HTTPS reception desk that sends pages and API calls to healthy staff. | Written; verify live independently |
| [11. Service Connect](#chapter-11-service-connect) | Web server rendering needs the API without going back through public reception. | Written; verify live independently |
| [12. CloudFront](#chapter-12-cloudfront) | An optional front layer can bring static files closer to visitors. | Implemented, inactive |
| [13. CI/CD](#chapter-13-cicd) | A publisher needs a short-lived badge and a deployment record, not laptop keys. | Written; verify live independently |
| [14. Queues, DLQs and SNS fan-out](#chapter-14-queues-dlqs-and-sns-fan-out) | Booking commits need two durable consumers without losing messages between SQL and delivery. | Written; verify live independently |
| [15. Lambda workers](#chapter-15-lambda-workers) | Queue messages need workers that scale independently from the API. | Written; verify live independently |
| [16. DynamoDB records](#chapter-16-dynamodb-records) | Consumers need durable dedupe and owner/date access patterns without an SQL connection pool. | Written; verify live independently |
| [17. SES delivery](#chapter-17-ses-delivery) | A confirmed booking needs an email delivery service with a verified sender. | Written; verify live independently |
| [18. Private S3 assets and signed tickets](#chapter-18-private-s3-assets-and-signed-tickets) | A ticket needs a private QR artifact and a short-lived way for its owner to read it. | Written; verify live independently |
| [19. Alarms and observability](#chapter-19-alarms-and-observability) | The city diary must show one booking across API and consumers and call for help when backlog grows. | Written; verify live independently |
| [20. Reminder scheduler (explain-only)](#chapter-20-reminder-scheduler-explain-only) | A reminder the day before would branch from ticket date access into the existing email path. | Explain-only |
| [21. Door check-in (explain-only)](#chapter-21-door-check-in-explain-only) | The door would authenticate a QR and atomically consume it once. | Explain-only |
| [22. Autoscaling (explain-only)](#chapter-22-autoscaling-explain-only) | A manager could add workers when traffic grows, but workers cannot create more seats. | Explain-only |
| [23. Debugging playbook](#chapter-23-debugging-playbook) | Follow the failed request through the city rather than restarting unrelated pieces. | Written; verify live independently |
| [24. The final poster](#chapter-24-the-final-poster) | The whole city should fit in an explanation you can give without memorizing 100 service names. | Written; verify live independently |

## How this connects

- **Uses:** the code in `infra/`, the step docs [12 network](../../12-infra-network.md) and
  [13 security groups](../../13-infra-security-groups.md), and
  [aws-foundations](../aws-foundations.md) (regions, ARNs, Reach / Allowed / Password).
- **Goes with:** [the explorer](infra-explorer.html), which draws this same city and grows with these
  chapters.
- **Cards:** [regions and AZs](../concepts/regions-and-azs.md), [VPC](../concepts/vpc.md),
  [subnets](../concepts/subnets.md), [route tables](../concepts/route-tables.md),
  [infrastructure as code](../concepts/infrastructure-as-code.md),
  [cost switches](../concepts/cost-switches.md), [budget alerts](../concepts/budget-alerts.md).
- **Then:** the [infra story](../infra-story.md) walks the same pieces in the order a request meets
  them, and the [CI/CD story](cicd-story.md) shows how a change reaches AWS.

## Every IAM badge: WHO / WHAT / ATTACHED

```mermaid
flowchart LR
    who["Trusted ECS / Lambda / OIDC principal"] -->|"Trust policy"| role["IAM role"]
    role -->|"Permission action + resource + condition"| target["Named AWS resource"]
    attached["Task / Lambda / GitHub job"] -->|"Uses role ARN"| role
```

| Role / attached runtime | WHO may wear it | WHAT it may do and where |
| --- | --- | --- |
| API execution / API + migration task start | ecs-tasks.amazonaws.com with account/task trust conditions | Managed image-pull/log policy plus GetSecretValue on named DB/cache/revalidation credentials. `infra/src/compute/iam.ts`; no SNS/S3 app access through this role. |
| API application / API task | ecs-tasks.amazonaws.com | ssmmessages channel APIs for ECS Exec; sns:Publish only booking topic; dynamodb:Query only tickets table; s3:GetObject only ticket/poster/staging prefixes; s3:PutObject only poster prefixes with AES256 condition. `infra/src/compute/iam.ts`. |
| Web execution / web task start | ecs-tasks.amazonaws.com | Image pull/log policy and GetSecretValue for the revalidation secret; no DB or ticket signing grants. `infra/src/compute/web-iam.ts`. |
| Email worker / worker Lambda | lambda.amazonaws.com | Receive/Delete/ChangeVisibility/GetQueueAttributes only jobs queue; GetItem/PutItem only processed-jobs table; SendEmail only named identities/from; log stream writes only worker group. `infra/src/jobs/worker-iam.ts`. |
| Ticket worker / ticket Lambda | lambda.amazonaws.com | Receive/Delete/GetQueueAttributes only ticket queue; Get/Put/UpdateItem tickets table; PutObject tickets/*; GetSecretValue signing secret; ticket log writes. `infra/src/tickets/iam.ts`. |
| Publish / GitHub publish job | Restricted GitHub OIDC repository subject | ECR upload/auth and release-repository read permissions; region/account/resource restrictions. `infra/src/publish-policy.ts`. |
| Deploy / approved GitHub deploy job | Restricted GitHub OIDC environment subject | Pulumi's named infrastructure actions, scoped PassRole, SSM release writes and ECS/Lambda deployment checks. Exact statement/resource/condition list in `infra/src/cicd.ts`; no stored AWS keys. |

The combined API file defines two different roles: execution reads/injects credentials; application publishes SNS, queries owner tickets, signs private reads and writes only staged/published poster prefixes with AES256. Do not attach execution permissions to application code. Managed execution policies also supply ECR/log actions. Full inline statement scopes are the authority; listing an action here does not grant it on every resource. OIDC subject restrictions, account/region scoping and PassRole conditions must remain intact.
