import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { join } from "node:path";
import { checkLive, tlsCert } from "../skills/seo-supervisor/scripts/checks/tls.mjs";
import { tmp } from "./helpers.mjs";

const DAY = 864e5,
  NOW = Date.parse("2026-11-18T12:00:00Z");
const cert = ({ lifetime = 90, left = 60, san = "DNS:example.com, DNS:www.example.com", authorized = true } = {}) => ({
  authorized,
  authorizationError: authorized ? null : "SELF_SIGNED_CERT_IN_CHAIN",
  valid_from: new Date(NOW + (left - lifetime) * DAY).toUTCString(),
  valid_to: new Date(NOW + left * DAY).toUTCString(),
  subjectaltname: san,
});
// http:// answers with these redirects in turn; the https origin answers 200 with these headers.
const fakeFetch =
  ({ hops = ["https://example.com/"], hsts = true } = {}) =>
  async url => {
    const u = new URL(url);
    if (u.protocol === "https:")
      return new Response("", {
        status: 200,
        headers: hsts ? { "strict-transport-security": "max-age=63072000" } : {},
      });
    const i = Number(u.searchParams.get("hop") || 0);
    if (i >= hops.length) return new Response("plain http page", { status: 200 });
    return new Response("", { status: 301, headers: { location: hops[i] } });
  };
async function run(c, fetchOpts) {
  const found = [];
  await checkLive("https://example.com", {
    add: (key, url, detail) => found.push(key),
    now: NOW,
    connect: async () => c,
    fetchFn: fakeFetch(fetchOpts),
  });
  return found.sort();
}

test("a healthy certificate, one https hop and HSTS raise nothing", async () => {
  assert.deepEqual(await run(cert()), []);
});

test("certificate expiry scales with the certificate's lifetime", async () => {
  assert.deepEqual(await run(cert({ left: 1 })), ["cert-expired"], "1 day left is a blocker");
  assert.deepEqual(await run(cert({ lifetime: 6, left: 4 })), [], "a healthy 6-day certificate isn't flagged");
  assert.deepEqual(await run(cert({ lifetime: 90, left: 20 })), ["cert-expiring"], "20 of 90 days left is high");
  assert.deepEqual(
    await run(cert({ lifetime: 398, left: 100 })),
    [],
    "100 days left on a yearly certificate is fine (30-day ceiling)",
  );
});

test("an untrusted certificate and a certificate missing the www host are blockers", async () => {
  assert.deepEqual(await run(cert({ authorized: false })), ["cert-untrusted"]);
  assert.deepEqual(await run(cert({ san: "DNS:example.com" })), ["cert-host-mismatch"]);
});

test("http that takes two hops to https, or stays on http, is flagged", async () => {
  assert.deepEqual(await run(cert(), { hops: ["http://www.example.com/?hop=1", "https://example.com/"] }), [
    "http-redirect-hops",
  ]);
  assert.deepEqual(await run(cert(), { hops: [] }), ["http-not-redirected"]);
});

test("a missing HSTS header is flagged", async () => {
  assert.deepEqual(await run(cert(), { hsts: false }), ["no-hsts"]);
});

// The real TLS reader against a local HTTPS server with a self-signed certificate made at run time (needs openssl).
let openssl = true;
try {
  execFileSync("openssl", ["version"], { stdio: "ignore" });
} catch {
  openssl = false;
}
test(
  "tlsCert reads a live certificate: dates, names and trust",
  { skip: !openssl && "openssl not installed" },
  async () => {
    const dir = tmp(),
      key = join(dir, "key.pem"),
      crt = join(dir, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        crt,
        "-days",
        "3",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost",
      ],
      { stdio: "ignore" },
    );
    const server = createServer({ key: readFileSync(key), cert: readFileSync(crt) }, (req, res) => res.end("ok"));
    await new Promise(ok => server.listen(0, "127.0.0.1", ok));
    try {
      const c = await tlsCert("localhost", server.address().port);
      assert.equal(c.authorized, false, "self-signed is untrusted");
      assert.match(c.subjectaltname, /DNS:localhost/);
      const days = (Date.parse(c.valid_to) - Date.now()) / DAY;
      assert.ok(days > 2 && days <= 3.01, `expires in about 3 days (${days})`);
    } finally {
      await new Promise(ok => server.close(ok));
    }
  },
);
