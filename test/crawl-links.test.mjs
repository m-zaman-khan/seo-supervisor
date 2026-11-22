// Single-link pages, missing #name targets, JavaScript text changes, and backing off on 503s and dropped connections.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import {
  CHECKS as RENDER_CHECKS,
  changesHead,
  changesText,
  compareRendered,
} from "../skills/seo-supervisor/scripts/checks/render.mjs";
import { CHECKS, brake, fragmentLinks, hasName, slowNote } from "../skills/seo-supervisor/scripts/checks/crawl.mjs";

const ORIGIN = "https://site.example";
const COPY =
  "Our engineers fix leaks, radiators and hot water faults across the city every day of the week, with a clear written estimate before any work starts and a tidy finish afterwards. ".repeat(
    2,
  );
const page = (title, body = "", head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${head}</head><body><main><h1>${title}</h1><p>${COPY}</p>${body}</main></body></html>`;
const links = (...hrefs) => hrefs.map(h => `<a href="${h}">Read more</a>`).join(" ");

async function crawlSite(pages, { robots = "User-agent: *\nAllow: /\n", args = [], env, ...serveOpts } = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(join(dir, "robots.txt"), robots);
  const site = await serve(dir, serveOpts);
  const origin = args.includes("--site-origin") ? [] : ["--site-origin", ORIGIN];
  try {
    await node(
      [join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url, ...origin, "--out", out, ...args],
      env ? { env } : {},
    );
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}
const findingOf = (r, check) => r.findings.find(f => f.check === check);
const path = u => {
  const x = new URL(u);
  return x.pathname + x.search + x.hash;
};

test("an ordinary site lists no single-link pages, no missing #names and no slow-down note", async () => {
  const r = await crawlSite({
    "/": page(
      "Boiler repairs in Leeds",
      `<p id="intro">Intro</p> ${links("/a/", "/b/", "/a/#prices", "#intro", "#", "#top")}`,
    ),
    "/a/": page("Boiler servicing", `<h2 id="prices">Prices</h2> ${links("/b/", "/")}`),
    "/b/": page("Radiator repairs", `<h2 id="faq">FAQ</h2> ${links("/a/", "/b/#faq")}`),
  });
  assert.equal(r.linkedOnce, undefined, "/a/ and /b/ each have two linking pages");
  assert.ok(!findingOf(r, "link-fragment-missing"), JSON.stringify(findingOf(r, "link-fragment-missing")?.evidence));
  assert.ok(!r.notes.some(n => /slowed down/.test(n)), r.notes.join("\n"));
});

test("indexable pages exactly one other page links to are listed (distinct pages, self-links and the home page left out), information only", async () => {
  const r = await crawlSite({
    "/": page("Boiler repairs in Leeds", links("/a/", "/b/", "/c/")),
    "/a/": page("Boiler servicing", links("/d/", "/d/", "/a/", "/hidden/")),
    "/b/": page("Radiator repairs", links("/c/")),
    "/c/": page("Hot water faults"),
    "/d/": page("Leak detection", links("/a/", "/")),
    "/hidden/": page("Old offers", "", '<meta name="robots" content="noindex">'),
  });
  assert.equal(r.linkedOnce?.count, 2, JSON.stringify(r.linkedOnce));
  assert.deepEqual(
    r.linkedOnce.pages.map(p => [path(p.url), path(p.from)]).sort(),
    [
      ["/b/", "/"],
      ["/d/", "/a/"],
    ],
    "/d/ is linked twice, but from one page",
  );
  assert.ok(!r.findings.some(f => /once|single/i.test(f.check)), "never a finding");
});

test("a link to page#name where the crawled page has no such id or <a name> is a low CRAWL-07 finding", async () => {
  const r = await crawlSite({
    "/": page(
      "Boiler repairs in Leeds",
      [
        '<p id="here">Here</p>',
        links(
          "/a/#prices",
          "/a/#missing",
          "/a/#old-offer",
          "/a/#caf%C3%A9",
          "/a#prices",
          "/a/#prices:~:text=boiler",
          "#here",
          "#nowhere",
          "#",
          "#top",
          "#TOP",
          "/a/#/route",
          "/a/#!bang",
          "/a/#:~:text=boiler",
          "/gone/#x",
          "/app/#section",
          "https://other.example/#x",
        ),
        '<a href="#panel" role="tab">Tab</a> <a href="#modal" data-bs-toggle="modal">Open</a> <a href="#menu" aria-controls="menu">Menu</a>',
      ].join(" "),
    ),
    "/a/": page(
      "Boiler servicing",
      '<h2 id="prices">Prices</h2> <a name="old-offer"></a> <h2 id="caf&#233;">Café</h2>',
    ),
    "/app/":
      '<!doctype html><html><head><title>App</title><script src="/app.js"></script></head><body><div id="root"></div></body></html>',
  });
  const f = findingOf(r, "link-fragment-missing");
  assert.deepEqual([f?.rule, f?.severity], ["CRAWL-07", "low"]);
  // The page that holds the link, with the target in the detail.
  assert.deepEqual(f.evidence.map(e => [path(e.url), path(e.detail.match(/^links to (\S+),/)[1])]).sort(), [
    ["/", "/#nowhere"],
    ["/", "/a/#missing"],
  ]);
  assert.match(f.why, /JavaScript/, "says ids added by scripts aren't seen");
  assert.ok(findingOf(r, "broken-internal-link"), "/gone/ is the broken-link check's");
});

test("#name helpers: the #names worth checking, and names matched as written or percent-decoded", () => {
  const base = "https://site.example/a/";
  const got = fragmentLinks(
    [
      { href: "#x" },
      { href: "/b/#y" },
      { href: "/b/#y" },
      { href: "#" },
      { href: "#Top" },
      { href: "#/r" },
      { href: "#!r" },
      { href: "#:~:text=a" },
      { href: "#z:~:text=a" },
      { href: "mailto:a@b.c#x" },
      { href: "#t", role: "tab" },
      { href: "#m", "data-toggle": "modal" },
      { href: "/c/" },
      { href: "http://[bad#x" },
    ],
    base,
  );
  assert.deepEqual(got, [
    ["https://site.example/a/", "x"],
    ["https://site.example/b/", "y"],
    ["https://site.example/a/", "z"],
  ]);
  assert.ok(
    hasName(new Set(["café"]), "caf%C3%A9") &&
      hasName(new Set(["a b"]), "a b") &&
      !hasName(new Set(["Prices"]), "prices"),
  );
  assert.ok(!hasName(new Set(["x"]), "%E0%A4%A"), "a broken escape is just a name that isn't there");
  assert.deepEqual(CHECKS["link-fragment-missing"].slice(0, 2), ["CRAWL-07", "low"]);
});

test("JavaScript changing the meta description, the title or an H1 the raw HTML had is a low text change; canonical and robots stay high; an H1 only JavaScript adds stays REND-01", () => {
  const doc = ({ desc, h1 } = {}) =>
    `<!doctype html><html><head><title>T</title>${desc == null ? "" : `<meta name="description" content="${desc}">`}</head><body>${h1 == null ? "" : `<h1>${h1}</h1>`}</body></html>`;
  const raw = doc({ desc: "Boiler repairs in Leeds", h1: "Boiler repairs" });
  assert.deepEqual(compareRendered(raw, raw), []);
  assert.deepEqual(
    compareRendered(doc({ desc: "Caf&eacute; &amp; bar", h1: "A" }), doc({ desc: "Café &amp; bar", h1: "A" })),
    [],
    "entities are decoded on both sides",
  );
  const changed = compareRendered(raw, doc({ desc: "Loading…", h1: "Please wait" }));
  assert.deepEqual(changed, [
    { field: "description", raw: "Boiler repairs in Leeds", rendered: "Loading…" },
    { field: "h1", raw: "Boiler repairs", rendered: "Please wait" },
  ]);
  assert.ok(changed.every(x => changesText(x) && !changesHead(x)));
  assert.deepEqual(
    compareRendered(doc({}), doc({ desc: "Set by script", h1: "Added by script" })).map(x => [x.field, changesText(x)]),
    [
      ["description", true],
      ["h1", false],
    ],
  );
  assert.deepEqual(
    compareRendered(raw, doc({})).map(x => [x.field, changesText(x)]),
    [
      ["description", true],
      ["h1", true],
    ],
    "removed by JavaScript",
  );
  assert.ok(["canonical", "robots"].every(field => changesHead({ field }) && !changesText({ field })));
  assert.ok(changesText({ field: "title" }) && !changesHead({ field: "title" }));
  assert.ok(
    !["jsonld-count", "jsonld-types", "words", "link-count"].some(
      field => changesHead({ field, raw: 1 }) || changesText({ field, raw: 1 }),
    ),
  );
  const [rule, severity, title] = RENDER_CHECKS["render-changes-head"];
  assert.deepEqual([rule, severity], ["REND-06", "high"]);
  assert.match(title(2), /canonical or robots tag on 2 page/);
  // Google allows JavaScript to set or change the meta description, so this one is low.
  // https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
  const [rule2, severity2, title2, why2, fix2] = RENDER_CHECKS["render-changes-text"];
  assert.deepEqual([rule2, severity2], ["REND-06", "low"]);
  assert.match(title2(2), /title, meta description or H1 on 2 page/);
  assert.match(why2, /Google/);
  assert.match(why2, /don't run JavaScript/);
  assert.match(fix2, /server HTML/);
});

test("a 503 makes the crawler wait for Retry-After and ask again, a dropped connection pauses it too, and one note says so", async () => {
  const asked = { "/a/": [], "/b/": [] };
  const r = await crawlSite(
    {
      "/": page("Boiler repairs in Leeds", links("/a/", "/b/")),
      "/a/": page("Boiler servicing", links("/b/")),
      "/b/": page("Radiator repairs", links("/a/")),
    },
    {
      before(req, res) {
        const p = new URL(req.url, "http://x").pathname;
        if (!asked[p] || !/seo-supervisor-crawler/.test(req.headers["user-agent"])) return false;
        asked[p].push(Date.now());
        if (asked[p].length > 1) return false;
        if (p === "/a/") res.writeHead(503, { "Retry-After": "1" }).end("busy");
        else req.socket.destroy();
        return true;
      },
      env: { ...process.env, SEO_SUPERVISOR_NO_PAUSES: "" }, // real pauses; the offline guard turns them off
    },
  );
  for (const p of ["/a/", "/b/"]) assert.equal(r.pages.find(x => new URL(x.url).pathname === p)?.status, 200, p);
  assert.deepEqual(r.errors, []);
  assert.ok(!findingOf(r, "server-error"), JSON.stringify(findingOf(r, "server-error")?.evidence));
  assert.ok(asked["/a/"][1] - asked["/a/"][0] >= 900, `503: asked again after ${asked["/a/"][1] - asked["/a/"][0]} ms`);
  assert.ok(
    asked["/b/"][1] - asked["/b/"][0] >= 1500,
    `no answer: asked again after ${asked["/b/"][1] - asked["/b/"][0]} ms`,
  );
  const notes = r.notes.filter(n => /slowed down/.test(n));
  assert.equal(notes.length, 1, r.notes.join("\n"));
  assert.match(notes[0], /1 answer of 429 \(too many requests\) or 503 \(server busy\)/);
  assert.match(notes[0], /1 request got no answer/);
});

test("the pauses stop at our own 2-minute cap, so a struggling site can't stall the crawl", () => {
  const s = brake();
  s.pause(30000, 0);
  s.pause(2000, 0); // already paused for longer: nothing added
  assert.deepEqual([s.until, s.ms], [30000, 30000]);
  for (const now of [30000, 60000, 90000]) s.pause(30000, now);
  assert.deepEqual([s.until, s.ms, s.full], [120000, 120000, false]);
  s.pause(2000, 120000);
  assert.deepEqual([s.until, s.ms, s.full], [120000, 120000, true]);
  assert.equal(slowNote(brake()), null, "no note when nothing slowed the crawl");
  assert.match(slowNote({ ...s, busy: 3, silent: 0 }), /3 answers of 429 .*2 minutes in all, our own limit/);
  assert.doesNotMatch(slowNote({ busy: 0, silent: 2, ms: 4000, full: false }), /429|our own limit/);
});

// ---------- report ----------
const renderReport = async data => {
  const dir = tmp();
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "a.html")]);
  return { html: readFileSync(join(dir, "a.html"), "utf8"), md: readFileSync(join(dir, "a.md"), "utf8") };
};

test("the report lists pages with one incoming link, escaped, and the score doesn't change", async () => {
  const evil = "<img src=x onerror=alert(1)>";
  const base = {
    site: { name: "Site", url: ORIGIN },
    run: { date: "2026-11-22" },
    findings: [],
    passed: [{ rule: "LINK-02", title: "No orphan pages", category: "Internal linking" }],
  };
  const pages = Array.from({ length: 20 }, (_, i) => ({ url: `${ORIGIN}/p${i}/`, from: i ? `${ORIGIN}/hub/` : evil }));
  const on = await renderReport({ ...base, linkedOnce: { count: 25, pages } }),
    off = await renderReport(base);
  const panel = s =>
    s.match(/\n {4}<details class="how linkedonce">[\s\S]*?<\/details>/)?.[0] ?? assert.fail("no panel");
  const tabOf = (h, id) =>
    h.slice(h.indexOf(`id="p-${id}"`), h.indexOf('<section class="tp"', h.indexOf(`id="p-${id}"`)));
  assert.ok(tabOf(on.html, "links").includes(panel(on.html)), "on the Links tab");
  for (const t of ["overview", "findings", "limits"])
    assert.equal(
      tabOf(on.html, t),
      tabOf(off.html, t),
      `only the panel changes: the score and areas are the same (${t})`,
    );
  for (const s of [panel(on.html), on.md]) {
    assert.match(s, /25 pages/);
    assert.match(s, /first 20/);
    assert.match(s, /\/p19\//);
    assert.match(s, /easy to miss/);
    assert.match(s, /Information only/);
  }
  assert.ok(
    !on.html.includes("<img src=x") && on.html.includes("&lt;img src=x onerror=alert(1)&gt;"),
    "crawled text is escaped",
  );
  assert.ok(!/(^|[^\\`])<img src=x/m.test(on.md.replace(/`[^`]*`/g, "")), "and in the Markdown");
  const capped = await renderReport({ ...base, linkedOnce: { count: 1, pages: pages.slice(0, 1), capped: true } });
  assert.match(panel(capped.html), /--max/);
  assert.ok(!off.html.includes("linkedonce") && !off.md.includes("one incoming link"));
});
