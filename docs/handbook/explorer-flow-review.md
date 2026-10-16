# Explorer quality review — part 2: animated flows

History: see [CHANGELOG.md](CHANGELOG.md) or run `pnpm docs:history`

Open [the city explorer](guides/infra-explorer.html), choose **Play a flow**, then press **Play**. Space plays or pauses; the left and right arrows move one step. Speed changes the teaching pace. Each stop shows one simple sentence, its source file and symbol, and its Console path in the details panel.

## What the flows teach

| Flow | Stops | Details that matter |
| --- | ---: | --- |
| A booking end to end | 18 | Booking, seats and outbox commit together. The relay runs inside the API task. SNS forks into independent workers. Ticket creation reserves a row, stores the image, then marks it ready. My tickets checks the owner and signs a 120-second GET URL. |
| Search as you type | 7 | The browser waits for 250 quiet milliseconds. Changing the active query cancels unused requests. Separate query keys keep a late old answer out of the new results. |
| A failing email | 11 | The example assumes repeated SES refusals. Failed messages wait 10, 40 and 120 seconds. Three receives lead to the email DLQ, its one-minute alarm and an SNS email subscription that must be confirmed. |
| Sale day | 7 | One token stands for one request among many. The shared per-user bucket can return 429. Optional advisory Redis inventory can reject before the row lock. An inventory-store failure falls back to SQL; SQL remains final seat authority. |
| A deploy | 10 | A normal deploy follows CI, OIDC publication, environment approval, the current guard, phase A, migration, phase B, rolling tasks and smoke tests. Existing app images stay in phase A; SQL-free workers can update early. |
| Why can it connect? | 3 per connection | All 41 connections have ordered REACH, ALLOWED and PASSWORD checks: 123 checks total. Select a line or a ledger row, then use **Play REACH → ALLOWED → PASSWORD**. |

A tick means the committed configuration allows the check, or does not require it. A cross means that configuration blocks it. For example, the optional CloudFront hop has crosses because `cdnEnabled=false`. These are source explanations, not live AWS probes. A failure story does not change these permission facts.

One token follows branches in turn. Work inside an existing building uses a component stop; replies can follow a connection in reverse. The player samples the existing SVG path and draws no shortcut between stops. Timings are shortened for teaching; they are not a performance measurement.

## How to add a flow

1. Edit `generated/explorer-v3.json`. Add a `flows` entry with a unique `id`, a `title` and ordered `steps`.
2. Each step needs `title`, simple-English `line`, exactly one existing `component` or `connection` ID, `code: [{file, symbol}]`, and `console`. Use `reverse: true` only for a reply on a connection. Name a branch return in the narration.
3. Each connection needs `checks` in the order REACH, ALLOWED, PASSWORD. Each check has `name`, `line`, boolean `pass`, the exact deciding `rule`, `code` references and a Console path. State when a gate is not required rather than inventing a password or role.
4. Copy that catalogue into the HTML's `city-data` JSON, escaping `<` as `\u003c`. No player code changes are needed. Run `pnpm docs:check` and inspect the new flow in a browser.

The dynamic check flow uses `checks: true` and an existing `defaultConnection` instead of fixed steps. It uses whichever connection the reader selects.

## Verification evidence

- Headless Chromium opened the standalone file offline at 1600×1100. All six flows and all 56 stops passed; all 41 connection selections revealed the three checks in order. Page and console errors: **0**.
- Captured and visually reviewed six screenshots **during playback**, with the token in transit: flows 1, 3 and 6 in light and dark. The token stayed inside the visible map; narration, source reference and Console path were present beside it.
- Keyboard space/arrow navigation, previous/next boundaries, pause/resume at the same position, and 0.5× versus 2× speed passed. Reduced motion disabled autoplay and speed, hid token/trail, and retained step navigation. Native select keys, a 760px viewport and leaving a flow passed. Completion/restart and blocked CloudFront crosses passed; the reverse token matched the sampled path with zero coordinate error.
- Eight mutation probes made `pnpm docs:check` fail: unknown component, unknown connection, unknown default connection, nonexistent code symbol, blank narration, misordered checks, duplicate connection ID and blank check narration. The probes restored the catalogue and HTML byte for byte afterward.
- `pnpm docs:check` passed: 151 cards, 141 anchor slugs, 331 anchor places. `pnpm exec tsc -p scripts`, `pnpm exec eslint scripts/check-concepts.ts` and `git diff --check` passed.
- Local evidence lives in `/tmp/minitickets-explorer-flows/`: `screenshots.html`, six PNGs, `verification.json`, `validation.json` and `finish-checks.json`. These are verification artifacts, not committed source.
- Application unit/e2e tests, live AWS delivery/configuration and other browsers were not checked. No application or infrastructure code changed; owner servers were not needed or touched. The one approved non-docs edit is validation in `scripts/check-concepts.ts`.
