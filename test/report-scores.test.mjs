import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { ROOT, SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";
import { buildRules, normalise, score } from "../skills/seo-supervisor/scripts/lib/score.mjs";
import { loginDir, settingsDir, toolsDir } from "../skills/seo-supervisor/scripts/lib/settings-dir.mjs";
import { findBrowser } from "../skills/seo-supervisor/scripts/checks/render.mjs";

const SAMPLE = join(SKILL, "examples", "sample-audit.json");
const BIN = join(ROOT, "bin", "seo-supervisor.mjs");
const RENDER = join(SCRIPTS, "render-report.mjs");
// A clean environment: nothing of the real user's settings can leak into a test.
const env = (home, extra = {}) => {
  const e = { ...process.env, HOME: home, USERPROFILE: home, ...extra };
  for (const k of [
    "SEO_SUPERVISOR_HOME",
    "SEO_SUPERVISOR_CLIENT",
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "XDG_CONFIG_HOME",
    "APPDATA",
    "GROK_HOME",
  ])
    if (!(k in extra)) delete e[k];
  return e;
};
const filesIn = dir => (existsSync(dir) ? readdirSync(dir, { recursive: true }).sort() : []);

// Two pages with open findings; a sitemap, another site's page and a fixed finding never get a page score.
const PAGES_AUDIT = {
  site: { name: "Page <Test>", url: "https://p.example" },
  run: { mode: "audit", date: "2026-11-20" },
  findings: [
    {
      id: "F-001",
      rule: "META-01",
      severity: "high",
      category: "Metadata",
      title: "Titles too long",
      evidence: [
        { url: "https://p.example/a/", detail: "x" },
        { url: "https://www.p.example/b/?x=1&y=2", detail: "x" },
      ],
    },
    {
      id: "F-002",
      rule: "CRAWL-05",
      severity: "blocker",
      category: "Crawl",
      title: "Server error",
      evidence: [{ url: "https://p.example/a/", detail: "500" }],
    },
    {
      id: "F-003",
      rule: "MAP-01",
      severity: "low",
      category: "Sitemaps",
      title: "Sitemap lastmod",
      evidence: [{ url: "https://p.example/sitemap.xml", detail: "x" }],
    },
    {
      id: "F-004",
      rule: "CRAWL-07",
      severity: "medium",
      category: "Crawl",
      title: "Broken outbound link",
      evidence: [{ url: "https://other.example/gone", detail: "404" }],
    },
    {
      id: "F-005",
      rule: "META-02",
      severity: "medium",
      category: "Metadata",
      status: "fixed",
      title: "Descriptions",
      evidence: [{ url: "https://p.example/c/", detail: "x" }],
    },
  ],
  passed: ["URL-01", "URL-02", "URL-03", "URL-04", "URL-05"].map(rule => ({
    rule,
    title: rule,
    category: "URLs & canonicals",
  })),
};
const renderAudit = async (data, extra = []) => {
  const dir = tmp();
  writeFileSync(join(dir, "seo-audit.json"), JSON.stringify(data));
  const r = await node([RENDER, join(dir, "seo-audit.json"), ...extra]);
  return {
    dir,
    stdout: r.stdout,
    html: readFileSync(join(dir, "seo-audit.html"), "utf8"),
    md: readFileSync(join(dir, "seo-audit.md"), "utf8"),
  };
};

// ---------- the score model, shared ----------
test("the shared score model gives the sample the report's numbers: 49 now, 90 once both blockers are fixed", () => {
  const data = JSON.parse(readFileSync(SAMPLE, "utf8")),
    findings = normalise(data.findings);
  assert.equal(score(buildRules(findings, data.passed)).value, 49);
  assert.equal(score(buildRules(findings, data.passed, { assume: f => f.severity === "blocker" })).value, 90);
  assert.equal(score([]), null, "no checked rules, no score");
});

// ---------- the score explanation and the receipt ----------
test("How this score works says the score is SEO Supervisor's own, not Google's, in the HTML and the Markdown", async () => {
  const { html, md } = await renderAudit(JSON.parse(readFileSync(SAMPLE, "utf8")));
  assert.match(html, /How this score works<\/summary>\s*<p>[^<]*SEO Supervisor's own score, not Google's/);
  assert.match(md, /## How the score works\n\n[^\n]*SEO Supervisor's own score, not Google's/);
});

test("the renderer ends with a receipt: the score and band, what fixing the blockers unlocks, the counts and the files", async () => {
  const { stdout } = await renderAudit(JSON.parse(readFileSync(SAMPLE, "utf8")));
  assert.match(stdout, /SEO health score: 49\/100 \(Poor\)\. Not ready: 2 blockers to fix first/);
  assert.match(stdout, /Fixing the 2 blockers raises it to 90\/100 \(Excellent\)/);
  assert.match(stdout, /Open: \d+ \(2 blocker, /);
  assert.match(stdout, /Wrote: .*seo-audit\.html, .*seo-audit\.md/);
});

// ---------- page scores ----------
test("each page with open findings gets its own score from the same model, labelled ours, and the site score doesn't move", async () => {
  const { html, md } = await renderAudit(PAGES_AUDIT);
  assert.match(html, /<span class="n">59<\/span>/, "site: 77 before the blocker cap of 59");
  const panel = html.match(/<details class="how pagescores">[\s\S]*?<\/details>/)?.[0];
  assert.ok(panel, "a collapsed Page scores panel");
  assert.match(panel, /Page scores/);
  assert.match(panel, /SEO Supervisor's own score, not Google's/);
  assert.match(panel, /<code>\/a\/<\/code><\/td><td>59<\/td>/, "/a/ has the blocker, so the cap applies");
  assert.match(
    panel,
    /<code>\/b\/\?x=1&amp;y=2<\/code><\/td><td>93<\/td>/,
    "/b/ (www. is the same site) has one high finding: 93, escaped",
  );
  assert.ok(panel.indexOf("/a/") < panel.indexOf("/b/"), "lowest score first");
  assert.match(panel, /href="#F-002"/, "the findings are linked");
  for (const not of ["sitemap.xml", "other.example", "/c/"])
    assert.ok(!panel.includes(not), `${not} has no page score`);

  assert.match(md, /## Page scores\n/);
  assert.match(md, /\| `\/a\/` \| 59\/100 \| F-002, F-001 \|/);
  assert.match(md, /\| `\/b\/\?x=1&y=2` \| 93\/100 \| F-001 \|/);
});

test("an audit with no page in its evidence gets no Page scores panel", async () => {
  const data = { ...PAGES_AUDIT, findings: PAGES_AUDIT.findings.slice(2, 4) };
  const { html, md } = await renderAudit(data);
  assert.doesNotMatch(html, /class="how pagescores"/);
  assert.doesNotMatch(md, /## Page scores/);
});

const browser = findBrowser();
test(
  "--pdf prints the report to a PDF with the installed Chrome or Edge",
  { skip: !browser && "no Chrome or Edge here", timeout: 180000 },
  async () => {
    const { dir, stdout } = await renderAudit(JSON.parse(readFileSync(SAMPLE, "utf8")), ["--pdf"]);
    const pdf = join(dir, "seo-audit.pdf");
    assert.ok(existsSync(pdf), stdout);
    assert.equal(readFileSync(pdf).subarray(0, 5).toString(), "%PDF-");
    assert.ok(statSync(pdf).size > 20000, "more than an empty page");
    assert.match(stdout, /seo-audit\.pdf/);
  },
);

// ---------- the dashboard ----------
test("the dashboard lists several audits, lowest score first, as lines and as one offline HTML page", async () => {
  const root = tmp(),
    a = join(root, "client-a", "seo-audit"),
    b = join(root, "client-b", "seo-audit");
  mkdirSync(a, { recursive: true });
  mkdirSync(b, { recursive: true });
  writeFileSync(
    join(a, "seo-audit.json"),
    JSON.stringify({
      ...PAGES_AUDIT,
      diff: { since: "2026-10-01", regressions: [{ path: "/a/", kind: "title-changed" }] },
    }),
  );
  writeFileSync(join(b, "seo-audit.json"), readFileSync(SAMPLE));
  writeFileSync(join(a, "seo-audit.html"), "<!doctype html>"); // b's report isn't rendered yet
  const out = join(root, "dashboard.html");
  const { stdout } = await node([
    join(SCRIPTS, "dashboard.mjs"),
    join(root, "client-a"),
    b,
    join(root, "nothing-here"),
    "--out",
    out,
  ]);
  const lines = stdout.trim().split("\n");
  assert.match(lines[0], /Example Security.*49\/100 \(Poor\).*2 blockers/);
  assert.match(lines[1], /Page <Test>.*59\/100 \(Poor\).*1 blocker/);
  assert.match(stdout, /nothing-here: no seo-audit\.json/);

  const html = readFileSync(out, "utf8");
  assert.match(html, /Page &lt;Test&gt;/, "names are escaped");
  assert.ok(html.indexOf("Example Security") < html.indexOf("Page &lt;Test&gt;"), "lowest score first");
  assert.match(html, /href="client-a\/seo-audit\/seo-audit\.html"/, "links to each report, relative to the dashboard");
  assert.match(html, /Not rendered yet/, "no link to a report that isn't there");
  assert.match(html, /1 regression/);
  assert.match(html, /SEO Supervisor's own score, not Google's/);
  assert.doesNotMatch(
    html,
    /<script[^>]+src=|<link[^>]+href="https?:|url\(https?:/i,
    "nothing fetched: one offline file",
  );
});

// ---------- the settings folder ----------
test("the settings folder is ~/.seo-supervisor, or SEO_SUPERVISOR_HOME; a client gets its own logins folder inside it", () => {
  const home = tmp(),
    moved = tmp();
  assert.equal(settingsDir({}, home), join(home, ".seo-supervisor"));
  assert.equal(settingsDir({ SEO_SUPERVISOR_HOME: moved }, home), moved);
  assert.equal(toolsDir({ SEO_SUPERVISOR_HOME: moved }, home), join(moved, "tools"), "the add-ons move with it");
  assert.equal(
    loginDir({ SEO_SUPERVISOR_CLIENT: "acme-co" }, home),
    join(home, ".seo-supervisor", "clients", "acme-co"),
  );
  assert.equal(loginDir({}, home), join(home, ".seo-supervisor"));
  for (const bad of ["../x", "a/b", "a\\b", ".", ""])
    if (bad) assert.throws(() => loginDir({ SEO_SUPERVISOR_CLIENT: bad }, home), /SEO_SUPERVISOR_CLIENT/, bad);
});

test("google.mjs, connect-keys.mjs and update-check.mjs use the chosen settings folder and the client's own folder", async () => {
  const home = tmp(),
    moved = tmp(),
    client = join(moved, "clients", "acme");
  mkdirSync(client, { recursive: true });
  writeFileSync(
    join(client, "google.json"),
    JSON.stringify({
      method: "own-client",
      client: { id: "own-id" },
      access_token: "SECRET-AT",
      refresh_token: "SECRET-RT",
      expires_at: Date.now() + 3600e3,
      scope: "",
      connected_at: "2026-11-01T10:00:00Z",
    }),
  );
  const e = env(home, {
    SEO_SUPERVISOR_HOME: moved,
    SEO_SUPERVISOR_CLIENT: "acme",
    SEO_GOOGLE_SEARCH_CONSOLE_URL: "http://127.0.0.1:9/webmasters/v3",
  });
  const g = await node([join(SCRIPTS, "google.mjs"), "status"], { env: e });
  assert.match(g.stdout, new RegExp(`Saved in: ${join(client, "google.json").replace(/[\\.]/g, "\\$&")}`));

  await node([join(SCRIPTS, "update-check.mjs"), "off"], { env: e });
  assert.equal(
    JSON.parse(readFileSync(join(moved, "settings.json"), "utf8")).updateCheck,
    false,
    "update settings stay in the shared folder",
  );
  assert.ok(!existsSync(join(home, ".seo-supervisor")), "nothing in the default folder");

  const k = await node([join(SCRIPTS, "connect-keys.mjs"), "set", "bing", "a-bing-key"], {
    env: e,
    timeout: 20000,
  }).catch(err => err);
  assert.ok(existsSync(join(client, "keys.json")), `keys go in the client's folder: ${k.stdout}${k.stderr}`);
});

// ---------- doctor and the npx commands ----------
test("doctor checks Node, the browser, the add-ons, the settings folder, the connections and write access, and changes nothing", async () => {
  const home = tmp(),
    cwd = tmp(),
    dir = join(home, ".seo-supervisor");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "google.json"),
    JSON.stringify({
      method: "shared",
      client: { id: "x" },
      access_token: "SECRET-AT",
      refresh_token: "SECRET-RT",
      connected_at: "2026-11-01T10:00:00Z",
    }),
  );
  writeFileSync(join(dir, "keys.json"), JSON.stringify({ bing: "SECRET-BING" }));
  const before = filesIn(home);
  const r = await node([join(SCRIPTS, "doctor.mjs")], { env: env(home, { PSI_API_KEY: "SECRET-PSI" }), cwd });
  for (const re of [
    /Node \d+\.\d+/,
    /Chrome or Edge/,
    /Lighthouse/,
    /Image add-on/,
    /Settings folder: .*\.seo-supervisor/,
    /Google: connected with SEO Supervisor's shared sign-in on 2026-11-01/,
    /Bing Webmaster Tools/,
    /PSI_API_KEY/,
    /write/i,
  ])
    assert.match(r.stdout, re);
  assert.doesNotMatch(r.stdout, /SECRET/, "never a key or token");
  assert.deepEqual(filesIn(home), before, "read-only");
  assert.deepEqual(filesIn(cwd), [], "read-only");
});

test("doctor says when nothing is connected yet and the settings folder doesn't exist", async () => {
  const home = tmp();
  const r = await node([join(SCRIPTS, "doctor.mjs")], { env: env(home), cwd: home });
  assert.match(r.stdout, /Settings folder: .* \(not made yet/);
  assert.match(r.stdout, /Google: not connected/);
  assert.ok(!existsSync(join(home, ".seo-supervisor")));
});

test("npx seo-supervisor doctor and dashboard run the skill's scripts, with no agent", async () => {
  const home = tmp();
  const d = await node([BIN, "doctor"], { env: env(home), cwd: home });
  assert.match(d.stdout, /Node \d+/);
  const a = join(home, "seo-audit");
  mkdirSync(a);
  writeFileSync(join(a, "seo-audit.json"), readFileSync(SAMPLE));
  const s = await node([BIN, "dashboard"], { env: env(home), cwd: home });
  assert.match(s.stdout, /Example Security.*49\/100/, "with no folder named, the current folder's seo-audit");
});

// ---------- --with-browser ----------
// A stand-in for npm: records its arguments, prints what @puppeteer/browsers prints, and exits with the given code.
function fakeNpm(exit = 0, print = "") {
  const dir = tmp(),
    bin = join(dir, "npm.mjs"),
    log = join(dir, "args.json");
  writeFileSync(
    bin,
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));\nconsole.log(${JSON.stringify(print)});\nprocess.exit(${exit});\n`,
  );
  return { bin, args: () => (existsSync(log) ? JSON.parse(readFileSync(log, "utf8")) : null) };
}
test("--with-browser installs Chrome for Testing into the tools folder and records where it is", async () => {
  const home = tmp(),
    exe = join(home, "chrome-bin", "chrome");
  const npm = fakeNpm(0, `chrome@131.0.6778.85 ${exe}`);
  const r = await node([BIN, "--agent", "cursor", "--with-browser"], {
    env: env(home, { SEO_SUPERVISOR_NPM: npm.bin }),
    cwd: home,
  });
  const tools = join(home, ".seo-supervisor", "tools");
  const args = npm.args();
  assert.deepEqual(args.slice(0, 8), [
    "exec",
    "--yes",
    "--",
    "@puppeteer/browsers@3",
    "install",
    "chrome@stable",
    "--path",
    join(tools, "browsers"),
  ]);
  assert.equal(
    args.includes("--install-deps"),
    process.platform === "linux" && process.getuid?.() === 0,
    "system libraries only as root on Linux",
  );
  assert.equal(readFileSync(join(tools, "chrome-path.txt"), "utf8").trim(), exe);
  assert.match(r.stdout, /Chrome for Testing/);
  assert.ok(existsSync(join(home, ".cursor", "skills", "seo-supervisor", "SKILL.md")), "the skill is installed too");

  const failed = fakeNpm(1);
  const f = await node([BIN, "--agent", "cursor", "--with-browser"], {
    env: env(tmp(), { SEO_SUPERVISOR_NPM: failed.bin }),
    cwd: home,
  });
  assert.match(f.stdout + f.stderr, /browser wasn't installed.*works without it/i);
  assert.match(f.stdout, /installed for Cursor/, "a failed add-on never fails the install");
});

// ---------- --zip ----------
// Reads a ZIP's central directory and inflates every entry (deflate or stored).
function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50, "central directory entry");
    const method = buf.readUInt16LE(at + 10),
      packed = buf.readUInt32LE(at + 20),
      nameLen = buf.readUInt16LE(at + 28),
      extra = buf.readUInt16LE(at + 30),
      comment = buf.readUInt16LE(at + 32),
      local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    assert.equal(buf.readUInt32LE(local), 0x04034b50, "local header");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body =
      method === 8 ? inflateRawSync(buf.subarray(start, start + packed)) : buf.subarray(start, start + packed);
    assert.equal(body.length, buf.readUInt32LE(at + 24), `${name}: size`);
    out.set(name, body);
    at += 46 + nameLen + extra + comment;
  }
  return out;
}
test("--zip packs the skill for upload to claude.ai or the Claude app, with the folder at the zip's root, and installs nothing", async () => {
  const home = tmp(),
    zip = join(home, "out", "seo-supervisor.zip");
  const r = await node([BIN, "--zip", zip], { env: env(home), cwd: home });
  const entries = readZip(readFileSync(zip));
  assert.ok(
    [...entries.keys()].every(n => n.startsWith("seo-supervisor/")),
    "one folder at the root, named like the skill",
  );
  assert.deepEqual(entries.get("seo-supervisor/SKILL.md"), readFileSync(join(SKILL, "SKILL.md")));
  const want = filesIn(SKILL)
    .filter(f => statSync(join(SKILL, f)).isFile())
    .map(f => "seo-supervisor/" + f.replace(/\\/g, "/"))
    .sort();
  assert.deepEqual([...entries.keys()].sort(), want, "every file");
  assert.match(r.stdout, /Customize → Skills/);
  assert.match(r.stdout, /code execution/i);
  assert.ok(!existsSync(join(home, ".claude")), "no agent install");
});

// ---------- connect --paste ----------
async function fakeToken() {
  const hits = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", c => {
      raw += c;
    });
    req.on("end", () => {
      hits.push(Object.fromEntries(new URLSearchParams(raw)));
      res
        .writeHead(200, { "content-type": "application/json", connection: "close" })
        .end(
          JSON.stringify({
            access_token: "at1",
            refresh_token: "rt1",
            expires_in: 3599,
            scope: "https://www.googleapis.com/auth/webmasters.readonly",
          }),
        );
    });
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    hits,
    env: { SEO_GOOGLE_AUTH_URL: base + "/auth", SEO_GOOGLE_TOKEN_URL: base + "/token" },
    close: () =>
      new Promise(c => {
        server.closeAllConnections();
        server.close(c);
      }),
  };
}
function pasteConnect(g, home, answer) {
  const client = join(tmp(), "client_secret.json");
  writeFileSync(
    client,
    JSON.stringify({ installed: { client_id: "own-id.apps.googleusercontent.com", client_secret: "own-secret" } }),
  );
  const child = spawn(
    process.execPath,
    [join(SCRIPTS, "google.mjs"), "connect", "--client-file", client, "--paste", "--no-browser"],
    { env: env(home, g.env) },
  );
  let out = "",
    err = "",
    sent = false;
  child.stderr.on("data", d => {
    err += d;
  });
  child.stdout.on("data", d => {
    out += d;
    const m = out.match(/http:\/\/127\.0\.0\.1:\d+\/auth\?\S+/);
    if (m && !sent && /paste it here/.test(out)) {
      sent = true;
      child.stdin.write(answer(Object.fromEntries(new URL(m[0]).searchParams)) + "\n");
    }
  });
  return new Promise(ok => child.on("exit", code => ok({ code, out, err })));
}
test(
  "connect --paste signs in from another machine: the owner pastes the address the browser ended on",
  { timeout: 30000 },
  async () => {
    const g = await fakeToken(),
      home = tmp();
    try {
      const r = await pasteConnect(
        g,
        home,
        q => `  ${q.redirect_uri}/?state=${encodeURIComponent(q.state)}&code=pasted-code&scope=x  `,
      );
      assert.equal(r.code, 0, r.out + r.err);
      assert.match(r.out, /any computer/);
      assert.equal(g.hits[0].code, "pasted-code");
      assert.match(g.hits[0].redirect_uri, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.ok(g.hits[0].code_verifier, "PKCE still applies");
      assert.ok(existsSync(join(home, ".seo-supervisor", "google.json")));
    } finally {
      await g.close();
    }
  },
);

test(
  "connect --paste refuses an address from another sign-in, or no address, and saves nothing",
  { timeout: 30000 },
  async () => {
    const g = await fakeToken(),
      home = tmp();
    try {
      const wrong = await pasteConnect(g, home, q => `${q.redirect_uri}/?state=not-it&code=evil`);
      assert.equal(wrong.code, 2);
      assert.match(wrong.err, /doesn't match/);
      const junk = await pasteConnect(g, home, () => "hello");
      assert.equal(junk.code, 2);
      assert.match(junk.err, /starts with http:\/\/127\.0\.0\.1/);
      assert.equal(g.hits.length, 0, "nothing was sent to Google");
      assert.ok(!existsSync(join(home, ".seo-supervisor", "google.json")));
    } finally {
      await g.close();
    }
  },
);

// ---------- printing, page matching, image counts and Markdown headings ----------
test("printing (and --pdf) shows the score's explanation and every collapsed panel, opened", async () => {
  const { html } = await renderAudit(JSON.parse(readFileSync(SAMPLE, "utf8")));
  const print = html.match(/@media print\{([\s\S]*?)\}\}/)?.[1] || "";
  assert.ok(print, "there is a print style");
  assert.doesNotMatch(
    print.match(/^[^{]*\{[^}]*\}([^{]*)\{display:none\}/)?.[1] || "",
    /\.how\b/,
    "the .how panels aren't hidden in print",
  );
  assert.match(html, /beforeprint[\s\S]{0,200}details/, "every <details> is opened before printing");
});

test("page scores match pages by path, so a local crawl's evidence still counts", async () => {
  const data = JSON.parse(readFileSync(SAMPLE, "utf8"));
  const local = JSON.parse(JSON.stringify(data).split(new URL(data.site.url).origin).join("http://localhost:3000"));
  local.site.url = data.site.url;
  const { html } = await renderAudit(local);
  assert.match(html, /Page scores/, "the panel shows for a local crawl too");
});
