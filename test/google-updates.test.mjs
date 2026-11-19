import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FEED, rankingUpdates } from "../skills/seo-supervisor/scripts/google-updates.mjs";
import { SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";

const SCRIPT = join(SCRIPTS, "google-updates.mjs");
// Entries shaped like the Search Status feed, which uses the Google Cloud status format.
// https://status.search.google.com/incidents.json
const incident = (id, name, begin, end, service = "Ranking") => ({
  id,
  begin,
  ...(end ? { end } : {}),
  external_desc: name,
  service_name: service,
  affected_products: [{ title: service, id: "p" }],
  uri: `incidents/${id}`,
  status_impact: "SERVICE_INFORMATION",
});
const INCIDENTS = [
  incident("rev-apr", "April 2026 reviews update", "2026-04-20T16:00:00+00:00"),
  incident(
    "serving",
    "Serving was experiencing an issue",
    "2026-03-10T03:55:00+00:00",
    "2026-03-10T04:10:00+00:00",
    "Serving",
  ),
  incident("core-mar", "March 2026 core update", "2026-03-05T09:00:00+00:00", "2026-03-19T13:00:00+00:00"),
  incident("spam-feb", "February 2026 spam update", "2026-02-24T19:00:00+00:00", "2026-02-26T14:30:00+00:00"),
  incident("discover", "February 2026 Discover update", "2026-02-05T17:00:00+00:00", "2026-03-02T10:00:00+00:00"),
];
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

// A stand-in for Google's feed that records every request.
async function fakeFeed(body = INCIDENTS, status = 200) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push({ method: req.method, url: req.url });
    res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  return {
    endpoint: `http://127.0.0.1:${server.address().port}/incidents.json`,
    hits,
    close: () => new Promise(ok => server.close(ok)),
  };
}
const run = (args, env = {}) =>
  node([SCRIPT, ...args], { env: { ...process.env, GOOGLE_STATUS_ENDPOINT: "", ...env } });

test("ranking updates whose rollout overlaps the window, oldest first, with Google's own names", () => {
  const u = rankingUpdates(INCIDENTS, { from: "2026-03-02", to: "2026-03-31" });
  assert.deepEqual(
    u,
    [
      {
        name: "February 2026 Discover update",
        start: "2026-02-05",
        end: "2026-03-02",
        url: "https://status.search.google.com/incidents/discover",
      },
      {
        name: "March 2026 core update",
        start: "2026-03-05",
        end: "2026-03-19",
        url: "https://status.search.google.com/incidents/core-mar",
      },
    ],
    "an update ending on the first day counts; one that ended before, a later one and a Serving incident don't",
  );
  assert.deepEqual(
    rankingUpdates(INCIDENTS, { from: "2026-11-01", to: "2026-11-19" }).map(x => [x.name, x.end]),
    [["April 2026 reviews update", null]],
    "no end yet: still rolling out",
  );
  assert.equal(FEED, "https://status.search.google.com/incidents.json");
});

test("without --yes it's a dry run: nothing fetched, nothing written", async () => {
  const feed = await fakeFeed(),
    out = join(tmp(), "google-updates.json");
  try {
    const { stdout } = await run([
      "--from",
      "2026-03-01",
      "--to",
      "2026-03-31",
      "--endpoint",
      feed.endpoint,
      "--out",
      out,
    ]);
    assert.equal(feed.hits.length, 0);
    assert.ok(!existsSync(out));
    assert.match(stdout, /dry run/);
    assert.ok(
      stdout.includes(feed.endpoint) &&
        /2026-03-01 to 2026-03-31/.test(stdout) &&
        /nothing about your site/.test(stdout),
      stdout,
    );
  } finally {
    await feed.close();
  }
});

test("with --yes it reads the feed once with a plain GET and writes the updates in the window", async () => {
  const feed = await fakeFeed(),
    out = join(tmp(), "google-updates.json");
  try {
    const { stdout } = await run([
      "--from",
      "2026-03-01",
      "--to",
      "2026-03-31",
      "--endpoint",
      feed.endpoint,
      "--out",
      out,
      "--yes",
    ]);
    assert.deepEqual(feed.hits, [{ method: "GET", url: "/incidents.json" }]);
    const base = feed.endpoint.replace("incidents.json", "incidents/");
    assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), {
      googleUpdates: {
        from: "2026-03-01",
        to: "2026-03-31",
        updates: [
          { name: "February 2026 Discover update", start: "2026-02-05", end: "2026-03-02", url: base + "discover" },
          { name: "March 2026 core update", start: "2026-03-05", end: "2026-03-19", url: base + "core-mar" },
        ],
      },
    });
    assert.match(stdout, /2 Google ranking updates/);
  } finally {
    await feed.close();
  }
});

test("--since takes a date or a crawl's timestamp and runs to today; the endpoint can come from GOOGLE_STATUS_ENDPOINT", async () => {
  const feed = await fakeFeed(),
    out = join(tmp(), "g.json");
  try {
    await run(["--since", "2026-04-01T08:30:00.000Z", "--out", out, "--yes"], {
      GOOGLE_STATUS_ENDPOINT: feed.endpoint,
    });
    const g = JSON.parse(readFileSync(out, "utf8")).googleUpdates;
    assert.equal(g.from, "2026-04-01");
    assert.equal(g.to, today());
    assert.deepEqual(
      g.updates.map(u => [u.name, u.end]),
      [["April 2026 reviews update", null]],
    );
  } finally {
    await feed.close();
  }
});

test("the default window is the last 90 days, and one reaching past the feed's 12 months says so", async () => {
  const feed = await fakeFeed([]),
    out = join(tmp(), "g.json");
  try {
    await run(["--endpoint", feed.endpoint, "--out", out, "--yes"]);
    assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), {
      googleUpdates: { from: daysAgo(90), to: today(), updates: [] },
    });
    await run(["--since", daysAgo(400), "--endpoint", feed.endpoint, "--out", out, "--yes"]);
    assert.match(JSON.parse(readFileSync(out, "utf8")).googleUpdates.note, /last 12 months.*aren't listed/);
  } finally {
    await feed.close();
  }
});

test("a bad date stops with usage, a failing feed writes nothing", async () => {
  await assert.rejects(run(["--from", "2026-02-30", "--yes"]), e => e.code === 2 && /YYYY-MM-DD/.test(e.stderr));
  await assert.rejects(
    run(["--from", "2026-03-31", "--to", "2026-03-01", "--yes"]),
    e => e.code === 2 && /before/.test(e.stderr),
  );
  const feed = await fakeFeed({ error: "down" }, 503),
    out = join(tmp(), "g.json");
  try {
    await assert.rejects(
      run(["--endpoint", feed.endpoint, "--out", out, "--yes"]),
      e => e.code === 1 && /503/.test(e.stderr),
    );
    assert.ok(!existsSync(out));
  } finally {
    await feed.close();
  }
});

// The sample audit has a diff, so the Since-last-audit tab is there to carry the line too.
async function render(googleUpdates) {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  data.googleUpdates = googleUpdates;
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  const html = readFileSync(join(dir, "r.html"), "utf8"),
    md = readFileSync(join(dir, "r.md"), "utf8");
  const panel = id => {
    const i = html.indexOf(`id="p-${id}"`);
    return html.slice(i, html.indexOf('class="tp"', i)).replace(/<[^>]+>/g, "");
  };
  return {
    html,
    md,
    overview: panel("overview"),
    diff: panel("diff"),
    mdDiff: md.slice(md.indexOf("## Since last audit"), md.indexOf("\n## ", md.indexOf("## Since last audit") + 3)),
  };
}

test("the report names Google's ranking updates in the period on the Overview and Since last audit, and never a cause", async () => {
  const r = await render({
    from: "2026-03-01",
    to: "2026-11-19",
    updates: [
      {
        name: "March 2026 core update",
        start: "2026-03-05",
        end: "2026-03-19",
        url: "https://status.search.google.com/incidents/core-mar",
      },
      { name: "May 2026 core update", start: "2026-05-21", end: "2026-06-02", url: "javascript:alert(1)" },
      {
        name: "November 2026 core update",
        start: "2026-11-10",
        end: null,
        url: "https://status.search.google.com/incidents/nov",
      },
    ],
  });
  const line =
    "Google ranking updates in this period: March 2026 core update (5–19 Mar) · May 2026 core update (21 May – 2 Jun) · November 2026 core update (10 Nov, still rolling out)";
  for (const [where, text] of [
    ["Overview", r.overview],
    ["Since last audit", r.diff],
    ["Markdown", r.md],
    ["Markdown since last audit", r.mdDiff],
  ])
    assert.ok(text.includes(line), where);
  assert.match(
    r.html,
    /<a href="https:\/\/status\.search\.google\.com\/incidents\/core-mar" rel="noopener">March 2026 core update<\/a>/,
  );
  assert.doesNotMatch(r.html, /href="javascript:/, "only http(s) links");
  assert.doesNotMatch(line, /caus|because|due to/i);
});

test("with no updates in the period the line says none were announced", async () => {
  const r = await render({ from: "2026-07-01", to: "2026-08-20", updates: [] });
  const line = "Google ranking updates in this period: none were announced between 1 Jul and 20 Aug 2026";
  assert.ok(
    r.overview.includes(line) && r.md.includes(line),
    r.md.split("\n").find(l => l.startsWith("Google")),
  );
});
