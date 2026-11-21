import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";
import {
  CHECKS,
  cspProblems,
  hstsRead,
  insecureResources,
  serverHoles,
} from "../skills/seo-supervisor/scripts/checks/technical.mjs";
import { redact, hideSecrets } from "../skills/seo-supervisor/scripts/lib/redact.mjs";
import { findBrowser, renderArgs, renderPage, startGuard } from "../skills/seo-supervisor/scripts/checks/render.mjs";
import { runLighthouse } from "../skills/seo-supervisor/scripts/checks/lighthouse.mjs";
import { checkVisual } from "../skills/seo-supervisor/scripts/checks/visual.mjs"; // in Lighthouse's flags too

// ---------- redaction ----------

test("redact masks the home folder, emails and tokens in error text, and leaves ordinary URLs alone", () => {
  const home = "C:\\Users\\Jane Doe";
  const err =
    "Command failed: chrome.exe --user-data-dir=C:\\Users\\Jane Doe\\AppData\\Local\\Temp\\x (owner jane@example.com) Authorization: Bearer ya29.a0AfH6SMBx-1 key AIzaSyA1234567890abcdefghijklmnopqrstuv";
  const out = redact(err, { home });
  assert.ok(!out.includes("Jane Doe") && out.includes("--user-data-dir=~\\AppData"), out);
  assert.ok(!out.includes("jane@example.com") && out.includes("[email]"), out);
  assert.ok(!/ya29\.|AIza/.test(out), out);
  assert.equal(
    redact("/home/sam/project/seo-audit: ENOENT", { home: "/root" }),
    "~/project/seo-audit: ENOENT",
    "anyone's home folder, not only this machine's",
  );
  assert.equal(redact("/Users/kim/Library/x", { home: "/root" }), "~/Library/x");
  const url = "https://example.com/img/logo@2x.png?keyword=boilers&page=2";
  assert.equal(redact(url), url, "an image named @2x and a keyword parameter aren't secrets");
  assert.equal(redact("write to sam@example.com", { emails: false }), "write to sam@example.com");
});

test("hideSecrets masks token, key, password and signature query values, and nothing else", () => {
  assert.equal(
    hideSecrets("https://example.com/p/?token=abc123&page=2"),
    "https://example.com/p/?token=[hidden]&page=2",
  );
  assert.equal(
    hideSecrets("https://example.com/?api_key=k1&password=hunter2#top"),
    "https://example.com/?api_key=[hidden]&password=[hidden]#top",
  );
  assert.equal(
    hideSecrets("https://bucket.s3.amazonaws.com/a.pdf?X-Amz-Credential=AK%2F1&X-Amz-Signature=f00d&X-Amz-Expires=60"),
    "https://bucket.s3.amazonaws.com/a.pdf?X-Amz-Credential=[hidden]&X-Amz-Signature=[hidden]&X-Amz-Expires=60",
  );
  assert.equal(
    hideSecrets("listed in https://example.com/s.xml?access_token=ABC, see https://example.com/?auth=9"),
    "listed in https://example.com/s.xml?access_token=[hidden], see https://example.com/?auth=[hidden]",
  );
  for (const plain of [
    "https://example.com/?keyword=key&monkey=1&passage=2",
    "https://example.com/token/page?q=tokens",
    "https://example.com/?utm_source=x",
    "https://example.com/p;jsessionid=ABC",
  ])
    assert.equal(hideSecrets(plain), plain, "session IDs are the sitemap check's evidence");
});

// ---------- weak CSP ----------

test("cspProblems: unsafe-inline or unsafe-eval scripts, any-host sources, and no object-src or base-uri", () => {
  assert.deepEqual(
    cspProblems("script-src 'nonce-r4nd0m' 'strict-dynamic'; object-src 'none'; base-uri 'none'"),
    [],
    "web.dev's strict CSP",
  );
  assert.deepEqual(
    cspProblems(
      "script-src 'nonce-r4nd0m' 'strict-dynamic' 'unsafe-inline' https:; object-src 'none'; base-uri 'self'",
    ),
    [],
    "its fallbacks for old browsers are ignored by current ones",
  );
  assert.deepEqual(
    cspProblems("default-src 'self'; frame-ancestors 'none'"),
    [],
    "an allowlist of the site's own files needs no base-uri",
  );
  assert.deepEqual(cspProblems("default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'"), [
    "scripts may run inline ('unsafe-inline')",
    "scripts may run eval() ('unsafe-eval')",
  ]);
  assert.deepEqual(cspProblems("script-src * 'self'; object-src 'none'"), ["scripts may load from any site (*)"]);
  assert.deepEqual(cspProblems("script-src https: data:; object-src 'none'"), [
    "scripts may load from any site (https:, data:)",
  ]);
  assert.deepEqual(cspProblems("frame-ancestors 'none'; upgrade-insecure-requests"), [
    "no script-src or default-src, so scripts aren't limited",
    "no object-src or default-src, so plugins aren't limited",
  ]);
  assert.deepEqual(cspProblems("script-src 'nonce-abc'; object-src 'none'"), [
    "no base-uri, so an injected <base> tag can move the page's scripts",
  ]);
  assert.deepEqual(
    cspProblems(
      "script-src 'self' 'unsafe-inline'; object-src 'none', script-src 'nonce-x'; object-src 'none'; base-uri 'none'",
    ),
    [],
    "two policies both apply, so the strict one wins",
  );
  assert.deepEqual(
    cspProblems("SCRIPT-SRC 'SELF' 'UNSAFE-INLINE'; OBJECT-SRC 'NONE'"),
    ["scripts may run inline ('unsafe-inline')"],
    "names and keywords in any case",
  );
});

// ---------- HSTS ----------

test("hstsRead: the first header field as browsers read it (RFC 6797), with what the preload list still needs", () => {
  assert.deepEqual(hstsRead("max-age=63072000; includeSubDomains; preload"), {
    maxAge: 63072000,
    includeSubDomains: true,
    preload: true,
    invalid: null,
    missing: [],
  });
  assert.deepEqual(hstsRead("max-age=31536000"), {
    maxAge: 31536000,
    includeSubDomains: false,
    preload: false,
    invalid: null,
    missing: ["includeSubDomains", "preload"],
  });
  assert.deepEqual(
    hstsRead('Max-Age="300" ; INCLUDESUBDOMAINS').missing,
    ["a max-age of at least 31536000", "preload"],
    "quoted values and any case",
  );
  assert.equal(hstsRead("max-age=31536000; includeSubDomains").invalid, null);
  assert.equal(hstsRead("max-age=1y").invalid, "max-age isn't a whole number of seconds");
  assert.equal(hstsRead("includeSubDomains; preload").invalid, "there's no max-age, which is required");
  assert.equal(hstsRead("max-age=300; max-age=31536000").invalid, "max-age appears twice");
  assert.equal(
    hstsRead("max-age=31536000; includeSubDomains; includesubdomains").invalid,
    "includesubdomains appears twice",
  );
  assert.equal(
    hstsRead("max-age=31536000 includeSubDomains").invalid,
    "it doesn't follow the header's syntax (directives separated by ;)",
  );
  assert.equal(
    hstsRead("max-age=31536000; includeSubDomains, max-age=0").maxAge,
    31536000,
    "a second header field is ignored, as browsers do",
  );
  assert.equal(hstsRead("max-age=31536000;; foo=bar").invalid, null, "empty and unknown directives are allowed");
});

// ---------- mixed content ----------

test("insecureResources: http:// stylesheets, preloads, scripts, media, embeds and images, in the head and the body", () => {
  const html = `<!doctype html><html><head><link rel="stylesheet" href="http://cdn.example/a.css"><link rel="preload" as="font" href="http://cdn.example/f.woff2"><link rel="modulepreload" href="http://cdn.example/m.js"><script src="http://cdn.example/s.js"></script><link rel="icon" href="http://cdn.example/i.png"><link rel="canonical" href="http://example.com/"></head>
<body><a href="http://example.com/old">old link</a><img src="https://cdn.example/ok.png" srcset="http://cdn.example/x1.png 1x, https://cdn.example/x2.png 2x"><video src="http://media.example/v.mp4" poster="http://media.example/p.jpg"><source src="http://media.example/v.webm"><track src="http://media.example/t.vtt"></video><audio src="http://media.example/a.mp3"></audio><embed src="http://media.example/e.swf"><object data="http://media.example/o.pdf"></object><iframe src="http://media.example/frame"></iframe>
<img src="/local.png"><img src="//cdn.example/proto.png"><!-- <img src="http://old.example/x.png"> --><script>const s = '<img src="http://in.script/x.png">'</script></body></html>`;
  assert.deepEqual(
    insecureResources(html).map(r => `${r.kind} ${r.url}`),
    [
      "stylesheet http://cdn.example/a.css",
      "preload http://cdn.example/f.woff2",
      "preload http://cdn.example/m.js",
      "script http://cdn.example/s.js",
      "image http://cdn.example/x1.png",
      "video http://media.example/v.mp4",
      "image http://media.example/p.jpg",
      "media http://media.example/v.webm",
      "media http://media.example/t.vtt",
      "audio http://media.example/a.mp3",
      "embed http://media.example/e.swf",
      "embed http://media.example/o.pdf",
      "frame http://media.example/frame",
    ],
    "links, canonicals, icons, comments and script text aren't loads that can be mixed content",
  );
  assert.deepEqual(
    insecureResources(
      `<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests"><img src="http://cdn.example/x.png">`,
    ),
    [],
    "the browser upgrades them all",
  );
  assert.deepEqual(
    insecureResources(`<img src="http://cdn.example/x.png">`, "default-src https:; upgrade-insecure-requests"),
    [],
    "the header's upgrade-insecure-requests too",
  );
  assert.deepEqual(insecureResources(`<link rel="stylesheet" href="/a.css"><img src="https://cdn.example/x.png">`), []);
});

// ---------- server software with known critical holes ----------

test("serverHoles: Apache and nginx versions with the vendor's top-rated holes, never a distribution's build or a bare name", () => {
  const ids = s => serverHoles(s)?.cves.map(c => c.id) ?? null;
  assert.deepEqual(ids("Apache/2.4.49 (Unix)"), ["CVE-2021-41773", "CVE-2021-42013"]);
  assert.deepEqual(ids("Apache/2.4.50"), ["CVE-2021-42013"]);
  assert.deepEqual(ids("Apache/2.4.62 (Unix) OpenSSL/3.0.13"), ["CVE-2026-119618"]);
  assert.deepEqual(ids("Apache/2.4.55"), ["CVE-2026-119618"]);
  for (const ok of [
    "Apache/2.4.71 (Unix)",
    "Apache/2.4.54",
    "Apache/2.4.51",
    "Apache/2.4.62 (Ubuntu)",
    "Apache/2.4.62 (Debian)",
    "Apache/2.4.57 (Red Hat Enterprise Linux)",
    "Apache",
    "nginx",
    "cloudflare",
    "",
    null,
  ])
    assert.equal(serverHoles(ok), null, String(ok));
  assert.deepEqual(ids("nginx/1.24.0"), ["CVE-2026-123007"]);
  assert.deepEqual(ids("nginx/1.31.8"), ["CVE-2026-123007"]);
  assert.deepEqual(ids("nginx/1.30.6"), ["CVE-2026-123007"]);
  for (const ok of ["nginx/1.30.7", "nginx/1.31.9", "nginx/1.32.0", "nginx/1.9.4", "nginx/1.24.0 (Ubuntu)"])
    assert.equal(serverHoles(ok), null, ok);
  assert.match(serverHoles("nginx/1.24.0").name, /^nginx 1\.24\.0$/);
});

// ---------- the checks in the crawler ----------

const page = (title, body = "", head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="What ${title} is about, in a sentence or two for search results."><meta property="og:title" content="${title}">${head}</head><body><main><h1>${title}</h1><p>Boiler repairs and servicing across Leeds, with a written estimate before any work starts and a guarantee after.</p>${body}</main></body></html>`;
// Pages ({ "/path/": html }) crawled as https://example.com; headers by path; sitemaps by path (listed in robots.txt).
async function crawl(pages, { headers = {}, sitemaps = {}, args = [] } = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(
    join(dir, "robots.txt"),
    `User-agent: *\nAllow: /\n${Object.keys(sitemaps)
      .map(p => `Sitemap: https://example.com${p}\n`)
      .join("")}`,
  );
  const files = Object.fromEntries(
    Object.entries(sitemaps).map(([p, body]) => [p, { type: "application/xml", body: Buffer.from(body) }]),
  );
  const site = await serve(dir, { headers, files });
  try {
    await node([
      join(SCRIPTS, "seo-crawl.mjs"),
      "--url",
      site.url,
      "--site-origin",
      "https://example.com",
      "--out",
      out,
      ...args,
    ]);
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}
const find = (r, check) => r.findings.find(f => f.check === check);
const details = (r, check) => (find(r, check)?.evidence || []).map(e => e.detail);
const SAFE = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Content-Security-Policy":
    "script-src 'nonce-abc' 'strict-dynamic'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
  "Server": "nginx",
};
const NEW = ["csp-weak", "hsts-no-subdomains", "hsts-invalid", "mixed-content", "server-known-holes"];

let weakRun, safeRun;
const weak = () =>
  (weakRun ||= crawl(
    {
      "/": page(
        "Home",
        `<a href="/media/">Media</a><a href="/upgraded/">Upgraded</a>`,
        `<link rel="stylesheet" href="http://cdn.example/site.css">`,
      ),
      "/media/": page("Media", `<video src="http://media.example/clip.mp4"></video><img src="/local.png" alt="">`),
      "/upgraded/": page(
        "Upgraded",
        `<img src="http://cdn.example/x.png" alt="">`,
        `<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">`,
      ),
    },
    {
      headers: {
        "/": {
          "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'",
          "Strict-Transport-Security": "max-age=31536000; max-age=0",
          "Server": "Apache/2.4.49 (Unix)",
          "X-Content-Type-Options": "nosniff",
        },
      },
      sitemaps: {
        "/sitemap.xml": `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></url><url><loc>https://example.com/preview/?token=s3cr3t-value&amp;id=4</loc></url></urlset>`,
      },
    },
  ));
const safe = () =>
  (safeRun ||= crawl(
    {
      "/": page(
        "Home",
        `<a href="/about/">About</a><img src="/hero.png" alt="Hero">`,
        `<link rel="stylesheet" href="/site.css">`,
      ),
      "/about/": page("About", `<img src="https://cdn.example/team.png" alt="Team">`),
    },
    { headers: { "/": SAFE } },
  ));

test("crawler: a weak CSP, broken HSTS, a vulnerable server version and http:// resources are each flagged on the home page", async () => {
  const r = await weak();
  assert.deepEqual(find(r, "csp-weak") && [find(r, "csp-weak").rule, find(r, "csp-weak").severity], [
    "TRUST-01",
    "low",
  ]);
  assert.deepEqual(
    details(r, "csp-weak"),
    ["scripts may run inline ('unsafe-inline')"],
    "default-src 'self' limits plugins too",
  );
  assert.equal(
    details(r, "hsts-invalid")[0],
    "max-age appears twice, so browsers ignore the whole header: max-age=31536000; max-age=0",
  );
  assert.ok(!find(r, "hsts-no-subdomains"), "an invalid header isn't judged on its directives");
  const s = find(r, "server-known-holes");
  assert.deepEqual([s.rule, s.severity, s.status], ["TRUST-01", "needs-decision", "needs-decision"]);
  assert.match(s.evidence[0].detail, /^Server: Apache\/2\.4\.49 \(Unix\): CVE-2021-41773 .*CVE-2021-42013/);
  const m = find(r, "mixed-content");
  assert.deepEqual(
    [m.rule, m.severity, m.count],
    ["TRUST-01", "medium", 2],
    "the public origin is https, so the local copy's http:// files from other sites are mixed content",
  );
  assert.deepEqual(m.evidence.map(e => [new URL(e.url).pathname, e.detail]).sort(), [
    ["/", "1 resource over http://: stylesheet http://cdn.example/site.css"],
    ["/media/", "1 resource over http://: video http://media.example/clip.mp4"],
  ]);
  assert.ok(details(r, "sec-headers").includes("Permissions-Policy"), details(r, "sec-headers").join(", "));
});

test("crawler: a site with strict, valid security headers and only https:// files gets none of these", async () => {
  const r = await safe();
  for (const c of NEW) assert.ok(!find(r, c), c);
  assert.ok(!details(r, "sec-headers").includes("Permissions-Policy"));
  assert.deepEqual(r.hstsPreload, { ready: true, missing: [] });
});

test("crawler: HSTS without includeSubDomains is flagged, and the preload readiness lists what's missing", async () => {
  const r = await crawl(
    { "/": page("Home") },
    { headers: { "/": { ...SAFE, "Strict-Transport-Security": "max-age=31536000" } } },
  );
  assert.deepEqual([find(r, "hsts-no-subdomains").rule, find(r, "hsts-no-subdomains").severity], ["TRUST-01", "low"]);
  assert.deepEqual(r.hstsPreload, { ready: false, missing: ["includeSubDomains", "preload"] });
});

test("crawler: secret query values in sitemap URLs never reach the findings, the notes or the redirects", async () => {
  const r = await weak(),
    text = JSON.stringify({ findings: r.findings, notes: r.notes, notChecked: r.notChecked, redirects: r.redirects });
  assert.ok(text.includes("token=[hidden]"), "the URL is still reported, with its value hidden");
  assert.ok(!text.includes("s3cr3t-value"), text.match(/.{60}s3cr3t-value.{20}/)?.[0]);
});

// ---------- the report ----------

test("report: the HSTS preload line shows what the list still needs, information only", async () => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  writeFileSync(join(dir, "plain.json"), JSON.stringify(data));
  writeFileSync(
    join(dir, "a.json"),
    JSON.stringify({ ...data, hstsPreload: { ready: false, missing: ["includeSubDomains", "<preload>"] } }),
  );
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "a.html")]);
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "plain.json"), "--out", join(dir, "plain.html")]);
  const html = readFileSync(join(dir, "a.html"), "utf8"),
    md = readFileSync(join(dir, "a.md"), "utf8");
  assert.match(html, /HSTS preload: not ready yet\. The header still needs includeSubDomains and &lt;preload&gt;\./);
  assert.match(md, /HSTS preload: not ready yet\. The header still needs includeSubDomains and \\<preload\\>\./);
  assert.doesNotMatch(readFileSync(join(dir, "plain.html"), "utf8"), /HSTS preload/);
  const scoreOf = s => s.match(/<p class="big[^"]*"><span class="n">(\d+)/)[1];
  assert.equal(scoreOf(html), scoreOf(readFileSync(join(dir, "plain.html"), "utf8")), "the score doesn't move");
});

// ---------- the browser guard ----------

const listen = (server, host = "127.0.0.1") =>
  new Promise((ok, fail) => server.once("error", fail).listen(0, host, () => ok(server.address().port)));
// dns.lookup with { all: true }, from a table: no outside DNS in the tests.
const fakeDns = table => (name, opts, cb) =>
  table[name]
    ? cb(
        null,
        [].concat(table[name]).map(address => ({ address, family: address.includes(":") ? 6 : 4 })),
      )
    : cb(Object.assign(new Error(`getaddrinfo ENOTFOUND ${name}`), { code: "ENOTFOUND" }));
const viaProxy = (port, url) =>
  new Promise((ok, fail) =>
    request({ host: "127.0.0.1", port, path: url, headers: { host: new URL(url).host } }, r => {
      let b = "";
      r.on("data", d => (b += d)).on("end", () => ok([r.statusCode, b]));
    })
      .on("error", fail)
      .end(),
  );
const tunnel = (port, target) =>
  new Promise((ok, fail) => {
    const s = connect(port, "127.0.0.1", () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    s.once("data", d => {
      ok(String(d).split("\r\n")[0]);
      s.destroy();
    }).on("error", fail);
  });

test("the guard proxy lets the site's own addresses through and refuses private and cloud-metadata ones, by the address each name resolves to", async () => {
  const api = createServer((q, s) => s.end("api " + q.url)),
    apiPort = await listen(api);
  const g = await startGuard("http://127.0.0.1:5000/", {
    dns: fakeDns({
      "api.test": "127.0.0.1",
      "evil.test": "10.0.0.5",
      "meta.test": ["93.184.216.34", "169.254.169.254"],
    }),
    env: {},
  });
  try {
    assert.deepEqual(g.args, [
      `--proxy-server=http://127.0.0.1:${g.port}`,
      "--proxy-bypass-list=<-loopback>;127.0.0.1:5000",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    ]);
    assert.deepEqual(
      await viaProxy(g.port, `http://127.0.0.1:${apiPort}/a?b=1`),
      [200, "api /a?b=1"],
      "another port on the site's own address (a local API)",
    );
    assert.deepEqual(
      await viaProxy(g.port, `http://api.test:${apiPort}/`),
      [200, "api /"],
      "a name that resolves to the site's own address",
    );
    for (const u of [
      "http://169.254.169.254/latest/meta-data/",
      "http://evil.test/",
      "http://meta.test/",
      "http://10.1.2.3:8080/",
      "http://[fd00::1]/",
      "http://nowhere.test/",
    ])
      assert.equal((await viaProxy(g.port, u))[0], 403, u);
    assert.match(await tunnel(g.port, "evil.test:443"), / 403 /, "https and wss go through CONNECT");
    assert.match(await tunnel(g.port, "169.254.169.254:443"), / 403 /);
    assert.match(await tunnel(g.port, `127.0.0.1:${apiPort}`), / 200 /);
    assert.deepEqual(g.blocked.slice(0, 3), [
      "http://169.254.169.254/latest/meta-data/",
      "http://evil.test/",
      "http://meta.test/",
    ]);
  } finally {
    await g.close();
    api.close();
  }
  await assert.rejects(viaProxy(g.port, `http://127.0.0.1:${apiPort}/`), "closed with the render");
  assert.equal(
    await startGuard("http://127.0.0.1:5000/", { env: { HTTPS_PROXY: "http://proxy.corp:8080" } }),
    null,
    "the owner's own proxy stays in charge",
  );
});

test("the render and Lighthouse get the guard's flags in place of a proxy, and the guard closes after the run", async () => {
  const args = renderArgs(
    "/tmp/p",
    "https://example.com/",
    { platform: "darwin", env: { HTTPS_PROXY: "http://proxy.corp:8080" } },
    ["--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=<-loopback>;example.com"],
  );
  assert.ok(
    args.includes("--proxy-server=http://127.0.0.1:9") && !args.includes("--proxy-server=http://proxy.corp:8080"),
  );
  assert.equal(args.at(-1), "https://example.com/");
  const dir = tmp(),
    bin = join(dir, "fake-lighthouse.mjs"),
    log = join(dir, "calls.json");
  writeFileSync(
    bin,
    `import { writeFileSync } from "node:fs";
const args = process.argv.slice(2), port = args.find(a => a.startsWith("--chrome-flags=")).match(/--proxy-server=http:\\/\\/127\\.0\\.0\\.1:(\\d+)/)?.[1];
const open = port ? await fetch("http://127.0.0.1:" + port + "/", { signal: AbortSignal.timeout(5000) }).then(() => true, () => false) : null;
writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args, open }));
writeFileSync(args.find(a => a.startsWith("--output-path=")).slice(14), JSON.stringify({ categories: {}, audits: {} }));`,
  );
  await runLighthouse(bin, "http://127.0.0.1:1/", { host: { platform: "darwin", env: {} } });
  const call = JSON.parse(readFileSync(log, "utf8")),
    flags = call.args.find(a => a.startsWith("--chrome-flags="));
  assert.match(
    flags,
    /^--chrome-flags=--headless=new --proxy-server=http:\/\/127\.0\.0\.1:(\d+) --proxy-bypass-list=<-loopback>;127\.0\.0\.1:1 --force-webrtc-ip-handling-policy=disable_non_proxied_udp --user-data-dir="[^"]+"$/,
  );
  assert.equal(call.open, true, "the guard answers while Lighthouse runs");
  const port = flags.match(/127\.0\.0\.1:(\d+) /)[1];
  await assert.rejects(viaProxy(+port, "http://127.0.0.1:1/"), "and is gone afterwards");
});

// A page on the site that reaches for another loopback address (a stand-in for a private or metadata address: both are
// outside the site's own) and for the site's own address on another port, and registers a service worker.
const browser = findBrowser();
test(
  "headless Chrome renders and phone loads can't reach addresses outside the site, and service workers are off in the loads",
  { skip: !browser && "Chrome not installed", timeout: 600000 },
  async t => {
    const hits = { other: 0, own: 0, sw: 0 };
    const other = createServer((q, s) => {
      hits.other++;
      s.end();
    });
    try {
      await listen(other, "127.0.0.2");
    } catch {
      return t.skip("no second loopback address here (macOS)");
    }
    const own = createServer((q, s) => {
        hits.own++;
        s.writeHead(200, { "content-type": "image/gif" }).end();
      }),
      ownPort = await listen(own);
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Guarded</title></head><body><main><h1>Guarded</h1><p>${"Boiler repairs across Leeds. ".repeat(20)}</p>
<img src="http://127.0.0.2:${other.address().port}/pixel.gif" alt=""><img src="http://localhost:${ownPort}/own.gif" alt="">
<script>fetch("http://127.0.0.2:${other.address().port}/fetch", { mode: "no-cors" }).catch(() => {}); if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");</script></main></body></html>`;
    const site = createServer((q, s) => {
      if (q.url === "/sw.js") {
        hits.sw++;
        s.writeHead(200, { "content-type": "text/javascript" }).end("");
      } else s.writeHead(200, { "content-type": "text/html" }).end(html);
    });
    const sitePort = await listen(site),
      url = `http://127.0.0.1:${sitePort}/`;
    try {
      const dom = await renderPage(browser, url, { timeoutMs: 180000 }); // a busy machine starts Chrome slowly
      assert.match(dom, /<h1>Guarded<\/h1>/);
      assert.equal(hits.other, 0, "the render reached another address");
      assert.ok(hits.own >= 1, "the site's own address on another port still loads");
      hits.own = 0;
      hits.sw = 0;
      const v = await checkVisual(browser, [url], { add: () => {}, pageBudgetMs: 240000 });
      assert.equal(v.checked, 1, v.notes.join(" "));
      assert.equal(hits.other, 0, "a phone or desktop load reached another address");
      assert.ok(hits.own >= 1);
      assert.equal(hits.sw, 0, "no service worker was registered");
    } finally {
      site.close();
      own.close();
      other.close();
    }
  },
);
