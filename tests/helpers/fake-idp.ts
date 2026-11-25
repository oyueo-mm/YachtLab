import { createServer, type Server } from "node:http";
import { b64url } from "../../worker/src/oidc";

/**
 * A FAKE OpenID Connect provider on 127.0.0.1 for local end-to-end tests (browser sign-in included):
 * `/auth` redirects straight back with a code for the next queued subject, `/token` returns a signed
 * ID token, `/jwks` the public key. The Worker accepts it only when APP_URL is a loopback http address
 * (`TEST_OIDC_ISSUER`, worker/src/accounts-api.ts) — never in a deployed Worker.
 */
export type FakeIdp = { issuer: string; next(sub: string): void; close(): void };

export async function startFakeIdp(clientId = "test-client"): Promise<FakeIdp> {
  const keys = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey;
  const codes = new Map<string, { sub: string; nonce: string }>();
  const queue: string[] = [];
  let n = 0;
  let issuer = "";
  const sign = async (claims: Record<string, unknown>) => {
    const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
    const head = enc({ alg: "RS256", kid: "k1", typ: "JWT" }) + "." + enc(claims);
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(head)));
    return head + "." + b64url(sig);
  };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/jwks") return res.end(JSON.stringify({ keys: [{ ...jwk, kid: "k1", alg: "RS256", use: "sig" }] }));
    if (url.pathname === "/auth") {
      const code = "code-" + ++n + "-" + Math.random().toString(36).slice(2);
      codes.set(code, { sub: queue.shift() ?? "user" + n, nonce: url.searchParams.get("nonce") ?? "" });
      const back = new URL(url.searchParams.get("redirect_uri")!);
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      res.statusCode = 302;
      res.setHeader("location", back.toString());
      return res.end();
    }
    if (url.pathname === "/token") {
      let body = "";
      for await (const c of req) body += c;
      const who = codes.get(new URLSearchParams(body).get("code") ?? "");
      if (!who) {
        res.statusCode = 400;
        return res.end("{}");
      }
      const now = Math.floor(Date.now() / 1000);
      return res.end(JSON.stringify({ id_token: await sign({ iss: issuer, aud: clientId, sub: who.sub, iat: now, exp: now + 300, nonce: who.nonce }) }));
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { issuer, next: (sub) => void queue.push(sub), close: () => void server.close() };
}

/** Sign in through the fake provider with the same server flow as Google; returns the session. */
export async function fakeLogin(workerUrl: string, idp: FakeIdp, sub: string, origin: string): Promise<string> {
  idp.next(sub);
  const cs = "client-state-" + sub.padEnd(30, "x");
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cs))).toString("base64url");
  const start = await fetch(workerUrl + "/auth/google/start?cs=" + hash, { redirect: "manual" });
  const cookie = start.headers.get("set-cookie")!.split(";")[0];
  const auth = await fetch(start.headers.get("location")!, { redirect: "manual" });
  const back = await fetch(auth.headers.get("location")!, { redirect: "manual", headers: { cookie } });
  const code = decodeURIComponent(new URL(back.headers.get("location")!).hash.slice("#login=".length));
  const ex = await (await fetch(workerUrl + "/api/auth/exchange", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ code, clientState: cs }) })).json();
  return ex.session as string;
}
