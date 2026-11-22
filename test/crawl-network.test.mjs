// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { Readable, pipeline } from "node:stream";
import { createGzip } from "node:zlib";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { createFetcher, isLocal, isPublic as fetchIsPublic } from "../skills/seo-supervisor/scripts/crawl/fetch.mjs";
import { isPublic as netIsPublic } from "../skills/seo-supervisor/scripts/lib/net.mjs";
import { probeSite } from "../skills/seo-supervisor/scripts/checks/probes.mjs";

const ORIGIN = "https://site.example";
// Over 50 distinct main words, so the Markdown comparison takes the page.
const COPY =
  "Our engineers repair boilers, radiators, pumps and leaking pipes across Leeds, Bradford, Harrogate and York. Every visit starts with a written estimate, careful diagnosis and honest advice about replacement versus repair. We carry common spare parts, protect floors with dust sheets, test pressure afterwards and leave paperwork explaining warranties, servicing intervals, safety checks and future maintenance costs clearly. Landlords, homeowners and small businesses trust our registered team for emergency callouts, annual inspections, thermostat upgrades, underfloor heating installs and power flushing.";
const page = (title, body = "", head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${head}</head><body><main><h1>${title}</h1><p>${COPY}</p>${body}</main></body></html>`;
const links = (...hrefs) => hrefs.map(h => `<a href="${h}">Read more</a>`).join(" ");
const pathOf = u => new URL(u, "http://x").pathname;
const MEMORY =
  "data:text/javascript," +
  encodeURIComponent(`import { writeFileSync } from "node:fs";
process.on("exit", () => { if (process.env.NET_RSS_FILE) writeFileSync(process.env.NET_RSS_FILE, String(process.resourceUsage().maxRSS)); });`);

// The site's pages (path -> HTML) on the test server, robots.txt, and before(req, res) for anything else.
async function crawlSite(
  pages,
  { robots = "User-agent: *\nAllow: /\n", args = [], env = {}, before, markdown, origin = true, files } = {},
) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(join(dir, "robots.txt"), robots);
  const site = await serve(dir, { before, markdown, files });
  try {
    await node(
      [
        join(SCRIPTS, "seo-crawl.mjs"),
        "--url",
        site.url,
        ...(origin ? ["--site-origin", ORIGIN] : []),
        "--out",
        out,
        ...args,
      ],
      { env: { ...process.env, ...env } },
    );
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}
// A run that's expected to stop: its exit code and output, and how many requests the site got.
async function crawlFails(args, env = {}) {
  let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    res.writeHead(200, { "Content-Type": "text/html" }).end(page("Home"));
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", () => ok(null)));
  const url = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
  try {
    const e = await node(
      [join(SCRIPTS, "seo-crawl.mjs"), ...args.map(a => a.replace("<url>", url)), "--out", join(tmp(), "crawl.json")],
      { env: { ...process.env, ...env } },
    ).then(
      () => null,
      x => x,
    );
    return { code: e ? e.code : 0, stderr: e ? String(e.stderr) : "", hits };
  } finally {
    server.close();
  }
}

test("a page 7 redirects away is crawled (Google's crawlers follow up to 10 hops); 11 is too many; robots.txt still stops after 5", async () => {
  const before = (req, res) => {
    const p = pathOf(req.url),
      m = /^\/(r|s|robots-)(\d+)$/.exec(p);
    if (p === "/robots.txt") return !!res.writeHead(301, { Location: "/robots-1" }).end();
    if (!m) return false;
    const n = +m[2],
      last = { r: 7, s: 11, "robots-": 6 }[m[1]];
    res
      .writeHead(301, { Location: n < last ? `/${m[1]}${n + 1}` : m[1] === "robots-" ? "/real-robots.txt" : "/final/" })
      .end();
    return true;
  };
  const r = await crawlSite(
    { "/": page("Boiler repairs in Leeds", links("/r1", "/s1")), "/final/": page("Boiler servicing") },
    { before },
  );
  const to = from => r.redirects.find(x => pathOf(x.from) === from)?.to;
  assert.equal(to("/r1") && pathOf(to("/r1")), "/final/", JSON.stringify(r.redirects));
  assert.ok(!r.errors.some(e => pathOf(e.url) === "/r1"), JSON.stringify(r.errors));
  assert.equal(to("/s1"), null, "11 redirects are too many");
  assert.ok(
    r.errors.some(e => pathOf(e.url) === "/s1" && e.status === 0),
    JSON.stringify(r.errors),
  );
  const robots = r.findings.find(f => f.check === "robots-missing");
  assert.match(robots?.evidence[0].detail ?? "", /more than 5 redirects/, JSON.stringify(robots));
  // On this machine, 8 requests at once unless --concurrency says otherwise.
  assert.equal(r.options.concurrency, 8);
});

for (const [form, header] of [
  ["an IMF-fixdate", t => new Date(t).toUTCString()],
  [
    "an asctime date (read as UTC, here in UTC+5)",
    t => {
      const d = new Date(t),
        two = n => String(n).padStart(2, "0");
      return `${d.toUTCString().slice(0, 3)} ${d.toUTCString().slice(8, 11)} ${String(d.getUTCDate()).padStart(2, " ")} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} ${d.getUTCFullYear()}`;
    },
  ],
]) {
  test(`a 429 whose Retry-After is ${form} pauses the crawl until that time, and the crawl finishes`, async () => {
    let refused = false;
    const before = (req, res) => {
      if (pathOf(req.url) !== "/a/" || refused) return false;
      refused = true;
      res.writeHead(429, { "Retry-After": header(Date.now() + 20000), "Content-Type": "text/plain" }).end("slow down");
      return true;
    };
    const r = await crawlSite(
      { "/": page("Boiler repairs in Leeds", links("/a/")), "/a/": page("Boiler servicing") },
      { before, env: { TZ: "Asia/Karachi" } },
    );
    assert.ok(refused);
    assert.ok(
      r.pages.some(p => pathOf(p.url) === "/a/" && p.status === 200),
      "asked again after the pause",
    );
    const note = r.notes.find(n => /slowed down/.test(n)) ?? "";
    assert.match(note, /1 answer of 429/, note);
    assert.match(note, /for (19|20) s in all/, note);
  });
}

test("a page that never ends and a gzip bomb (1 GB of spaces) are read up to 10 MB: the crawl finishes and stays small", async t => {
  const before = (req, res) => {
    const p = pathOf(req.url);
    if (p === "/endless/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      pipeline(
        Readable.from(
          (function* () {
            yield "<!doctype html><html><body><p>";
            for (;;) yield "endless ".repeat(8192);
          })(),
        ),
        res,
        () => {},
      );
      return true;
    }
    if (p === "/bomb/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Encoding": "gzip" });
      const spaces = Buffer.alloc(1 << 16, 32);
      pipeline(
        Readable.from(
          (function* () {
            for (let i = 0; i < (1 << 30) / spaces.length; i++) yield spaces;
          })(),
        ),
        createGzip({ level: 1 }),
        res,
        () => {},
      );
      return true;
    }
    return false;
  };
  const rss = join(tmp(), "rss.txt");
  const r = await crawlSite(
    { "/": page("Boiler repairs in Leeds", links("/endless/", "/bomb/", "/a/")), "/a/": page("Boiler servicing") },
    {
      before,
      args: ["--concurrency", "1"],
      env: { NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import=${MEMORY}`.trim(), NET_RSS_FILE: rss },
    },
  );
  assert.ok(
    r.pages.some(p => pathOf(p.url) === "/a/"),
    "the rest of the site is crawled",
  );
  for (const p of ["/endless/", "/bomb/"])
    assert.ok(
      r.notes.some(n => n.includes(p) && /over 10 MB/.test(n)),
      `${p}: ${r.notes.join("\n")}`,
    );
  // Unread, but surely past Googlebot's 2 MB (REND-08).
  assert.deepEqual(
    r.findings
      .find(f => f.check === "html-over-2mb")
      ?.evidence.map(e => pathOf(e.url))
      .sort(),
    ["/bomb/", "/endless/"],
  );
  const mb = Number(readFileSync(rss, "utf8")) / 1024;
  t.diagnostic(`peak memory ${Math.round(mb)} MB`);
  assert.ok(mb < 400, `peak memory ${Math.round(mb)} MB`);
});

test("a redirect to another host connects to the address the guard checked, so a name that answers again with a private address (DNS rebinding) isn't visited", async () => {
  let hits = 0;
  const other = createServer((req, res) => {
    hits++;
    res.end("private");
  });
  await new Promise(ok => other.listen(0, "127.0.0.1", () => ok(null)));
  const port = /** @type {import("node:net").AddressInfo} */ (other.address()).port,
    target = `http://rebind.example:${port}/x`;
  const site = createServer((req, res) => res.writeHead(302, { Location: target }).end());
  await new Promise(ok => site.listen(0, "127.0.0.1", () => ok(null)));
  const start = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (site.address()).port}`;
  const asked = [];
  // The guard's check gets a public address; any later lookup gets this machine.
  const dns = (name, opts, cb) => {
    asked.push(name);
    const address = asked.length === 1 ? "93.184.216.34" : "127.0.0.1";
    opts?.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4);
  };
  try {
    const { follow, blocked } = createFetcher({ startOrigin: start, ua: "test", toCrawl: u => u, dns });
    const r = await follow(start + "/go");
    assert.equal(hits, 0, "the private address was never contacted");
    assert.deepEqual(
      r.chain.map(c => c.status),
      [302],
      "the chain ends at the redirect, as the guard's other refusals do",
    );
    assert.match(blocked.get(target) ?? "", /private or local address \(127\.0\.0\.1\)/, JSON.stringify([...blocked]));
    assert.deepEqual(
      asked,
      ["rebind.example", "rebind.example"],
      "checked once, then the connection's own lookup through the guard",
    );
  } finally {
    other.close();
    site.close();
  }
});

test("the crawler's private-address test is lib/net.mjs's", () => {
  assert.equal(fetchIsPublic, netIsPublic);
  assert.equal(fetchIsPublic("http://100.64.0.1/"), false, "a private range the old copy missed");
  assert.equal(isLocal("http://localhost:3000"), true);
  assert.equal(isLocal("https://www.example.com"), false);
});

test("an image used as the page's image, share image and Product image is asked for once", async () => {
  const png = Buffer.concat([
    Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
    Buffer.from([0, 0, 4, 176, 0, 0, 2, 120, 8, 2, 0, 0, 0]),
    Buffer.alloc(64),
  ]);
  let asked = 0;
  const before = (req, res) => {
    if (pathOf(req.url) !== "/img/a.png") return false;
    asked++;
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length }).end(png);
    return true;
  };
  const schema = `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: "Boiler", image: "/img/a.png", offers: { "@type": "Offer", price: "10", priceCurrency: "GBP" } })}</script>`;
  const r = await crawlSite(
    {
      "/": page(
        "Boiler repairs in Leeds",
        `<img src="/img/a.png" alt="A boiler" width="1200" height="632">`,
        `<meta property="og:image" content="${ORIGIN}/img/a.png">${schema}`,
      ),
    },
    { before },
  );
  assert.ok(
    r.images?.some(i => pathOf(i.url) === "/img/a.png"),
    "it was weighed",
  );
  assert.equal(asked, 1);
});

test("old URLs, sitemap files, script files, Markdown samples and the probes are asked for in a pool, at most --concurrency at once", async () => {
  const live = {},
    most = {};
  const kindOf = req => {
    const p = pathOf(req.url),
      md = /text\/markdown/.test(req.headers.accept || "");
    if (/^\/old-/.test(p)) return "old";
    if (/^\/sm-\d\.xml$/.test(p)) return "sitemap";
    if (/^\/js\//.test(p)) return "script";
    if (md && p !== "/") return "markdown";
    if ((md && p === "/") || /^\/(seo-supervisor-404-probe|llms\.txt|\.well-known\/security\.txt)/.test(p))
      return "probe";
    return null;
  };
  const before = (req, res) => {
    const kind = kindOf(req),
      p = pathOf(req.url);
    if (!kind) return false;
    live[kind] = (live[kind] || 0) + 1;
    most[kind] = Math.max(most[kind] || 0, live[kind]);
    setTimeout(() => {
      live[kind]--;
      if (kind === "sitemap")
        res
          .writeHead(200, { "Content-Type": "application/xml" })
          .end(
            `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${ORIGIN}/a/</loc></url></urlset>`,
          );
      else if (kind === "script") res.writeHead(200, { "Content-Type": "text/javascript" }).end("console.log(1)");
      else if (kind === "markdown" || (kind === "probe" && p === "/"))
        res.writeHead(200, { "Content-Type": "text/markdown", Vary: "Accept" }).end(`# Page\n\n${COPY}`);
      else res.writeHead(404, { "Content-Type": "text/html" }).end("<!doctype html><title>Not found</title>");
    }, 200);
    return true;
  };
  const scripts = Array.from({ length: 6 }, (_, i) => `<script src="/js/s${i}.js"></script>`).join("");
  const index = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from({ length: 6 }, (_, i) => `<sitemap><loc>${ORIGIN}/sm-${i}.xml</loc></sitemap>`).join("")}</sitemapindex>`;
  const urls = join(tmp(), "old.txt");
  writeFileSync(urls, Array.from({ length: 6 }, (_, i) => `/old-${i}`).join("\n"));
  const r = await crawlSite(
    {
      "/": page("Boiler repairs in Leeds", links("/a/", "/b/", "/c/") + scripts),
      "/a/": page("Boiler servicing", scripts),
      "/b/": page("Radiator repairs"),
      "/c/": page("Leak detection"),
    },
    {
      before,
      robots: `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap_index.xml\n`,
      files: { "/sitemap_index.xml": { type: "application/xml", body: index } },
      args: ["--concurrency", "3", "--urls", urls],
    },
  );
  for (const kind of ["old", "sitemap", "script", "markdown", "probe"])
    assert.ok(most[kind] >= 2 && most[kind] <= 3, `${kind}: ${most[kind]} at once (${JSON.stringify(most)})`);
  assert.equal(r.options.concurrency, 3, "an explicit --concurrency wins on this machine too");
  assert.match(r.notes.join("\n"), /Tested 12 old\/redirect URLs/);
});

test("every late request to the site comes before the Googlebot and AI-crawler probes, and the slow-down note counts the probes' pauses", async () => {
  const order = [];
  let aiRefused = false;
  const before = (req, res) => {
    const ua = String(req.headers["user-agent"] || ""),
      md = /text\/markdown/.test(req.headers.accept || "");
    order.push(
      `${/Googlebot/.test(ua) ? "googlebot" : /SearchBot|PerplexityBot/.test(ua) ? "ai" : "crawler"} ${md ? "md " : ""}${pathOf(req.url)}`,
    );
    if (/OAI-SearchBot/.test(ua) && !aiRefused) {
      aiRefused = true;
      res.writeHead(429, { "Retry-After": "1" }).end();
      return true;
    }
    return false;
  };
  const markdown = Object.fromEntries(["/", "/a/", "/b/"].map(p => [p, `# Page\n\n${COPY}`]));
  // --outside for the AI-crawler probe; node stands in for Chrome, which then doesn't start (no Chrome in this suite).
  const r = await crawlSite(
    {
      "/": page("Boiler repairs in Leeds", links("/a/", "/b/") + `<script src="/js/app.js"></script>`),
      "/a/": page("Boiler servicing"),
      "/b/": page("Radiator repairs"),
    },
    {
      before,
      markdown,
      origin: false,
      files: { "/js/app.js": { type: "text/javascript", body: "console.log(1)" } },
      args: ["--outside", "--ai-bot-probe"],
      env: { CHROME_PATH: process.execPath },
    },
  );
  const firstBot = order.findIndex(x => /^(googlebot|ai) /.test(x));
  const late = ["crawler /js/app.js", "crawler md /a/", "crawler md /b/"].map(x => order.indexOf(x));
  assert.ok(
    firstBot > 0 && late.every(i => i >= 0 && i < firstBot),
    `${late} before ${firstBot}:\n${order.join("\n")}`,
  );
  assert.ok(aiRefused);
  assert.match(r.notes.find(n => /slowed down/.test(n)) ?? "", /1 answer of 429/, r.notes.join("\n"));
});

test("with --outside, a CHROME_PATH that points at nothing stops the crawl before it starts, with a plain message", async () => {
  const r = await crawlFails(["--url", "<url>", "--outside"], { CHROME_PATH: join(tmp(), "no-chrome.exe") });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^seo-crawl: CHROME_PATH is set to/m);
  assert.doesNotMatch(r.stderr, /\n\s+at /, "no stack trace");
  assert.equal(r.hits, 0, "nothing was crawled");
});

test("the crawler reads its options with the shared parser: =values work, a stray word or a misspelt option stops it", async () => {
  const r = await crawlSite(
    { "/": page("Boiler repairs in Leeds") },
    { args: ["--render=all", "--lighthouse=all", "--trailing-slash=always"] },
  );
  assert.ok(
    r.notes.some(n => /^--render all runs only with outside checks on/.test(n)),
    r.notes.join("\n"),
  );
  assert.ok(
    r.notes.some(n => /^--lighthouse runs only with outside checks on/.test(n)),
    r.notes.join("\n"),
  );
  assert.equal(r.options.trailingSlash, "always");
  for (const [args, why] of [
    [["--url", "<url>", "yes"], /unexpected "yes"/],
    [["--url", "<url>", "--max-page", "3"], /unknown option --max-page/],
    [["--url", "<url>", "--ignore-noindex=yes"], /--ignore-noindex takes no value/],
    [["--url", "<url>", "--concurrency", "abc"], /^seo-crawl: --concurrency needs a whole number/m],
    [["--url", "<url>", "--max", "0"], /^seo-crawl: --max needs a whole number/m],
    [["--url", "not a url"], /^seo-crawl: --url needs a full web address/m],
    [["--url", "<url>", "--banned", "("], /^seo-crawl: --banned isn't a valid pattern/m],
    [["--outside"], /^Usage: node seo-crawl\.mjs --url/m],
  ]) {
    const x = await crawlFails(/** @type {string[]} */ (args));
    assert.equal(x.code, 2, `${args.join(" ")}: ${x.stderr}`);
    assert.match(x.stderr, why);
    assert.doesNotMatch(x.stderr, /\n\s+at /, "no stack trace");
    assert.equal(x.hits, 0);
  }
});

test("pages that answer with a bot challenge (Cloudflare, AWS WAF) aren't read as pages, nor reported as broken: a note says they weren't checked", async () => {
  const challenge =
    "<!doctype html><html><head><title>Just a moment...</title></head><body><p>Checking your browser</p></body></html>";
  const before = (req, res) => {
    const p = pathOf(req.url);
    if (p === "/a/")
      return !!res.writeHead(403, { "Content-Type": "text/html", "cf-mitigated": "challenge" }).end(challenge);
    if (p === "/b/")
      return !!res.writeHead(202, { "Content-Type": "text/html", "x-amzn-waf-action": "challenge" }).end(challenge);
    if (p === "/c/")
      return !!res.writeHead(405, { "Content-Type": "text/html", "x-amzn-waf-action": "captcha" }).end(challenge);
    return false;
  };
  const r = await crawlSite(
    { "/": page("Boiler repairs in Leeds", links("/a/", "/b/", "/c/", "/d/")), "/d/": page("Leak detection") },
    { before },
  );
  assert.deepEqual(r.pages.map(p => pathOf(p.url)).sort(), ["/", "/d/"], "a challenge isn't a page");
  assert.deepEqual(r.errors, [], "nor a broken page");
  assert.ok(
    !r.findings.some(f => f.evidence.some(e => /\/(a|b|c)\/$/.test(e.url) || /\/(a|b|c)\//.test(e.detail || ""))),
    JSON.stringify(r.findings.map(f => [f.check, f.evidence])),
  );
  const note = r.notes.find(n => /bot challenge/.test(n)) ?? "";
  assert.match(note, /^3 page\(s\) answered with a bot challenge/, r.notes.join("\n"));
});

test("the site's own images, scripts and stylesheets that answer 4xx or 5xx are reported once each, on the page that uses them", async () => {
  const before = (req, res) =>
    pathOf(req.url) === "/img/err.png" && !!res.writeHead(500, { "Content-Type": "text/plain" }).end("boom");
  const head = `<link rel="stylesheet" href="/css/missing.css"><link rel="stylesheet" href="/css/ok.css"><!-- <link rel="stylesheet" href="/css/old.css"> --><link rel="alternate stylesheet" href="/css/alt.css">`;
  const body = `<img src="/img/missing.png" alt="Boiler" width="10" height="10"><img src="/img/err.png" alt="Pipes" width="10" height="10"><script src="/js/missing.js"></script><script src="https://cdn.example/x.js"></script>`;
  const r = await crawlSite(
    {
      "/": page("Boiler repairs in Leeds", body + links("/d/"), head),
      "/d/": page("Leak detection", `<img src="/img/missing.png" alt="Boiler" width="10" height="10">`),
    },
    { before, files: { "/css/ok.css": { type: "text/css", body: "body{color:#111}" } } },
  );
  const f = r.findings.find(x => x.check === "own-file-broken");
  assert.deepEqual([f?.rule, f?.severity], ["CRAWL-07", "medium"]);
  assert.deepEqual(f.evidence.map(e => [pathOf(e.url), e.detail.replace(/http:\/\/127\.0\.0\.1:\d+/, "")]).sort(), [
    ["/", "image /img/err.png → 500"],
    ["/", "image /img/missing.png → 404"],
    ["/", "script /js/missing.js → 404"],
    ["/", "stylesheet /css/missing.css → 404"],
  ]);
});

test("on an https crawl without --check-live, a home page with no HSTS header is no-hsts, the id --check-live uses", async () => {
  const added = [],
    none = {
      status: 404,
      headers: new Headers(),
      ct: "text/html",
      body: "",
      chain: [{ url: "x", status: 404 }],
      finalUrl: "x",
    };
  const home = { finalUrl: "https://site.example/", headers: new Headers({ "x-content-type-options": "nosniff" }) };
  await probeSite({
    start: new URL(home.finalUrl),
    startOrigin: "https://site.example",
    expectOrigin: "https://site.example",
    checkLive: false,
    home,
    add: (id, url, detail) => added.push([id, url, detail]),
    evalRules: () => {},
    notes: [],
    follow: async () => none,
    get: async () => none,
  });
  assert.deepEqual(
    added.filter(([id]) => id === "no-hsts"),
    [["no-hsts", home.finalUrl, undefined]],
  );
  assert.ok(
    !added.some(([id, , d]) => id === "sec-headers" && /Strict-Transport-Security/.test(d)),
    JSON.stringify(added),
  );
});

test("Cloudflare's own /cdn-cgi/ addresses aren't crawled as pages", async () => {
  const asked = [];
  const before = req => {
    asked.push(pathOf(req.url));
    return false;
  };
  const r = await crawlSite(
    {
      "/": page("Boiler repairs in Leeds", links("/cdn-cgi/l/email-protection#a1b2c3", "/d/")),
      "/d/": page("Leak detection"),
    },
    { before },
  );
  assert.ok(!asked.some(p => p.startsWith("/cdn-cgi/")), asked.join(" "));
  assert.ok(
    !r.findings.some(f => f.evidence.some(e => /cdn-cgi/.test(e.url + (e.detail || "")))),
    JSON.stringify(r.findings.map(f => [f.check, f.evidence])),
  );
});
