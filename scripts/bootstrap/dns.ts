import { capture } from "./shell.ts";

// The DNS records you add BY HAND at Cloudflare (our DNS is not in Route 53, so Pulumi cannot add
// them): the certificate's validation record and the 3 SES DKIM records. Then: are they live yet?
//
//   pulumi stack output ──▶ records ──▶ printed in Cloudflare's format ──▶ you add them
//                                                         │
//   dig (every 60 s) ── "does public DNS answer with the right value yet?" ◀──┘

export type DnsRecord = { name: string; type: string; value: string; why: string };

// 1. Compare DNS names the way DNS does: no case, no final dot ("A.example.com." = "a.example.com").
export function sameName(a: string, b: string): boolean {
  const clean = (name: string) => name.trim().toLowerCase().replace(/\.$/, "");
  return clean(a) === clean(b);
}

// 2. Cloudflare's "Name" field is the name WITHOUT the zone (the domain you own there):
//    "_abc.minitickets.theversehub.in" in zone "theversehub.in" -> "_abc.minitickets". The zone itself -> "@".
export function nameInZone(fqdn: string, zone: string): string {
  const name = fqdn.trim().toLowerCase().replace(/\.$/, "");
  const apex = zone.trim().toLowerCase().replace(/\.$/, "");
  if (name === apex) return "@";
  return name.endsWith(`.${apex}`) ? name.slice(0, -(apex.length + 1)) : name;
}

// 3. Which zone holds this name? Ask DNS for an SOA record (the record that starts every zone),
//    from the name upward: minitickets.theversehub.in (none: it is a CNAME) -> theversehub.in (yes).
export function findZone(domain: string): string | undefined {
  const labels = domain.toLowerCase().replace(/\.$/, "").split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    const answer = capture("dig", ["+noall", "+answer", "SOA", candidate]);
    const hasSoa = answer.stdout.split("\n").some((line) => {
      const [owner, , , type] = line.split(/\s+/);
      return type === "SOA" && owner !== undefined && sameName(owner, candidate);
    });
    if (hasSoa) return candidate;
  }
  return undefined;
}

// 4. Does public DNS already answer this record with the right value? (CNAME records only: all of ours are.)
export function isLive(record: DnsRecord): boolean {
  const answer = capture("dig", ["+short", record.type, record.name]);
  return answer.stdout.split("\n").some((line) => line.trim() !== "" && sameName(line, record.value));
}

// 5. Print the records as one Cloudflare form each: Type, Name, Target, Proxy status.
//    "DNS only" (the grey cloud): Cloudflare must answer with OUR value. "Proxied" would hide it
//    behind Cloudflare's own address, and ACM / SES would never see the record.
export function printCloudflare(records: DnsRecord[], zone: string | undefined) {
  console.log(`      Cloudflare -> ${zone ?? "<your zone>"} -> DNS -> Records -> Add record, once per row:`);
  for (const record of records) {
    const name = zone ? nameInZone(record.name, zone) : record.name;
    console.log(`        ${record.why}`);
    console.log(`          Type ${record.type}   Name ${name}   Target ${record.value.replace(/\.$/, "")}   Proxy status: DNS only`);
  }
}

// 6. Check every 60 s until all records are live. Ctrl+C stops WAITING (not the script): the
//    checks after this still run, and a rerun of the bootstrap checks again from here.
export async function waitUntilLive(records: DnsRecord[], once: boolean): Promise<DnsRecord[]> {
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGINT", stop);
  try {
    for (;;) {
      const missing = records.filter((record) => !isLive(record));
      const time = new Date().toTimeString().slice(0, 8);
      if (missing.length === 0) {
        console.log(`      ${time} all ${records.length} records answer with the right value.`);
        return [];
      }
      console.log(`      ${time} ${records.length - missing.length}/${records.length} live; waiting for: ${missing.map((r) => r.why).join(", ")}`);
      if (once || stopped) return missing;
      console.log("      next check in 60 s (Ctrl+C stops waiting; rerun the bootstrap to check again)");
      for (let second = 0; second < 60 && !stopped; second++) await new Promise((resolve) => setTimeout(resolve, 1000));
      if (stopped) {
        console.log("\n      Stopped waiting.");
        return missing;
      }
    }
  } finally {
    process.off("SIGINT", stop);
  }
}
