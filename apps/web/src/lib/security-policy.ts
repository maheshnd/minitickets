// 1. Script nonces are per response. Inline style attributes remain allowed for React layouts;
//    style elements require a nonce in production. Dev additionally needs eval/HMR connections.
// @concept: csp
export function securityPolicy(nonce: string, dev: boolean, apiOrigin = "") {
  const api = apiOrigin ? new URL(apiOrigin).origin : "";
  const s3 = "https://*.s3.amazonaws.com https://*.s3.us-east-1.amazonaws.com";
  return [
    "default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' ${dev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`, "style-src-attr 'unsafe-inline'",
    `connect-src 'self' ${api} ${s3}${dev ? " http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*" : ""}`,
    `img-src 'self' data: blob: ${s3}${dev ? " http://localhost:* http://127.0.0.1:*" : ""}`,
    "font-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join("; ");
}
