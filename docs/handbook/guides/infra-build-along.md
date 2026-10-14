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
| [Coming next](#coming-next) | Chapters 3-15 | planned |

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

## Map so far

Everything built up to chapter 2, with the names exactly as the AWS console shows them. Every arrow
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

## Coming next

Each chapter starts from the problem the one before leaves open.

| Chapter | It adds | The problem it solves |
| ------- | ------- | --------------------- |
| 3. Security groups | A guard with a guest list at every door (`minitickets-dev-alb-sg`, `-web-sg`, `-api-sg`, `-db-sg`, `-redis-sg`) | Roads exist, but every door is open |
| 4. Public IPs and network interfaces | How a worker gets an address and a door (an ENI, elastic network interface) | What a "public IP" really is, and what it costs |
| 5. The database and cache | RDS Postgres and ElastiCache Valkey, behind the walls | Our data needs a home nobody outside can reach |
| 6. Secrets | Secrets Manager, the locked key safe | Passwords can't live in code or `.env` files |
| 7. ECR | The warehouse of packed apps | Workers need a place to fetch the app from |
| 8. ECS | Workers (tasks), the manager (service), the diary (CloudWatch Logs) | Something must run the app and restart it when it crashes |
| 9. IAM roles | Staff badges, and who may wear them | Workers must be *allowed* to open the key safe and the warehouse |
| 10. The ALB | The reception desk, staff lists (target groups), HTTPS on our domain | Visitors need one entrance that finds a healthy worker |
| 11. Service Connect | Web and api calling each other by name inside the city | Server-side pages must reach the api privately |
| 12. CloudFront | The optional front layer (`cdnEnabled`) | Caching and HTTPS close to the visitor |
| 13. CI/CD | GitHub's badges, publish and deploy, the note of which version is deployed | Shipping a change safely, without a laptop |
| 14. Debugging playbook | Reach → Allowed → Password, symptom by symptom | Finding what broke, fast |
| 15. The final poster | The whole city on one page | Explaining everything in one picture |

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
