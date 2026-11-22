// @ts-check
// Edge cases: capped agent-file reads, a redirecting home page, --help, secrets in crawled URLs, old finding ids.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { Readable, pipeline } from "node:stream";
import { createGzip } from "node:zlib";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { hideSecrets, redact } from "../skills/seo-supervisor/scripts/lib/redact.mjs";
import { findingsOf } from "../skills/seo-supervisor/scripts/lib/score.mjs";

const COPY =
  "Our engineers repair boilers, radiators, pumps and leaking pipes across Leeds, Bradford, Harrogate and York. ".repeat(
    8,
  );
const page = (title, body = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="About ${title} in Leeds"></head><body><main><h1>${title}</h1><p>${COPY}</p>${body}</main></body></html>`;
const pathOf = u => new URL(u, "http://x").pathname;
const MEMORY =
  "data:text/javascript," +
  encodeURIComponent(`import { writeFileSync } from "node:fs";
process.on("exit", () => { if (process.env.TEST_RSS_FILE) writeFileSync(process.env.TEST_RSS_FILE, String(process.resourceUsage().maxRSS)); });`);

// The site's pages (path -> HTML) on the test server, and before(req, res) for anything else; the crawl's JSON.
async function crawlSite(pages, { before, url = "/", args = [], env = {} } = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
  const site = await serve(dir, { before });
  try {
    await node([join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url + url, "--out", out, ...args], {
      env: { ...process.env, ...env },
    });
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}

test("an agent file that's a gzip bomb (1 GB of spaces at /.well-known/agent-card.json) is read up to 1 MB: the crawl stays small", async t => {
  const before = (req, res) => {
    const p = pathOf(req.url);
    if (p === "/.well-known/api-catalog")
      return !!res.writeHead(200, { "Content-Type": "application/linkset+json" }).end('{"linkset":[]}');
    if (p !== "/.well-known/agent-card.json") return false;
    res.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": "gzip" });
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
  };
  const rss = join(tmp(), "rss.txt");
  const r = await crawlSite(
    { "/": page("Boiler repairs in Leeds") },
    {
      before,
      args: ["--concurrency", "1"],
      env: { NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import=${MEMORY}`.trim(), TEST_RSS_FILE: rss },
    },
  );
  assert.deepEqual(
    r.agents.wellKnown,
    ["/.well-known/api-catalog"],
    "a small file is still read; the bomb isn't a file",
  );
  const mb = Number(readFileSync(rss, "utf8")) / 1024;
  t.diagnostic(`peak memory ${Math.round(mb)} MB`);
  assert.ok(mb < 400, `peak memory ${Math.round(mb)} MB`);
});

test("a site whose / redirects to /en/ still gets the home page's checks there (schema and favicon); a deep start still doesn't", async () => {
  const before = (req, res) => pathOf(req.url) === "/" && !!res.writeHead(301, { Location: "/en/" }).end();
  const r = await crawlSite(
    {
      "/en/": page("Boiler repairs", '<a href="/en/about/">About</a>'),
      "/en/about/": page("About us", '<a href="/en/">Home</a>'),
    },
    { before },
  );
  const at = id => r.findings.find(f => f.check === id)?.evidence.map(e => pathOf(e.url));
  for (const id of ["org-missing", "website-missing", "favicon-missing"]) assert.deepEqual(at(id), ["/en/"], id);
  assert.ok(!(r.passed || []).some(p => p.rule === "SCHEMA-02"), "SCHEMA-02 has a finding, so it didn't pass");
  // Started on a deep page, the crawl's first page isn't the home page.
  const deep = await crawlSite(
    { "/": page("Home"), "/guides/deep/": page("A deep guide") },
    { url: "/guides/deep/", args: ["--max", "1"] },
  );
  for (const id of ["org-missing", "website-missing", "favicon-missing"])
    assert.ok(!deep.findings.some(f => f.check === id), id);
});

test("--help and -h print the script's usage and exit 0, before anything runs", async () => {
  const out = join(tmp(), "crawl.json");
  for (const [script, args, usage] of [
    ["seo-crawl.mjs", ["--help", "--out", out], /^Usage: node seo-crawl\.mjs --url/],
    ["google-updates.mjs", ["-h"], /^usage: node google-updates\.mjs/],
    ["connect-keys.mjs", ["--help"], /^usage: node connect-keys\.mjs set/],
    ["connect-keys.mjs", ["set", "-h"], /^usage: node connect-keys\.mjs set/],
  ]) {
    const r = await node([join(SCRIPTS, script), ...args]);
    assert.match(r.stdout, usage, `${script} ${args.join(" ")}`);
    assert.doesNotMatch(r.stdout, /dry run/, "google-updates doesn't run");
  }
  assert.throws(() => readFileSync(out), /ENOENT/, "the crawl didn't run");
  await assert.rejects(
    node([join(SCRIPTS, "google-updates.mjs"), "--hepl"]),
    e => e.code === 2 && /unknown option --hepl/.test(e.stderr),
  );
});

test("the secret hider leaves crawled URLs and plain words alone, and still hides OpenAI and Anthropic style keys", () => {
  for (const s of [
    "https://shop.example/blog/sk-guide-internationalization1",
    "https://shop.example/sk-abcdefghijklmnopqrstuvwxyz01/",
    "sk-internationalization-guide-2026",
  ])
    assert.equal(hideSecrets(s), s);
  for (const [s, want] of [
    ["key sk-proj-abcdefghijklmnopqrstuvwxyz0123 used", "key [hidden] used"],
    ["key sk-abcdefghijklmnopqrstuvwxyz01 used", "key [hidden] used"],
    ["OPENAI_API_KEY=sk-admin-abcdefghijklmnopqrstuv", "OPENAI_API_KEY=[hidden]"],
    ["token: sk-ant-api03-" + "A1b_".repeat(10) + "-xyzAA", "token: [hidden]"],
  ])
    assert.equal(hideSecrets(s), want, s);
  assert.equal(redact("/home/bob says hi", { home: "/nobody" }), "~ says hi");
  assert.equal(
    redact("error: C:\\Users\\Some Body", { home: "/nobody" }),
    "error: ~",
    "a Windows profile folder at the end, space and all",
  );
});

test("a crawl that gets no pages reports the plain sitemap-missing, not the small, well-linked site's", async () => {
  const gone = createServer();
  await new Promise(ok => gone.listen(0, "127.0.0.1", () => ok(null)));
  const port = /** @type {import("node:net").AddressInfo} */ (gone.address()).port;
  await new Promise(ok => gone.close(ok));
  const out = join(tmp(), "crawl.json");
  await node([join(SCRIPTS, "seo-crawl.mjs"), "--url", `http://127.0.0.1:${port}/`, "--out", out]);
  const r = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(r.pages.filter(p => p.status === 200).length, 0);
  assert.ok(
    r.findings.some(f => f.check === "sitemap-missing"),
    r.findings.map(f => f.check).join(", "),
  );
  assert.ok(!r.findings.some(f => f.check === "sitemap-missing-small"));
});
