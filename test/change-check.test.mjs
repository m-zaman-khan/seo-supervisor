// The before/after check with a control group, and its report line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, SKILL, node, tmp } from "./helpers.mjs";
import { changeCheck } from "../skills/seo-supervisor/scripts/change-check.mjs";

const CLI = join(SCRIPTS, "change-check.mjs"),
  SITE = "https://www.example.com";
const SC = "https://www.googleapis.com/auth/webmasters.readonly";
const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const DATE = day(40); // the 28 days after it end 12 days ago, so Search Console's numbers are final

// A local fake Search Console. pages: { url or path: [clicks before, clicks after] }, null where Search Console has no
// row for that window. Impressions are clicks * 20 + 5.
async function fakeGoogle(pages) {
  const hits = [];
  const routes = {
    "POST /token": () => [200, { access_token: "fresh", expires_in: 3599 }],
    "GET /webmasters/v3/sites": () => [
      200,
      {
        siteEntry: [
          { siteUrl: "https://other.example/", permissionLevel: "siteOwner" },
          { siteUrl: "sc-domain:example.com", permissionLevel: "siteFullUser" },
        ],
      },
    ],
    "POST /webmasters/v3/sites/sc-domain:example.com/searchAnalytics/query": ({ body }) => {
      const i = body.endDate < DATE ? 0 : 1;
      const rows = Object.entries(pages)
        .filter(([, v]) => v[i] != null)
        .map(([u, v]) => ({
          keys: [u.startsWith("http") ? u : SITE + u],
          clicks: v[i],
          impressions: v[i] * 20 + 5,
          ctr: 0.05,
          position: 5,
        }));
      return [200, { rows: rows.slice(body.startRow, body.startRow + body.rowLimit) }];
    },
  };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", c => {
      raw += c;
    });
    req.on("end", () => {
      const hit = {
        method: req.method,
        path: decodeURIComponent(new URL(req.url, "http://x").pathname),
        body: /json/.test(req.headers["content-type"] || "") ? JSON.parse(raw) : raw,
      };
      hits.push(hit);
      const [status, json] = routes[`${hit.method} ${hit.path}`]?.(hit) || [
        404,
        { error: { code: 404, message: "no such fake route" } },
      ];
      res.writeHead(status, { "content-type": "application/json", connection: "close" }).end(JSON.stringify(json));
    });
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const endpoints = { token: base + "/token", searchConsole: base + "/webmasters/v3" };
  return {
    hits,
    endpoints,
    env: { SEO_GOOGLE_TOKEN_URL: endpoints.token, SEO_GOOGLE_SEARCH_CONSOLE_URL: endpoints.searchConsole },
    close: () =>
      new Promise(c => {
        server.closeAllConnections();
        server.close(c);
      }),
  };
}
function signedIn() {
  const home = tmp();
  mkdirSync(join(home, ".seo-supervisor"), { recursive: true });
  writeFileSync(
    join(home, ".seo-supervisor", "google.json"),
    JSON.stringify({
      method: "own-client",
      client: { id: "own-id", secret: "own-secret" },
      access_token: "fresh",
      refresh_token: "r1",
      expires_at: Date.now() + 3600e3,
      scope: SC,
    }),
  );
  return home;
}
const run = async (pages, extra = {}) => {
  const g = await fakeGoogle(pages),
    home = signedIn();
  try {
    return {
      r: await changeCheck({
        site: SITE,
        date: DATE,
        pages: ["/c1/", "/c2/", "/c3/"],
        home,
        endpoints: g.endpoints,
        ...extra,
      }),
      hits: g.hits,
    };
  } finally {
    await g.close();
  }
};

// Unchanged pages move up to 15% either way; the changed pages /c1/ to /c3/ move by the factors given.
const F = [0.85, 1.15, 0.9, 1.1, 1];
const controls = (n, from = 40) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`/p${i + 1}/`, [from + 5 * i, Math.round((from + 5 * i) * F[i % 5])]]),
  );
const changed = (...fs) =>
  Object.fromEntries(fs.map((f, i) => [`/c${i + 1}/`, [50 + 10 * i, Math.round((50 + 10 * i) * f)]]));
const lr = ([b, a]) => Math.log((a + 1) / (b + 1)),
  mean = v => v.reduce((s, x) => s + x, 0) / v.length;
const pct = (ch, ctl) =>
  Math.round((Math.exp(mean(Object.values(ch).map(lr)) - mean(Object.values(ctl).map(lr))) - 1) * 100);

test("likely up: the changed pages doubled while similar pages held steady; the effect is the mean log change against the control group", async () => {
  const ch = changed(2, 2, 2),
    ctl = controls(20);
  const { r, hits } = await run({ ...ch, ...ctl, "/huge/": [5000, 5000] }, { pageSize: 7 });
  assert.equal(r.verdict, "likely up");
  assert.equal(r.clicks.verdict, "likely up");
  assert.equal(
    r.clicks.percent,
    pct(ch, ctl),
    "changed pages' mean of log((after+1)/(before+1)) minus the control group's, as a percentage",
  );
  assert.ok(
    r.clicks.low > 0 && r.clicks.low < r.clicks.percent && r.clicks.high > r.clicks.percent,
    JSON.stringify(r.clicks),
  );
  const imp = v => Object.fromEntries(Object.entries(v).map(([k, [b, a]]) => [k, [b * 20 + 5, a * 20 + 5]]));
  assert.equal(r.impressions.verdict, "likely up");
  assert.equal(r.impressions.percent, pct(imp(ch), imp(ctl)));
  assert.deepEqual(
    r.windows,
    {
      before: {
        from: new Date(Date.parse(DATE) - 28 * 864e5).toISOString().slice(0, 10),
        to: new Date(Date.parse(DATE) - 864e5).toISOString().slice(0, 10),
      },
      after: {
        from: new Date(Date.parse(DATE) + 864e5).toISOString().slice(0, 10),
        to: new Date(Date.parse(DATE) + 28 * 864e5).toISOString().slice(0, 10),
      },
    },
    "28 days each side, the change day left out",
  );
  assert.deepEqual(r.groups.changed, {
    pages: 3,
    paths: ["/c1/", "/c2/", "/c3/"],
    clicks: { before: 180, after: 360 },
    impressions: { before: 3615, after: 7215 },
  });
  assert.equal(r.groups.control.pages, 20, "/huge/ is far outside the changed pages' range, so it isn't a control");
  assert.match(r.groups.control.rule, /25 to 140 clicks/);
  assert.match(r.groups.control.rule, /our own/);
  assert.equal(r.property, "sc-domain:example.com");
  assert.equal(r.findings, undefined, "information only: never a finding");
  const sa = hits.filter(h => h.path.endsWith("/searchAnalytics/query"));
  assert.ok(sa.every(h => h.body.type === "web" && h.body.dimensions.join() === "page"));
  assert.deepEqual(
    sa.filter(h => h.body.startDate === r.windows.before.from).map(h => h.body.startRow),
    [0, 7, 14, 21],
    "pages of rows are read with startRow",
  );
  assert.deepEqual(
    [...new Set(sa.map(h => `${h.body.startDate} ${h.body.endDate}`))],
    [`${r.windows.before.from} ${r.windows.before.to}`, `${r.windows.after.from} ${r.windows.after.to}`],
  );
});

test("likely down: the changed pages halved", async () => {
  const ch = changed(0.5, 0.5, 0.5),
    ctl = controls(20);
  const { r } = await run({ ...ch, ...ctl });
  assert.equal(r.verdict, "likely down");
  assert.equal(r.clicks.percent, pct(ch, ctl));
  assert.ok(r.clicks.high < 0 && r.clicks.low < r.clicks.percent, JSON.stringify(r.clicks));
});

test("inconclusive when the changed pages went different ways, and the same data always gives the same answer", async () => {
  const pages = { ...changed(1.6, 0.6, 1), ...controls(20) };
  const { r } = await run(pages),
    { r: again } = await run(pages);
  assert.equal(r.verdict, "inconclusive");
  assert.ok(r.clicks.low < 0 && r.clicks.high > 0, JSON.stringify(r.clicks));
  assert.match(r.clicks.reason, /includes no change/);
  assert.deepEqual(again, r, "a fixed seed: deterministic");
});

test("inconclusive with too few comparable pages, or too little traffic", async () => {
  const big = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`/big${i}/`, [1000 + i, 1000]]));
  const { r } = await run({ ...changed(2, 2, 2), ...controls(6), ...big });
  assert.equal(r.groups.control.pages, 6);
  assert.equal(r.verdict, "inconclusive");
  assert.equal(r.clicks.percent, undefined, "no range without enough controls");
  assert.match(r.clicks.reason, /too few comparable pages/);
  assert.match(r.clicks.reason, /6 unchanged pages/);
  assert.match(r.clicks.reason, /at least 10 \(our own minimum\)/);

  const small = {
    "/c1/": [3, 6],
    "/c2/": [4, 8],
    ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`/s${i}/`, [2 + (i % 6), 3 + (i % 6)]])),
  };
  const { r: r2 } = await run(small, { pages: ["/c1/", "/c2/"] });
  assert.equal(r2.verdict, "inconclusive");
  assert.match(r2.clicks.reason, /too little traffic/);
  assert.match(r2.clicks.reason, /21 clicks/);
  assert.match(r2.clicks.reason, /at least 30 \(our own minimum\)/);
  assert.notEqual(r2.impressions.reason, r2.clicks.reason, "impressions are judged on their own");
});

test("not enough days since the change: says how long to wait and reads nothing from Google", async () => {
  const g = await fakeGoogle(controls(20)),
    home = signedIn();
  try {
    const at = date => changeCheck({ site: SITE, date, pages: ["/c1/"], home, endpoints: g.endpoints });
    await assert.rejects(
      at(day(30)),
      e => /Wait 1 more day /.test(e.message) && /Nothing was read from Google/.test(e.message),
    );
    await assert.rejects(
      at(day(20)),
      e => /Wait 11 more days /.test(e.message) && new RegExp(day(-11)).test(e.message),
    );
    await assert.rejects(at(day(-5)), /Wait 36 more days/, "a date in the future too");
    assert.equal(g.hits.length, 0);
    await assert.rejects(at("2026-02-30"), /--date must be/);
    await assert.rejects(
      changeCheck({ site: SITE, date: DATE, pages: ["/c1/"], days: 3, home, endpoints: g.endpoints }),
      /--days must be/,
    );
    await assert.rejects(
      changeCheck({ site: SITE, date: day(470), pages: ["/c1/"], home, endpoints: g.endpoints }),
      /16 months/,
    );
    const ok = await at(day(31));
    assert.equal(ok.windows.after.to, day(3), "the window after may end 3 days ago");
  } finally {
    await g.close();
  }
});

test("Search Console addresses: www and the bare domain are one page, other subdomains and other sites are left out, new pages are named", async () => {
  const { r } = await run(
    {
      ...controls(12),
      "https://www.example.com/c1/": [30, 60],
      "http://example.com/c1/": [20, 40], // the same page by another address: added up
      "https://blog.example.com/c1/": [500, 10], // in the domain property, but not this site
      "https://www.example.com/c2/?id=2": [60, 120], // the query string is part of the page
      "/new/": [null, 30], // no row before the change
    },
    {
      pages: [
        "https://example.com/c1/",
        "/c2/?id=2",
        "https://blog.example.com/c1/",
        "ftp://www.example.com/x",
        "# a comment",
        "",
        "/new/",
        "/c2/?id=2",
      ],
    },
  );
  assert.deepEqual(r.groups.changed.paths, ["/c1/", "/c2/?id=2"]);
  assert.deepEqual(r.groups.changed.clicks, { before: 110, after: 220 });
  assert.equal(r.groups.control.pages, 12, "the other subdomain's page is never a control");
  const off = r.notes.find(n => /aren't on www\.example\.com/.test(n));
  assert.match(off, /^2 of the pages/);
  assert.match(off, /https:\/\/blog\.example\.com\/c1\//);
  assert.match(
    r.notes.find(n => /\/new\//.test(n)),
    /no Google Search data in the 28 days before the change/,
  );
  await assert.rejects(
    run(controls(12), { pages: ["https://elsewhere.example.org/a/"] }),
    /none of the pages listed are on www\.example\.com/,
  );
});

test("the CLI reads --pages and --from-diff, writes change-check.json and prints a short summary, with no --yes (like google.mjs fetch)", async () => {
  const g = await fakeGoogle({ ...changed(2, 2, 2), ...controls(20), "/new/": [null, 30] }),
    home = signedIn(),
    dir = tmp();
  try {
    writeFileSync(join(dir, "pages.txt"), "# changed on the day\r\n/c1/\r\n");
    writeFileSync(
      join(dir, "seo-diff.json"),
      JSON.stringify({
        changed: [{ path: "/c3/", kind: "title-changed" }],
        regressions: [{ path: "/c2/", kind: "lost-internal-links" }],
        added: ["/new/"],
      }),
    );
    const out = join(dir, "out", "change-check.json");
    const { stdout } = await node(
      [
        CLI,
        "--site",
        SITE,
        "--date",
        DATE,
        "--pages",
        join(dir, "pages.txt"),
        "--from-diff",
        join(dir, "seo-diff.json"),
        "--out",
        out,
      ],
      { env: { ...process.env, HOME: home, USERPROFILE: home, ...g.env } },
    );
    const r = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(r.source, "change-check");
    assert.deepEqual(
      r.groups.changed.paths,
      ["/c1/", "/c3/"],
      "seo-diff's content changes and added pages; /new/ has no past",
    );
    assert.match(
      stdout,
      /^change-check: 2 changed pages against 21 similar unchanged pages/,
      "/c2/ changed too but isn't listed, so it counts as unchanged",
    );
    assert.match(
      stdout,
      /Clicks: likely up, about \+\d+% compared with the similar unchanged pages \(likely range \+\d+% to \+\d+%\)/,
    );
    assert.match(stdout, /not why/);
    assert.match(stdout, /note: .*\/new\//);
    await assert.rejects(node([CLI, "--site", SITE]), e => e.code === 2 && /usage/.test(e.stderr));
    writeFileSync(join(dir, "bad.json"), "null");
    await assert.rejects(
      node([CLI, "--site", SITE, "--date", DATE, "--from-diff", join(dir, "bad.json")], {
        env: { ...process.env, HOME: home, USERPROFILE: home, ...g.env },
      }),
      e => e.code === 2 && /isn't a seo-diff\.json/.test(e.stderr),
    );
  } finally {
    await g.close();
  }
});

// ---------- the report ----------
const render = async extra => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  writeFileSync(join(dir, "a.json"), JSON.stringify({ ...data, ...extra }));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
};

test("the report shows one information-only line for changeCheck, escaped, and nothing without it", async () => {
  const before = await render({});
  assert.doesNotMatch(before.html + before.md, /Change check/);
  const up = await render({
    changeCheck: {
      changeDate: "2026-10-01",
      days: 28,
      verdict: "likely up",
      groups: { changed: { pages: 3 }, control: { pages: 20 } },
      clicks: { verdict: "likely up", percent: 18, low: 5, high: 33 },
    },
  });
  const line =
    "Change check, 3 pages changed on 1 Oct 2026, 28 days before and after: Google Search clicks likely up, about +18% compared with 20 similar unchanged pages (likely range +5% to +33%). This shows what happened to the numbers, not why. Information only.";
  assert.ok(up.html.includes(line), "HTML line");
  assert.ok(up.md.includes("## Change check\n\n" + line), "Markdown line");
  assert.equal(
    up.html.replace(`\n    <p class="quiet">${line}</p>`, ""),
    before.html,
    "adds that line and nothing else: never the score",
  );
  const xss = "<img src=x onerror=alert(1)>";
  const no = await render({
    changeCheck: {
      changeDate: "2026-10-01",
      days: 28,
      verdict: "inconclusive",
      groups: { changed: { pages: 1 }, control: { pages: 4 } },
      clicks: { verdict: "inconclusive", reason: xss },
    },
  });
  assert.ok(
    no.html.includes("Google Search clicks inconclusive, &lt;img src=x onerror=alert(1)&gt;. This shows"),
    "escaped",
  );
  assert.ok(!no.html.includes(xss));
  const odd = await render({
    changeCheck: { changeDate: "2026-10-01", verdict: "likely up", clicks: { verdict: "likely up", percent: "18" } },
  });
  assert.doesNotMatch(odd.html, /Change check/, "a verdict without its numbers shows nothing");
});
