import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { recheckOf } from "../skills/seo-supervisor/scripts/lib/recheck.mjs";
import { applyChecks, findingsOf, knownChecks } from "../skills/seo-supervisor/scripts/lib/score.mjs";
import { deployCheck } from "../skills/seo-supervisor/scripts/deploy-check.mjs";
import { fileIssues, issueOf, pickFindings } from "../skills/seo-supervisor/scripts/issues.mjs";
import { summaryOf } from "../skills/seo-supervisor/scripts/dashboard.mjs";

const HSTS = {
  id: "C-001",
  check: "no-hsts",
  rule: "TRUST-01",
  severity: "low",
  category: "Trust & security",
  title: "The live site sends no Strict-Transport-Security header",
  what: "Found on https://www.example.com/.",
  why: "Browsers can still make a first plain-HTTP request.",
  fix: "Send `Strict-Transport-Security: max-age=31536000`.",
  evidence: [{ url: "https://www.example.com/" }],
  count: 1,
};

// ---------- re-check commands ----------
test("a re-check command is the check's own one-liner, filled with the first evidence URL, single-quoted", () => {
  assert.deepEqual(Object.keys(recheckOf(HSTS)).sort(), ["command", "hint"]);
  assert.equal(recheckOf(HSTS).command, "curl -sI 'https://www.example.com/'");
  assert.equal(
    recheckOf({ check: "robots-blocks-all", evidence: [{ url: "https://www.example.com/robots.txt" }] }).command,
    "curl -si 'https://www.example.com/robots.txt'",
  );
  assert.equal(
    recheckOf({ check: "sitemap-not-in-robots", evidence: [{ url: "https://www.example.com/blog/" }] }).command,
    "curl -si 'https://www.example.com/robots.txt'",
    "robots.txt checks use the site's own robots.txt",
  );
  assert.match(
    recheckOf({ check: "redirect-chain", evidence: [{ url: "http://example.com/a" }] }).command,
    /^curl -sIL 'http:\/\/example\.com\/a'$/,
  );
  assert.match(
    recheckOf({ check: "canonical-missing", evidence: [{ url: "https://www.example.com/p?a=1&b=2" }] }).command,
    /^curl -s -D - 'https:\/\/www\.example\.com\/p\?a=1&b=2' \| grep -ioE /,
  );
  assert.match(
    recheckOf({ check: "home-noindex", evidence: [{ url: "https://www.example.com/" }] }).command,
    /x-robots-tag/,
  );
  assert.equal(
    recheckOf({
      check: "no-hsts",
      evidence: [{ file: "next.config.ts", line: 3 }, { url: "https://www.example.com/later" }],
    }).command,
    "curl -sI 'https://www.example.com/later'",
    "the first evidence item with a URL",
  );
  assert.equal(
    recheckOf({ check: "title-long", evidence: [{ url: "https://www.example.com/" }] }),
    null,
    "no command for a check a one-liner can't prove",
  );
  assert.equal(
    recheckOf({ rule: "TRUST-01", evidence: [{ url: "https://www.example.com/" }] }),
    null,
    "a finding without a check id gets none",
  );
});

test("a crawled URL that could break out of the quotes gets no command at all", () => {
  for (const url of [
    "https://www.example.com/'; rm -rf ~; '",
    "https://www.example.com/$(id)",
    "https://www.example.com/`id`",
    "https://www.example.com/a b",
    'https://www.example.com/"x',
    "https://www.example.com/a\nb",
    "https://www.example.com/\u0007",
    "https://www.example.com/\\x",
    "https://www.example.com/café",
    "https://www.example.com/’",
    "https://www.example.com/{a,b}",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "ftp://example.com/",
    "not a url",
    "//example.com/",
  ])
    assert.equal(recheckOf({ check: "no-hsts", evidence: [{ url }] }), null, JSON.stringify(url));
});

// ---------- check settings ----------
const F = (check, severity, extra = {}) => ({
  id: "C-" + check,
  check,
  rule: "META-01",
  severity,
  status: "open",
  category: "Titles & descriptions",
  title: check,
  evidence: [],
  ...extra,
});

test("check settings turn a check off and change a severity, list both, and never touch a blocker", () => {
  const known = new Set(["title-long", "desc-dup", "home-noindex", "no-hsts"]);
  const r = applyChecks(
    [
      F("title-long", "low"),
      F("title-long", "low"),
      F("desc-dup", "medium"),
      F("home-noindex", "blocker"),
      F("no-hsts", "low"),
      F("x", "low", { check: undefined }),
    ],
    {
      off: ["title-long", "home-noindex", "no-hsts-typo"],
      severity: { "desc-dup": "high", "home-noindex": "low", "no-hsts": "urgent" },
    },
    known,
  );
  assert.deepEqual(
    r.findings.map(f => [f.check, f.severity]),
    [
      ["desc-dup", "high"],
      ["home-noindex", "blocker"],
      ["no-hsts", "low"],
      [undefined, "low"],
    ],
  );
  assert.deepEqual(
    r.off,
    [
      { check: "title-long", count: 2 },
      { check: "home-noindex", count: 0 },
    ],
    "every valid setting is listed, with what it changed",
  );
  assert.deepEqual(r.changed, [
    { check: "desc-dup", to: "high", count: 1 },
    { check: "home-noindex", to: "low", count: 0 },
  ]);
  const w = r.warnings.join("\n");
  assert.match(w, /no-hsts-typo.*isn't a check/);
  assert.match(w, /urgent.*isn't a severity/);
  assert.match(w, /home-noindex.*blocker.*stays/);
  assert.equal(r.warnings.length, 4, w);
  assert.deepEqual(applyChecks([F("a", "low")], undefined, known).findings.length, 1, "no settings, no change");
  assert.match(
    applyChecks([], ["title-long"], known).warnings[0],
    /should be/,
    "a wrong shape is a warning, not a crash",
  );
  assert.deepEqual(
    applyChecks([F("title-long", "low")], { severity: { "title-long": "blocker" } }, known).changed,
    [{ check: "title-long", to: "blocker", count: 1 }],
    "raising to a blocker is the owner's call",
  );
});

test("the known check names come from every script's catalog, and a finding's own check counts too", () => {
  const known = knownChecks();
  for (const id of [
    "robots-blocks-all",
    "mixed-content",
    "no-hsts",
    "outbound-broken",
    "gsc-not-indexed",
    "low-ctr",
    "backlinks-gone",
    "bing-crawl-issues",
    "templated-text",
    "ugc-link-followed",
  ])
    assert.ok(known.has(id), id);
  assert.ok(!known.has("no-hsts-typo"));
  assert.equal(applyChecks([F("brand-new-check", "low")], { off: ["brand-new-check"] }).warnings.length, 0);
});

test("the settings file next to the audit is the one place: report, score, dashboard and issues all read it", async () => {
  const dir = join(tmp(), "seo-audit"),
    file = join(dir, "seo-audit.json");
  mkdirSync(dir, { recursive: true });
  const audit = {
    site: { name: "Example", url: "https://www.example.com" },
    findings: [HSTS, F("title-long", "high", { id: "F-002", rule: "META-02" })],
    passed: [{ rule: "MAP-01", category: "Sitemaps & robots" }],
  };
  writeFileSync(file, JSON.stringify(audit));
  const before = await node([join(SCRIPTS, "render-report.mjs"), file]);
  assert.match(before.stdout, /SEO health score: 70\/100/);
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({
      outsideChecks: { on: false },
      checks: { off: ["no-hsts"], severity: { "title-long": "low", "nope": "low" } },
    }),
  );
  const after = await node([join(SCRIPTS, "render-report.mjs"), file]);
  assert.match(
    after.stdout,
    /SEO health score: 90\/100/,
    "the turned-off check leaves the score; the lowered one earns 8",
  );
  assert.match(after.stdout, /“nope” isn't a check/);
  const html = readFileSync(join(dir, "seo-audit.html"), "utf8"),
    md = readFileSync(join(dir, "seo-audit.md"), "utf8");
  assert.doesNotMatch(html, /id="C-001"/, "no card for a check that's off");
  for (const doc of [html.replace(/&#39;/g, "'"), md]) {
    assert.match(doc, /no-hsts/);
    assert.match(doc, /Turned off: 1 finding left out/);
    assert.match(doc, /title-long/);
    assert.match(doc, /Severity set to low/);
    assert.match(doc, /score leaves turned-off checks out/);
    assert.match(doc, /“nope” isn't a check/);
  }
  assert.equal(summaryOf(dir).score.value, 90, "the dashboard scores the same list");
  assert.deepEqual(
    findingsOf(audit, dir).findings.map(f => f.id),
    ["F-002"],
    "issues.mjs reads the same list",
  );
  writeFileSync(join(dir, "settings.json"), "{ not json");
  assert.match(findingsOf(audit, dir).warnings[0], /isn't valid JSON/);
});

// ---------- re-check commands in the report ----------
test("the finding card and the Markdown show the re-check command, and an unsafe URL shows none", async () => {
  const dir = tmp(),
    file = join(dir, "a.json");
  const evil = {
    ...HSTS,
    id: "C-002",
    check: "hsts-short",
    evidence: [{ url: "https://www.example.com/$(touch pwned)" }],
  };
  writeFileSync(
    file,
    JSON.stringify({ site: { name: "Example", url: "https://www.example.com" }, findings: [HSTS, evil] }),
  );
  await node([join(SCRIPTS, "render-report.mjs"), file, "--out", join(dir, "r.html")]);
  const html = readFileSync(join(dir, "r.html"), "utf8"),
    md = readFileSync(join(dir, "r.md"), "utf8");
  assert.match(html, /<code>curl -sI &#39;https:\/\/www\.example\.com\/&#39;<\/code>/);
  assert.match(md, /`curl -sI 'https:\/\/www\.example\.com\/'`/);
  assert.doesNotMatch(html + md, /curl[^\n]*touch pwned/);
  assert.match(html, /curl\.exe/, "the Windows note");
});

// ---------- Lighthouse's accessibility checks ----------
test("each page's failed Lighthouse accessibility audits show as information, labelled as Lighthouse's, escaped", async () => {
  const dir = tmp(),
    file = join(dir, "a.json");
  const lighthouse = [
    {
      url: "https://www.example.com/",
      scores: { accessibility: 81 },
      detail: [
        {
          id: "image-alt",
          title: "Image elements do not have `[alt]` attributes",
          category: "Accessibility",
          items: ["img.hero<script>"],
        },
        {
          id: "render-blocking-resources",
          title: "Eliminate render-blocking resources",
          category: "Performance",
          items: ["/app.css"],
        },
      ],
    },
    {
      url: "https://www.example.com/about/",
      scores: { accessibility: 100 },
      detail: [{ id: "unused-javascript", title: "Reduce unused JavaScript", category: "Performance", items: [] }],
    },
  ];
  writeFileSync(
    file,
    JSON.stringify({
      site: { name: "Example", url: "https://www.example.com" },
      findings: [],
      passed: [{ rule: "MAP-01", category: "Sitemaps & robots" }],
      lighthouse,
    }),
  );
  await node([join(SCRIPTS, "render-report.mjs"), file, "--out", join(dir, "r.html")]);
  const html = readFileSync(join(dir, "r.html"), "utf8"),
    md = readFileSync(join(dir, "r.md"), "utf8");
  const panel = html.slice(html.indexOf('class="how a11y"'));
  assert.ok(html.includes('class="how a11y"'));
  assert.match(panel, /Lighthouse(?:'|&#39;)s accessibility checks/);
  assert.match(panel, /Accessibility 81/);
  assert.match(panel, /img\.hero&lt;script&gt;/);
  assert.doesNotMatch(
    panel.slice(0, panel.indexOf("</details></details>")),
    /render-blocking|\/about\//,
    "only failed accessibility checks, only pages that have one",
  );
  const sec = md.slice(md.indexOf("## Lighthouse's accessibility checks"));
  assert.ok(md.includes("## Lighthouse's accessibility checks"));
  assert.match(sec, /Image elements do not have \\`\\\[alt\\\]\\` attributes/);
  assert.match(sec, /don't change the score/);
});

// ---------- the after-deploy check ----------
async function site(routes) {
  const server = createServer((req, res) => {
    const r = routes[req.url];
    if (!r) return res.writeHead(404, { "content-type": "text/plain" }).end("no");
    const [status, headers, body] = r;
    res.writeHead(status, headers).end(body);
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise(ok => server.close(ok)) };
}
const page = (canonical, extra = "") =>
  `<!doctype html><html><head><title>Home</title>${canonical ? `<link rel="canonical" href="${canonical}">` : ""}${extra}</head><body>Hi</body></html>`;

test("deploy-check passes a healthy site and names each blocker on a broken one", async () => {
  const good = {
    "/": [200, { "content-type": "text/html" }, ""],
    "/robots.txt": [200, { "content-type": "text/plain" }, "User-agent: *\nDisallow: /admin\n"],
    "/sitemap.xml": [200, { "content-type": "application/xml" }, "<urlset/>"],
  };
  const s = await site(good);
  try {
    good["/"][2] = page(s.url + "/");
    good["/robots.txt"][2] += `Sitemap: ${s.url}/sitemap.xml\n`;
    const r = await deployCheck(s.url);
    assert.equal(r.blockers, 0, JSON.stringify(r.checks));
    assert.equal(r.warnings, 0, JSON.stringify(r.checks));
    assert.deepEqual(
      r.checks.map(c => c.id),
      ["home", "noindex", "robots", "sitemap", "canonical", "certificate"],
    );
    assert.equal(r.checks.at(-1).state, "skipped", "no certificate on http://");
    good["/"][2] = page(s.url + "/other/", '<meta name="robots" content="noindex, follow">');
    good["/robots.txt"][2] = "User-agent: *\nDisallow: /\n";
    const bad = await deployCheck(s.url);
    const state = Object.fromEntries(bad.checks.map(c => [c.id, c.state]));
    assert.deepEqual(state, {
      home: "ok",
      noindex: "blocker",
      robots: "blocker",
      sitemap: "warning",
      canonical: "warning",
      certificate: "skipped",
    });
    const out = await node([join(SCRIPTS, "deploy-check.mjs"), "--site", s.url, "--json"]).then(
      () => assert.fail("should exit 1"),
      e => e,
    );
    assert.equal(out.code, 1);
    assert.equal(JSON.parse(out.stdout).blockers, 2);
    const text = await node([join(SCRIPTS, "deploy-check.mjs"), "--site", s.url]).catch(e => e);
    assert.match(text.stdout, /BLOCKER +The home page is noindex/);
    assert.match(text.stdout, /BLOCKER +robots\.txt blocks/);
  } finally {
    await s.close();
  }
});

test("deploy-check: a robots.txt server error, a 500 home page, Googlebot's own group, and a header noindex", async () => {
  const routes = { "/": [500, { "content-type": "text/html" }, "oops"], "/robots.txt": [503, {}, ""] };
  const s = await site(routes);
  try {
    let r = await deployCheck(s.url);
    assert.equal(r.checks[0].state, "blocker");
    assert.match(r.checks[0].text, /500/);
    assert.equal(
      r.checks.find(c => c.id === "robots").state,
      "blocker",
      "Google stops crawling while robots.txt fails",
    );
    routes["/"] = [
      200,
      { "content-type": "text/html", "x-robots-tag": "max-image-preview: none, googlebot: noindex" },
      page(s.url + "/"),
    ];
    routes["/robots.txt"] = [
      200,
      { "content-type": "text/plain" },
      "User-agent: *\nAllow: /\n\nUser-agent: Googlebot\nDisallow: /\n",
    ];
    r = await deployCheck(s.url);
    assert.equal(r.checks.find(c => c.id === "noindex").state, "blocker");
    assert.match(r.checks.find(c => c.id === "robots").text, /Googlebot/);
    routes["/"] = [
      200,
      { "content-type": "text/html", "x-robots-tag": "max-image-preview: none, otherbot: noindex" },
      page(s.url + "/"),
    ];
    routes["/robots.txt"] = [404, {}, ""];
    r = await deployCheck(s.url);
    assert.equal(
      r.checks.find(c => c.id === "noindex").state,
      "ok",
      "none as a value, or another crawler's noindex, isn't Google's noindex",
    );
    assert.equal(r.checks.find(c => c.id === "robots").state, "warning");
  } finally {
    await s.close();
  }
});

test("deploy-check never visits a private address off the site, and reads the certificate's days left", async () => {
  const seen = [];
  const fetchFn = async (url, _o) => {
    seen.push(String(url));
    const u = new URL(url);
    if (u.pathname === "/robots.txt")
      return new Response("User-agent: *\nAllow: /\nSitemap: http://10.1.2.3/sitemap.xml\n", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    return new Response(page("https://www.example.com/"), { status: 200, headers: { "content-type": "text/html" } });
  };
  const now = Date.parse("2026-11-22T00:00:00Z"),
    cert = days => async () => ({
      authorized: true,
      authorizationError: null,
      valid_from: "Sep 1 00:00:00 2026 GMT",
      valid_to: new Date(now + days * 864e5).toUTCString(),
      subjectaltname: "DNS:www.example.com",
    });
  let r = await deployCheck("https://www.example.com", { fetchFn, connect: cert(60), now });
  assert.ok(!seen.some(u => u.includes("10.1.2.3")), seen.join(" "));
  assert.equal(r.checks.find(c => c.id === "sitemap").state, "warning");
  assert.match(r.checks.find(c => c.id === "sitemap").text, /isn't a public address/);
  assert.equal(r.checks.find(c => c.id === "certificate").state, "ok");
  assert.match(r.checks.find(c => c.id === "certificate").text, /60 days left/);
  r = await deployCheck("https://www.example.com", { fetchFn, connect: cert(10), now });
  assert.equal(r.checks.find(c => c.id === "certificate").state, "warning");
  r = await deployCheck("https://www.example.com", { fetchFn, connect: cert(1), now });
  assert.equal(r.checks.find(c => c.id === "certificate").state, "blocker");
  r = await deployCheck("https://www.example.com", {
    fetchFn,
    connect: async () => ({
      ...(await cert(60)()),
      authorized: false,
      authorizationError: "SELF_SIGNED_CERT_IN_CHAIN",
    }),
    now,
  });
  assert.equal(r.checks.find(c => c.id === "certificate").state, "blocker");
  const usage = await node([join(SCRIPTS, "deploy-check.mjs"), "--site", "ftp://example.com"]).catch(e => e);
  assert.equal(usage.code, 2);
});

// ---------- findings as GitHub issues ----------
test("an issue is the finding's own text, at most 10 evidence lines, with a marker, and no one gets pinged", () => {
  const f = {
    ...HSTS,
    id: "F-007",
    what: "Ask @alice or mail info@example.com.",
    evidence: Array.from({ length: 12 }, (_, i) => ({
      url: `https://www.example.com/p${i}`,
      detail: i ? "x" : "by @bob `rm`",
    })),
    count: 40,
  };
  const i = issueOf(f, "https://www.example.com");
  assert.equal(i.title, HSTS.title);
  assert.match(i.body, /\*\*What's wrong\.\*\* Ask @​alice or mail info@example\.com\./);
  assert.match(i.body, /\*\*Why it matters\.\*\*/);
  assert.match(i.body, /\*\*How to fix\.\*\*/);
  assert.equal(i.body.match(/^- /gm).length, 10);
  assert.match(i.body, /10 of 40 cases/);
  assert.doesNotMatch(i.body, /(^|[^\w])@bob/);
  assert.match(i.body, /<!-- seo-supervisor:www\.example\.com:F-007 -->/);
});

test("issues: a dry run sends nothing; with --yes it lists once, skips what's filed and creates the rest through the runner", async () => {
  const fs = [
    { ...HSTS, id: "F-001" },
    { ...HSTS, id: "F-002", title: "Second" },
    { ...HSTS, id: "F-003", status: "fixed" },
    { ...HSTS, id: "F-004", status: "wont-fix" },
  ];
  assert.deepEqual(
    pickFindings(fs).picked.map(f => f.id),
    ["F-001", "F-002"],
  );
  assert.deepEqual(pickFindings(fs, ["F-002", "F-009"]), { picked: [fs[1]], unknown: ["F-009"] });
  const list = fs.slice(0, 2).map(f => issueOf(f, "https://www.example.com"));
  const calls = [],
    out = [];
  let r = await fileIssues(list, {
    run: async (...a) => {
      calls.push(a);
      return { code: 0, stdout: "", stderr: "" };
    },
    log: s => out.push(s),
  });
  assert.equal(calls.length, 0, "a dry run never calls gh");
  assert.match(out.join("\n"), /Dry run[\s\S]*Second/);
  const run = async (args, input) => {
    calls.push([args, input]);
    if (args[1] === "list")
      return {
        code: 0,
        stdout: JSON.stringify([
          {
            number: 4,
            url: "https://github.com/o/r/issues/4",
            body: "old\n<!-- seo-supervisor:www.example.com:F-001 -->",
          },
        ]),
        stderr: "",
      };
    return { code: 0, stdout: "https://github.com/o/r/issues/5\n", stderr: "" };
  };
  out.length = 0;
  r = await fileIssues(list, { yes: true, repo: "o/r", run, log: s => out.push(s) });
  assert.deepEqual(
    calls.map(([a]) => a.slice(0, 2)),
    [
      ["issue", "list"],
      ["issue", "create"],
    ],
  );
  assert.ok(calls[0][0].includes("--repo=o/r") && calls[1][0].includes("--repo=o/r"));
  assert.ok(calls[1][0].includes("--title=Second") && calls[1][0].includes("--body-file") && calls[1][0].includes("-"));
  assert.equal(calls[1][1], list[1].body, "the body goes through stdin, never the command line");
  assert.deepEqual(r, { created: 1, skipped: 1, failed: 0 });
  assert.match(out.join("\n"), /F-001.*already filed.*issues\/4/);
  out.length = 0;
  r = await fileIssues(list, {
    yes: true,
    run: async () => ({
      code: 1,
      stdout: "",
      stderr: "HTTP 401: Bad credentials (token ghp_abcdefghijklmnopqrstuvwxyz0123456789)",
    }),
    log: s => out.push(s),
  });
  assert.deepEqual(r, { created: 0, skipped: 0, failed: 2 }, "nothing is filed when gh can't list the issues");
  assert.doesNotMatch(out.join("\n"), /ghp_abcdefghij/, "a token in gh's message is never printed");
  await assert.rejects(fileIssues(list, { yes: true, repo: "--evil", run }), /owner\/name/);
});

test("issues.mjs on the command line is a dry run by default and never needs gh for it", async () => {
  const dir = join(tmp(), "seo-audit"),
    file = join(dir, "seo-audit.json");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      site: { url: "https://www.example.com" },
      findings: [HSTS, { ...HSTS, id: "C-009", check: "title-long", title: "Long titles" }],
    }),
  );
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ checks: { off: ["title-long"] } }));
  const { stdout } = await node([join(SCRIPTS, "issues.mjs"), "--audit", file]);
  assert.match(stdout, /Dry run/);
  assert.match(stdout, /Strict-Transport-Security/);
  assert.doesNotMatch(stdout, /Long titles/, "a check turned off in the settings isn't filed");
});
