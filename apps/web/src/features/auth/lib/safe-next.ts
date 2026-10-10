// Decides where to go after login, based on the `next` value from the URL (?next=...).
// The URL is controlled by whoever made the link, so `next` must be treated as untrusted.
export function getSafeNext(next: string | null): string {
  // 1. Nothing given: go home.
  if (!next) return "/";

  // 2. Open redirect protection. An attacker could send a victim a link like
  //    /login?next=https://evil.com. If we redirected there after a real login, the victim
  //    would land on the attacker's look-alike site, trusting it because they just logged in.
  //    So we only accept a path on OUR site: it must start with "/", but not "//"
  //    ("//evil.com" means "any site, same protocol"). Browsers also treat "\" like "/",
  //    so "/\evil.com" is blocked too.
  const isRelativePath = next.startsWith("/") && !next.startsWith("//") && !next.includes("\\");

  // 3. Anything else (full URLs, "javascript:..." and so on): go home.
  return isRelativePath ? next : "/";
}
