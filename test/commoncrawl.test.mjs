// Common Crawl's domain rank: streamed from the web graph's ranks file, stopping at the domain or a size cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { domainRank, rankDomain } from "../skills/seo-supervisor/scripts/commoncrawl.mjs";

const ID = "cc-main-2026-aug-sep-oct";
const HEAD = "#harmonicc_pos\t#harmonicc_val\t#pr_pos\t#pr_val\t#host_rev\t#n_hosts";
const rows = n =>
  Array.from(
    { length: n },
    (_, i) =>
      `${i + 1}\t${(3e7 - i).toExponential(6)}\t${i + 2}\t0.001\t${i === 4999 ? "com.acme" : `com.site${i}`}\t${(i % 9) + 1}`,
  );
const RANKS = gzipSync([HEAD, ...rows(20000)].join("\n") + "\n");

async function graphServer() {
  const hits = [];
  const srv = createServer((req, res) => {
    hits.push(req.url);
    if (req.url === "/graphinfo.json")
      return res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify([{ id: ID, stats: { domain: { nodes: 20000 } } }]));
    if (req.url === `/hyperlinkgraph/${ID}/domain/${ID}-domain-ranks.txt.gz`)
      return res.writeHead(200, { "content-length": RANKS.length }).end(RANKS);
    res.writeHead(404).end();
  });
  await new Promise(ok => srv.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${srv.address().port}`;
  return {
    hits,
    opts: { graphinfo: url + "/graphinfo.json", graph: url + "/hyperlinkgraph/" },
    close: () => new Promise(ok => srv.close(ok)),
  };
}

test("the rank's domain is the registered domain, reversed as the graph writes it", () => {
  assert.equal(rankDomain("www.acme.com"), "com.acme");
  assert.equal(rankDomain("shop.acme.co.uk"), "uk.co.acme");
  assert.equal(rankDomain("blog.acme.com"), "com.acme");
});

test("domainRank streams the ranks file and stops at the domain", async () => {
  const s = await graphServer();
  try {
    const r = await domainRank("https://www.acme.com", s.opts);
    assert.deepEqual(
      [r.release, r.domain, r.found, r.harmonicPos, r.pageRankPos, r.hosts, r.domains],
      [ID, "acme.com", true, 5000, 5001, 5, 20000],
    );
  } finally {
    await s.close();
  }
});

test("past the size cap it says how far it read: not in the top N domains", async () => {
  const s = await graphServer();
  try {
    const r = await domainRank("https://www.nowhere-small.com", { ...s.opts, capBytes: 20000 });
    assert.equal(r.found, false);
    assert.ok(r.scanned > 0 && r.scanned < 20000, String(r.scanned));
    assert.equal(r.capped, true);
    const all = await domainRank("https://www.nowhere-small.com", s.opts);
    assert.deepEqual(
      [all.found, all.capped, all.scanned],
      [false, false, 20000],
      "the whole file read: not in the graph at all",
    );
  } finally {
    await s.close();
  }
});

test("the CLI: --rank is a dry run that names the download until --yes, and a fresh result is reused for 90 days", async () => {
  const s = await graphServer(),
    dir = tmp(),
    out = join(dir, "commoncrawl.json");
  const env = {
    ...process.env,
    SEO_CC_GRAPHINFO: s.opts.graphinfo,
    SEO_CC_GRAPH: s.opts.graph,
    SEO_CC_COLLINFO: s.opts.graphinfo.replace("graphinfo", "collinfo"),
  };
  try {
    const dry = await node(
      [join(SCRIPTS, "commoncrawl.mjs"), "--site", "https://www.acme.com", "--rank", "--out", out],
      { env },
    );
    assert.match(dry.stdout, /dry run/);
    assert.match(dry.stdout, /rank/i);
    assert.match(dry.stdout, /500 MB/);
    assert.deepEqual(s.hits, [], "nothing asked in a dry run");
    await node([join(SCRIPTS, "commoncrawl.mjs"), "--site", "https://www.acme.com", "--rank", "--out", out, "--yes"], {
      env,
    });
    assert.equal(JSON.parse(readFileSync(out, "utf8")).commonCrawl.rank.harmonicPos, 5000);
    const before = s.hits.length;
    await node([join(SCRIPTS, "commoncrawl.mjs"), "--site", "https://www.acme.com", "--rank", "--out", out, "--yes"], {
      env,
    });
    assert.equal(s.hits.filter(h => h.includes("ranks")).length, 1, "the second run reuses the saved rank");
    assert.ok(s.hits.length >= before);
  } finally {
    await s.close();
  }
});

test("the report shows the rank, or how far down the site isn't, as information only", async () => {
  const { SKILL } = await import("./helpers.mjs");
  const render = async rank => {
    const dir = tmp(),
      data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
    data.commonCrawl = { rank };
    writeFileSync(join(dir, "seo-audit.json"), JSON.stringify(data));
    await node([join(SCRIPTS, "render-report.mjs"), join(dir, "seo-audit.json")]);
    return {
      md: readFileSync(join(dir, "seo-audit.md"), "utf8"),
      html: readFileSync(join(dir, "seo-audit.html"), "utf8"),
    };
  };
  const found = await render({
    release: ID,
    domain: "acme.com",
    checked: "2026-11-21",
    found: true,
    harmonicPos: 1234567,
    harmonic: 1e7,
    pageRankPos: 2000000,
    pageRank: 1e-8,
    hosts: 3,
    domains: 134979706,
  });
  assert.match(
    found.md,
    /Common Crawl's web graph \(cc-main-2026-aug-sep-oct\): acme\.com is #1,234,567 of 134,979,706 domains/,
  );
  assert.match(found.md, /not Google's/);
  const missed = await render({
    release: ID,
    domain: "small.com",
    checked: "2026-11-21",
    found: false,
    capped: true,
    scanned: 27000000,
    domains: 134979706,
    readMB: 500,
  });
  assert.match(missed.md, /small\.com isn't in the top 27,000,000 of 134,979,706 domains/);
  const bad = await render({ release: ID, domain: "<b>x</b>.com", found: true, harmonicPos: 5, domains: 9 });
  assert.doesNotMatch(bad.html, /<b>x<\/b>/, "escaped");
});
