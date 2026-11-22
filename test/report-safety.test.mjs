// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SKILL, node, tmp } from "./helpers.mjs";
import { render } from "../skills/seo-supervisor/scripts/render-report.mjs";
import { summaryOf } from "../skills/seo-supervisor/scripts/dashboard.mjs";
import { SCORE_HOW } from "../skills/seo-supervisor/scripts/report/overview.mjs";
import { mdSafe } from "../skills/seo-supervisor/scripts/report/format.mjs";
import { issueOf } from "../skills/seo-supervisor/scripts/issues.mjs";

const KITCHEN = JSON.parse(readFileSync(join(ROOT, "test", "golden", "kitchen-sink.json"), "utf8"));
const SAMPLE = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
const copy = x => JSON.parse(JSON.stringify(x));
/** @param {any} raw @param {string | null} [mdFile] */
const rend = (raw, mdFile = "r.md") => render(copy(raw), { dir: tmp(), mdFile });

// Runs fn with the machine's time zone set to each zone in turn (Node applies a new TZ at once).
function inZones(zones, fn) {
  const was = process.env.TZ;
  try {
    for (const tz of zones) {
      process.env.TZ = tz;
      fn(tz);
    }
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
}

test("dates are the same day west and east of UTC, in the report and the dashboard", () => {
  const dir = tmp();
  writeFileSync(
    join(dir, "seo-audit.json"),
    JSON.stringify({ site: { name: "S" }, run: { date: "2026-11-17" }, findings: [] }),
  );
  const audit = {
    site: { name: "S", url: "https://s.example" },
    run: { date: "2026-11-17" },
    findings: [],
    passed: [{ rule: "R-1", category: "Other" }],
    diff: { since: "2026-10-01", regressions: [], improvements: [], changed: [], added: [], removed: [] },
    changeCheck: { changeDate: "2026-09-03", days: 28, clicks: { verdict: "inconclusive" } },
  };
  inZones(["America/Los_Angeles", "Asia/Karachi", "UTC"], tz => {
    const { html, md } = rend(audit);
    assert.match(html, /<span>17 Nov 2026<\/span>/, `${tz}: the header's date`);
    assert.match(html, / · 17 Nov 2026<\/span><\/div><\/footer>/, `${tz}: the footer's date`);
    assert.match(html, /Compared with the crawl of 1 Oct 2026\./, `${tz}: since last audit`);
    assert.match(html, /changed on 3 Sept? 2026/, `${tz}: the change check's day`);
    assert.match(md ?? "", /· 17 Nov 2026/, `${tz}: the Markdown's date`);
    // A crawl's own time is UTC, and a time written with its offset keeps its own day.
    assert.match(
      rend({
        tool: "seo-supervisor-crawler",
        siteOrigin: "https://s.example",
        crawledAt: "2026-11-20T02:00:00.000Z",
        findings: [],
      }).html,
      /<span>20 Nov 2026<\/span>/,
      `${tz}: a crawl's time`,
    );
    assert.match(
      rend({ ...audit, run: { date: "2026-11-20T23:30:00-08:00" } }).html,
      /<span>20 Nov 2026<\/span>/,
      `${tz}: a time with an offset`,
    );
    assert.equal(summaryOf(dir).date, "17 Nov 2026", `${tz}: the dashboard`);
  });
});

test('"How this score works" is written once: the page and the Markdown say the same words', () => {
  const { html, md } = rend(SAMPLE);
  assert.match(SCORE_HOW, /^Every checked rule is worth 10 points\..* not Google's: .*search engines don't use it\.$/);
  assert.ok(html.includes(`<summary>How this score works</summary>\n        <p>${SCORE_HOW}</p>`));
  assert.ok(md?.includes(`## How the score works\n\n${SCORE_HOW}\n`));
});

test("each failed Lighthouse audit is listed once, and odd runs in the file are skipped, not fatal", () => {
  const audit = {
    site: { name: "S", url: "https://s.example" },
    findings: [],
    passed: [{ rule: "R-1", category: "Other" }],
    lighthouse: [
      null,
      "x",
      { url: 5 },
      { scores: {} },
      {
        url: "https://s.example/",
        passed: 40,
        scores: { performance: 70, accessibility: 81 },
        detail: [
          { title: "Image elements lack alt-zz", category: "Accessibility", items: ["img.hero"] },
          { title: "Cut render-blocking-zz", category: "Performance", items: ["/app.css"] },
          "junk",
        ],
      },
      {
        url: "https://s.example/about/",
        detail: [{ title: "Buttons lack names-zz", category: "Accessibility", items: [] }],
      },
    ],
  };
  const { html, md } = rend(audit);
  for (const t of ["Image elements lack alt-zz", "Buttons lack names-zz", "Cut render-blocking-zz"]) {
    assert.equal(html.split(t).length - 1, 1, `${t}: once on the page`);
    assert.equal((md ?? "").split(t).length - 1, 1, `${t}: once in the Markdown`);
  }
  const details = html.slice(
    html.indexOf('class="how lhdetail"'),
    html.indexOf('class="how', html.indexOf('class="how lhdetail"') + 1),
  );
  assert.match(details, /The accessibility ones are under Lighthouse(&#39;|')s accessibility checks/);
  assert.doesNotMatch(
    details,
    /\/about\//,
    "a page whose only failed audits are accessibility ones isn't in Lighthouse details",
  );
  assert.match(html, /<code>\/<\/code> · 1 failed audit</, "the count leaves the accessibility audit out");
  assert.match(html, /Lighthouse \(mobile, home page\): Performance 70/);
  assert.match(html, /passed 40 audits, failed 2/, "the speed details still count every failed audit");
});

test("one bad URL in the audit file can't stop the report, and the Markdown's title escapes the site name", () => {
  const audit = {
    site: { name: "Shop [x](javascript:alert(1)) <b>*", url: "https://s.example" },
    findings: [],
    passed: [{ rule: "R-1", category: "Other" }],
    labSpeed: [null, { url: "not a url", lcp: 3100, tbt: 250 }],
    speed: { lcpBreakdown: { source: "lab", url: "http://[bad", ttfb: 2400, loadDelay: 100 } },
    lighthouse: [{ url: "::nope::", scores: { performance: 50 } }],
  };
  const { html, md } = rend(audit);
  assert.match(html, /Lab speed, slow mobile \(indicative\): LCP 3\.1 s · TBT 250 ms on not a url/);
  assert.match(html, /LCP breakdown \(lab test, http:\/\/\[bad\): most of the time goes on the server&#39;s response/);
  assert.match(html, /Lighthouse \(mobile, ::nope::\): Performance 50/);
  assert.match(md ?? "", /^# SEO report: Shop \\\[x\\\]\(javascript:alert\(1\)\) \\<b\\>\\\*$/m);
  const crawl = rend({
    tool: "seo-supervisor-crawler",
    siteOrigin: "no origin",
    crawledAt: "2026-11-20T02:00:00Z",
    findings: [],
  });
  assert.match(crawl.html, /<h1>no origin<\/h1>/, "a crawl file with a bad origin is named by it");
});

// Every href on the page: an anchor in the page or a full http(s) address, nothing else.
const hrefsOf = html => [...html.matchAll(/\shref="([^"]*)"/g)].map(m => m[1]);
const BAD_URLS = [
  "javascript:alert(document.domain)//",
  "JaVaScRiPt:alert(1)",
  " javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "//evil.example/x",
  "/\\evil.example",
  "https:evil.example",
  "vbscript:x",
  "file:///etc/passwd",
];

test("a javascript:, data: or protocol-relative URL never becomes a link, in the page or the Markdown", () => {
  const audit = {
    site: { name: "S", url: "javascript:alert(1)" },
    run: { date: "2026-11-17" },
    passed: [{ rule: "R-1", category: "Other" }],
    findings: [
      {
        id: "F-001",
        rule: "MAP-04",
        severity: "medium",
        title: "Sitemap URLs",
        category: "Sitemaps & robots",
        check: "sitemap-session-ids",
        evidence: [...BAD_URLS, "https://ok.example/a?b=1"].map(url => ({ url, detail: "a <loc> in the sitemap" })),
      },
    ],
    authority: [{ domain: "s.example", ahrefsDR: 40 }],
    attribution: { text: "Domain Rating by Ahrefs", url: "javascript:alert(2)" },
    googleUpdates: {
      from: "2026-10-01",
      to: "2026-11-01",
      updates: [{ name: "Core update", start: "2026-10-05", end: "2026-10-20", url: "data:text/html,x" }],
      posts: [{ title: "A post", date: "2026-10-09", url: "//evil.example/p" }],
    },
  };
  const { html, md } = rend(audit);
  assert.deepEqual(
    hrefsOf(html).filter(h => !h.startsWith("#")),
    ["https://ok.example/a?b=1"],
    "the one web address is the only outside link",
  );
  assert.match(html, /<td>javascript:alert\(document\.domain\)\/\/<\/td>/, "the sitemap URL shows as text");
  assert.match(html, /<td>data:text\/html,&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/td>/);
  assert.match(html, /<span>javascript:alert\(1\)<\/span>/, "the site's address shows as text in the header");
  assert.match(html, / · Domain Rating by Ahrefs<\/p>/, "the credit shows, unlinked");
  assert.match(html, /Core update \(5–20 Oct\)/);
  assert.doesNotMatch(md ?? "", /\]\((?!https:\/\/ok)/, "no Markdown link but to a web address");
  // A good address still links, with its Markdown link closed safely.
  const good = rend({ ...audit, attribution: { text: "Domain Rating by Ahrefs", url: "https://ahrefs.com/a (b)" } });
  assert.match(good.html, /<a href="https:\/\/ahrefs\.com\/a \(b\)" rel="noopener">Domain Rating by Ahrefs<\/a>/);
  assert.match(good.md ?? "", /\[Domain Rating by Ahrefs\]\(https:\/\/ahrefs\.com\/a%20%28b%29\)/);
});

test("the page carries a strict Content-Security-Policy that allows exactly its own two scripts", () => {
  for (const raw of [KITCHEN, SAMPLE, { ...SAMPLE, plan: { status: "proposed", pages: [] } }]) {
    const { html } = rend(raw);
    const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1] ?? "";
    assert.ok(
      html.indexOf("Content-Security-Policy") < html.indexOf("<script"),
      "the policy comes before the first script",
    );
    assert.match(
      policy,
      /^default-src 'none'; script-src 'sha256-[A-Za-z0-9+/]+=' 'sha256-[A-Za-z0-9+/]+='; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'$/,
    );
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.equal(scripts.length, 2);
    assert.deepEqual(
      policy.match(/'sha256-[^']+'/g),
      scripts.map(s => `'sha256-${createHash("sha256").update(s).digest("base64")}'`),
      "each hash is its script's",
    );
    assert.doesNotMatch(html, /<[a-z][^>]*\son[a-z]+\s*=/i, "no inline event handlers, which the policy would block");
    assert.doesNotMatch(html, /<(img|iframe|object|embed|link|base|form)\b/i, "nothing that loads or submits");
  }
});

// The Markdown lines with a live link, image or HTML tag: outside fenced blocks, backslash escapes and code spans.
function liveMd(md) {
  let fence = false;
  return md.split("\n").filter(l => {
    if (/^```/.test(l)) {
      fence = !fence;
      return false;
    }
    const t = l.replace(/\\[\\`*_[\]<>|()!]/g, "").replace(/(`+)[\s\S]*?\1/g, "");
    return !fence && /\]\(|<[a-z/!]|!\[|^\[|\]\[/i.test(t);
  });
}
// The audit with hostile Markdown and HTML added to every sentence-like string, and to every path and address.
const walk = (x, f) =>
  Array.isArray(x)
    ? x.map(y => walk(y, f))
    : x && typeof x === "object"
      ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v, f)]))
      : f(x);
const HOSTILE = " ![x](https://tracker.invalid/p.png) <img src=x onerror=alert(1)> [z](javascript:a) *x* _y_";
const hostile = raw =>
  walk(copy(raw), v =>
    typeof v !== "string"
      ? v
      : / /.test(v)
        ? v + HOSTILE
        : /^\/|^https?:\/\//.test(v)
          ? v + "?a=[z](javascript:a)<b>"
          : v,
  );

test("text from the audit file can't become a link, an image or a tag in the Markdown", () => {
  for (const raw of [KITCHEN, SAMPLE]) assert.deepEqual(liveMd(rend(hostile(raw)).md ?? ""), []);
  const { md } = rend({
    site: { name: "S", url: "javascript:alert(1)" },
    run: { date: "2026-11-17" },
    findings: [],
    passed: [{ rule: "R-1", category: "Other", title: "T", detail: "<b>d</b>" }],
    notes: ["![x](https://tracker.invalid/p.png) <img src=x onerror=alert(1)>"],
    notChecked: [{ area: "A*", reason: "<img src=x onerror=alert(1)>" }],
  });
  assert.ok(
    md?.includes("- !\\[x\\](`https://tracker.invalid/p.png`) \\<img src=x onerror=alert(1)\\>"),
    "a note: the image is inert, the address a code span",
  );
  assert.ok(md?.includes("- **A\\*:** \\<img src=x onerror=alert(1)\\>"), "a not-checked reason");
  assert.ok(md?.includes("- **R-1** T (\\<b\\>d\\</b\\>)"), "a passed check's detail");
});

test("the agent's own `code` and **bold** stay, as the page shows them", () => {
  const f = {
    id: "F-001",
    rule: "R-1",
    severity: "low",
    category: "Other",
    title: "T",
    status: "fixed",
    why: "Use **one** `canonical`.",
    fix: "Set `SITE_URL` in https://example.com/a_b.",
    fixed: { summary: "Read **SITE_URL**", files: ["src/a`b.ts"], verified: "re-crawl" },
    decision: { question: "Q?", options: ["Keep `www`", "Drop *it*"], recommendation: "Drop" },
  };
  const { md } = rend({ site: { name: "S" }, findings: [f], summary: "Two **blockers** and `noindex`." });
  for (const s of [
    "Two **blockers** and `noindex`.",
    "**Why it matters.** Use **one** `canonical`.",
    "**How to fix.** Set `SITE_URL` in `https://example.com/a_b`.",
    "**What was done.** Read **SITE\\_URL** Files: `src/a b.ts`.",
    "- Keep `www`",
    "- Drop \\*it\\*",
  ])
    assert.ok(md?.includes(s), s);
});

test("issues.mjs escapes a finding's text with the report's own Markdown escaper, not a copy", () => {
  const src = readFileSync(join(SKILL, "scripts", "issues.mjs"), "utf8");
  assert.match(src, /import \{ mdSafe, noteCode as code, noteMd \} from "\.\/report\/format\.mjs";/);
  assert.doesNotMatch(src, /\[\\\\`\*_\[\\\]<>\]/, "no escaper of its own");
  const what = "See **this** `code`, https://a.example/x_y and [z](javascript:a) <img src=x onerror=alert(1)>";
  assert.ok(
    issueOf({ id: "F-001", severity: "low", title: "T", what }, "https://s.example").body.includes(
      `**What's wrong.** ${mdSafe(what)}`,
    ),
  );
  assert.match(
    issueOf({ id: "F-001", severity: "low", title: "T", what: "ask @alice" }, "https://s.example").body,
    /ask @​alice/,
    "and no one is pinged",
  );
});

test("the dashboard reads the report's one score summary and shared helpers, so its numbers match the report", () => {
  const src = readFileSync(join(SKILL, "scripts", "dashboard.mjs"), "utf8");
  assert.match(src, /import \{ bandOf, scoreSummary, OWN_SCORE \} from "\.\/lib\/score\.mjs";/);
  assert.match(src, /import \{ esc, fmtDate, plural \} from "\.\/report\/format\.mjs";/);
  assert.doesNotMatch(src, /const (esc|plural|fmtDate) =|buildRules\(|findingsOf\(/, "no copies of its own");
  for (const raw of [KITCHEN, SAMPLE]) {
    const dir = tmp();
    writeFileSync(join(dir, "seo-audit.json"), JSON.stringify(raw));
    const r = render(copy(raw), { dir }),
      d = summaryOf(dir);
    assert.ok(r.receipt[0].startsWith(`SEO health score: ${d.score.value}/100`), r.receipt[0]);
    assert.equal(
      d.unlock?.value ?? null,
      Number(r.receipt.find(l => /^Fixing the/.test(l))?.match(/raises it to (\d+)/)?.[1] ?? NaN) || null,
    );
    assert.ok(r.receipt.some(l => l.startsWith(`Open: ${d.open} (${d.blockers} blocker, ${d.high} high,`)));
  }
});

const RENDER = join(SKILL, "scripts", "render-report.mjs");
// The command's exit code and output, whether it fails or not.
const cli = args =>
  node([RENDER, ...args]).then(
    r => ({ code: 0, ...r }),
    e => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }),
  );

test("a missing, unreadable or wrong input file is one plain line and exit 2, never a stack trace", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "bad.json"), "{ not json");
  writeFileSync(join(dir, "list.json"), "[]");
  for (const [args, re] of [
    [[join(dir, "nope.json")], /^render-report: can't open .*nope\.json \(it isn't there\)\.$/],
    [[join(dir, "bad.json")], /^render-report: .*bad\.json isn't valid JSON \(/],
    [[join(dir, "list.json")], /^render-report: .*list\.json isn't an audit/],
    [[], /^Usage: node render-report\.mjs </],
  ]) {
    const r = await cli(args);
    assert.equal(r.code, 2, `${args}: exit 2`);
    assert.match(r.stderr.trim(), re);
    assert.equal(r.stderr.trim().split("\n").length, 1, "one line");
  }
});

test("the input file is found whatever the order of the options", async () => {
  const dir = tmp(),
    input = join(dir, "audit.json");
  writeFileSync(input, JSON.stringify(SAMPLE));
  for (const [args, html, md] of [
    [["--out", join(dir, "a.html"), input], "a.html", "a.md"],
    [["--no-md", `--out=${join(dir, "b.html")}`, input], "b.html", null],
    [["--md", join(dir, "c2.md"), input, "--out", join(dir, "c.html")], "c.html", "c2.md"],
    [[input, "--out", join(dir, "d.html")], "d.html", "d.md"],
  ]) {
    const r = await cli(args);
    assert.equal(r.code, 0, `${args.join(" ")}: ${r.stderr}`);
    assert.match(
      r.stdout,
      new RegExp(`Wrote: .*${html.replace(".", "\\.")}${md ? `, .*${md.replace(".", "\\.")}` : "$"}`, "m"),
    );
    assert.match(readFileSync(join(dir, html), "utf8"), /^<!doctype html>/);
  }
  for (const [args, re] of [
    [["--outt", "x.html", input], /unknown option --outt/],
    [[input, join(dir, "other.json")], /unexpected ".*other\.json"/],
    [[input, "--out"], /^Usage:/],
  ]) {
    const r = await cli(args);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.stderr.trim(), re);
  }
});

test("the page's styles have no dead .as.b3-t,.as.b4-t rule", () => {
  const { html } = rend(KITCHEN);
  assert.doesNotMatch(html, /\.as\.b[34]-t/);
  assert.match(html, /\.as\{font:600 16px var\(--mono\);text-align:right\}/, "the .as rule itself stays");
});
