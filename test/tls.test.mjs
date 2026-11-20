import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { createServer as createTlsServer } from "node:tls";
import { join } from "node:path";
import { CHECKS, checkLive, tlsCert, oldTlsVersions } from "../skills/seo-supervisor/scripts/checks/tls.mjs";
import { SCRIPTS, tmp } from "./helpers.mjs";

const DAY = 864e5,
  NOW = Date.parse("2026-11-18T12:00:00Z");
const cert = ({ lifetime = 90, left = 60, san = "DNS:example.com, DNS:www.example.com", authorized = true } = {}) => ({
  authorized,
  authorizationError: authorized ? null : "SELF_SIGNED_CERT_IN_CHAIN",
  valid_from: new Date(NOW + (left - lifetime) * DAY).toUTCString(),
  valid_to: new Date(NOW + left * DAY).toUTCString(),
  subjectaltname: san,
});
// http:// answers with these redirects (with this status) in turn; the https origin answers 200 with these headers.
// www.example.com answers with `www(url)`, by default one 301 to the same path on https://example.com; null means it
// doesn't resolve.
const redirect = (location, status = 301) => new Response("", { status, headers: { location } });
const toApex = u => redirect(`https://example.com${u.pathname}`);
const fakeFetch =
  ({ hops = ["https://example.com/"], status = 301, hsts = true, www = toApex } = {}) =>
  async url => {
    const u = new URL(url);
    if (u.hostname === "www.example.com") {
      if (!www)
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("getaddrinfo ENOTFOUND www.example.com"), { code: "ENOTFOUND" }),
        });
      return www(u);
    }
    if (u.protocol === "https:")
      return new Response("", {
        status: 200,
        headers: hsts ? { "strict-transport-security": "max-age=63072000" } : {},
      });
    const i = Number(u.searchParams.get("hop") || 0);
    if (i >= hops.length) return new Response("plain http page", { status: 200 });
    return redirect(hops[i], status);
  };
// The keys raised (with `all`, "key url detail"), plus the notes and whether the host resolved.
async function check(c, fetchOpts, { path, connect = async () => c, oldTls = async () => [], all } = {}) {
  const found = [];
  const r = await checkLive("https://example.com", {
    add: (key, url, detail) => found.push(all ? `${key} ${url} ${detail ?? ""}`.trim() : key),
    now: NOW,
    connect,
    oldTls,
    fetchFn: fakeFetch(fetchOpts),
    path,
  });
  return { found: found.sort(), notes: r.notes, unresolved: !!r.unresolved };
}
const run = async (...a) => (await check(...a)).found;

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

test("the other host redirecting in one permanent hop with the path kept raises nothing; an http→https upgrade on it first is fine", async () => {
  assert.deepEqual(await run(cert(), {}, { path: "/pricing/" }), []);
  // hstspreload.org wants http://www. to go to https://www. first, then on to the apex. https://hstspreload.org
  const upgradeFirst = u => (u.protocol === "http:" ? redirect(`https://www.example.com${u.pathname}`) : toApex(u));
  assert.deepEqual(await run(cert(), { www: upgradeFirst }, { path: "/pricing/" }), []);
  const noWww = async h => {
    if (h === "www.example.com")
      throw Object.assign(new Error("getaddrinfo ENOTFOUND www.example.com"), { code: "ENOTFOUND" });
    return cert();
  };
  assert.deepEqual(
    await run(cert(), { www: null }, { path: "/pricing/", connect: noWww }),
    [],
    "an other host that doesn't resolve is fine: the site has one host",
  );
});

test("the other host serving pages itself is flagged: the site exists twice", async () => {
  const f = await run(
    cert(),
    { www: () => new Response("<h1>Home</h1>", { status: 200 }) },
    { path: "/pricing/", all: true },
  );
  assert.deepEqual(
    f,
    [
      "http://www.example.com/",
      "http://www.example.com/pricing/",
      "https://www.example.com/",
      "https://www.example.com/pricing/",
    ].map(u => `host-not-redirected ${u} answers 200 itself`),
  );
  assert.deepEqual(CHECKS["host-not-redirected"].slice(0, 2), ["URL-03", "high"]);
});

test("a temporary redirect from http:// or from the other host is flagged", async () => {
  assert.deepEqual(await run(cert(), { status: 302 }, { all: true }), [
    "redirect-temporary http://example.com/ 302 → https://example.com/",
  ]);
  const f = await run(
    cert(),
    { www: u => redirect(`https://example.com${u.pathname}`, 307) },
    { path: "/pricing/", all: true },
  );
  assert.equal(f.length, 4, f.join("\n"));
  assert.ok(
    f.every(x => x.startsWith("redirect-temporary ")),
    f.join("\n"),
  );
  assert.ok(f.includes("redirect-temporary https://www.example.com/pricing/ 307 → https://example.com/pricing/"));
  assert.deepEqual(CHECKS["redirect-temporary"].slice(0, 2), ["URL-03", "medium"]);
});

test("a chain from the other host, or a deeper page landing on the home page, is flagged", async () => {
  // www → www again → apex is two hops, from both http:// and https://.
  const twice = u =>
    u.searchParams.has("again") ? toApex(u) : redirect(`https://www.example.com${u.pathname}?again=1`);
  assert.deepEqual(await run(cert(), { www: twice }), ["host-redirect-hops", "host-redirect-hops"]);
  const home = () => redirect("https://example.com/");
  assert.deepEqual(
    await run(cert(), { www: home }, { path: "/pricing/", all: true }),
    ["http", "https"].map(s => `host-redirect-drops-path ${s}://www.example.com/pricing/ → https://example.com/`),
  );
  for (const key of ["host-redirect-hops", "host-redirect-drops-path"])
    assert.deepEqual(CHECKS[key].slice(0, 2), ["URL-03", "medium"]);
});

const failing =
  (code, message = `connect ${code} 93.184.215.14:443`) =>
  async () => {
    throw Object.assign(new Error(message), { code });
  };
test("an HTTPS connection that fails is a high finding: refused or timed out, or no HTTPS at all", async () => {
  for (const code of ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET"])
    assert.deepEqual(
      await run(null, {}, { connect: failing(code) }),
      ["https-unreachable"],
      `${code}, while http:// redirects to https://`,
    );
  assert.deepEqual(
    await run(null, { hops: [] }, { connect: failing("ECONNREFUSED") }),
    ["http-not-redirected", "https-missing"],
    "http:// serves the site and nothing answers on https://",
  );
  assert.deepEqual(
    await run(null, {}, { connect: failing("ERR_SSL_WRONG_VERSION_NUMBER", "wrong version number") }),
    ["https-missing"],
    "port 443 answers without TLS",
  );
  for (const key of ["https-unreachable", "https-missing"])
    assert.deepEqual(CHECKS[key].slice(0, 2), ["TRUST-07", "high"]);
  assert.notEqual(CHECKS["https-unreachable"][2](1), CHECKS["https-missing"][2](1));
});

test("a host name that doesn't resolve is a note, not a finding, and leaves the live checks unmeasured", async () => {
  const r = await check(null, {}, { connect: failing("ENOTFOUND", "getaddrinfo ENOTFOUND example.com") });
  assert.deepEqual(r.found, []);
  assert.equal(r.unresolved, true);
  assert.match(r.notes.join(" "), /doesn't resolve/);
  assert.equal((await check(cert())).unresolved, false);
});

// The real TLS reader against a local HTTPS server with a self-signed certificate made at run time (needs openssl).
let openssl = true;
try {
  execFileSync("openssl", ["version"], { stdio: "ignore" });
} catch {
  openssl = false;
}
const selfSigned = (days = 3) => {
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
      String(days),
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ],
    { stdio: "ignore" },
  );
  return { key: readFileSync(key), cert: readFileSync(crt) };
};
test(
  "tlsCert reads a live certificate: dates, names and trust",
  { skip: !openssl && "openssl not installed" },
  async () => {
    const server = createServer(selfSigned(), (req, res) => res.end("ok"));
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

// Node offers TLS 1.0 and 1.1 only at OpenSSL security level 0.
// https://nodejs.org/api/tls.html#openssl-security-level
test(
  "old TLS versions are a low TRUST-01 finding only with --check-live",
  { skip: !openssl && "openssl not installed" },
  async () => {
    assert.deepEqual(CHECKS["tls-old-versions"].slice(0, 2), ["TRUST-01", "low"]);
    const pem = selfSigned(30),
      listen = async opts => {
        const s = createTlsServer({ ...pem, ...opts }, socket => socket.end());
        await new Promise(ok => s.listen(0, "127.0.0.1", ok));
        return s;
      };
    const old = await listen({ minVersion: "TLSv1", ciphers: "DEFAULT@SECLEVEL=0" }),
      modern = await listen({});
    try {
      assert.deepEqual(
        await oldTlsVersions("localhost", old.address().port),
        ["TLSv1", "TLSv1.1"],
        "a server that still accepts both",
      );
      assert.deepEqual(
        await oldTlsVersions("localhost", modern.address().port),
        [],
        "Node's own default server (TLS 1.2 and up)",
      );
    } finally {
      for (const s of [old, modern]) await new Promise(ok => s.close(ok));
    }
    assert.deepEqual(await run(cert(), {}, { all: true, oldTls: async () => ["TLSv1", "TLSv1.1"] }), [
      "tls-old-versions https://example.com accepts TLS 1.0 and TLS 1.1",
    ]);
    assert.deepEqual(
      await run(
        null,
        {},
        {
          connect: failing("ECONNREFUSED"),
          oldTls: () => assert.fail("no old-version probe without an HTTPS connection"),
        },
      ),
      ["https-unreachable"],
    );
    // checkLive is the only caller, and the crawler calls it only with --check-live.
    const crawler = readFileSync(join(SCRIPTS, "seo-crawl.mjs"), "utf8");
    assert.equal(crawler.match(/checkLive\(/g).length, 1);
    assert.match(crawler, /=\s*CHECK_LIVE\s*&&[\s\S]*?await checkLive\(/);
  },
);
