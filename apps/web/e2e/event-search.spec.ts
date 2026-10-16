import { expect, test, type Route } from "@playwright/test";

function input(route: Route) {
  const value = JSON.parse(new URL(route.request().url()).searchParams.get("input") ?? "{}");
  return value["0"] as { q: string };
}
function answer(title: string) {
  return [{ result: { data: { items: [{ id: "00000000-0000-4000-8000-000000000099", title,
    venue: "Test hall", startsAt: "2028-01-01T00:00:00Z", seatsLeft: 10, totalSeats: 10 }], nextCursor: null } } }];
}

for (const ignoreAbort of [false, true]) {
  test(`a slow old search cannot replace the newer result (abort ignored: ${ignoreAbort})`, async ({ page }) => {
    // 1. The second variant models transport/server cancellation failing: key isolation must still win.
    if (ignoreAbort) await page.addInitScript(() => {
      window.AbortController = class extends AbortController { abort() {} };
    });
    await page.goto("/events");
    await expect(page.getByRole("heading", { name: "Indie Rock Showcase" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Search events", exact: true })).toHaveAttribute("data-hydrated", "true");
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let oldRoute: Route | undefined;
    await page.route("**/trpc/*events.search*", async route => {
      const q = input(route).q;
      if (q === "older") {
        oldRoute = route; entered(); await held;
        await route.fulfill({ json: answer("OLDER result") }).catch(() => {});
      } else await route.fulfill({ json: answer("NEWER result") });
    });
    const search = page.getByLabel("Search title or venue");
    await search.fill("older"); await started;
    // 2. Keeping previous results prevents a blank flash while the delayed request is outstanding.
    await expect(page.getByRole("heading", { name: "Indie Rock Showcase" })).toBeVisible();
    const aborted = ignoreAbort ? undefined : page.waitForEvent("requestfailed", request => request.url() === oldRoute!.request().url());
    await search.fill("newer");
    await expect(page.getByRole("heading", { name: "NEWER result" })).toBeVisible();
    if (aborted) await aborted;
    // 3. Wait for this specific late response's body, rather than unrelated page traffic.
    const late = ignoreAbort ? page.waitForEvent("requestfinished", request => request.url() === oldRoute!.request().url()) : undefined;
    release();
    if (late) await late;
    await expect(page.getByRole("heading", { name: "NEWER result" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "OLDER result" })).toHaveCount(0);
  });
}

test("10k real results remain windowed and the last page is reachable", async ({ page }) => {
  test.skip(process.env.P7_DEMO !== "1", "Run demo:search for the isolated 10k dataset");
  test.setTimeout(180_000);
  await page.goto("/events");
  await page.getByLabel("Search title or venue").fill("P7 Demo");
  await expect(page.getByRole("status")).toHaveText("50 events loaded");
  const region = page.getByRole("region", { name: "Event results" });
  await expect(region.getByRole("heading", { name: "P7 Demo 00001", exact: true })).toBeVisible();
  await expect(region.getByRole("heading", { name: "Indie Rock Showcase" })).toHaveCount(0);
  // 3. Load every real keyset page; the explicit button is also the accessible infinite-scroll fallback.
  for (let loaded = 100; loaded <= 10_000; loaded += 50) {
    await page.getByRole("button", { name: "Load more events", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(`${loaded} events loaded`);
  }
  await expect(page.getByRole("status")).toHaveText("10000 events loaded");
  await region.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(region.getByRole("heading", { name: "P7 Demo 10000", exact: true })).toBeVisible();
  const virtualRows = await region.getByRole("listitem").count();
  expect(virtualRows).toBeLessThanOrEqual(10);
  // 4. Compare DOM insertion + forced layout of the same card markup, without network/React query time.
  const metrics = await region.evaluate(element => {
    const template = element.querySelector("li")!;
    function measure(count: number, virtual: boolean) {
      const host = document.createElement("ul");
      host.style.cssText = `position:relative;width:${element.clientWidth}px;height:2080000px;`;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        const row = template.cloneNode(true) as HTMLElement;
        if (!virtual) row.removeAttribute("style");
        host.append(row);
      }
      element.after(host);
      const height = host.getBoundingClientRect().height;
      const nodes = host.querySelectorAll("*").length;
      const ms = performance.now() - start;
      host.remove();
      return { rows: count, nodes, ms: Number(ms.toFixed(2)), height };
    }
    return { windowed: measure(9, true), full: measure(10_000, false) };
  });
  console.log(`P7 DOM/layout benchmark (card clones, not React render): ${JSON.stringify(metrics)}; mounted actual rows=${virtualRows}`);
});
