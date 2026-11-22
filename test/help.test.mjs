// @ts-check
// --help and -h on every hand-run script: usage on stdout, exit 0, and no crawl, dashboard or npm request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { SCRIPTS, node, tmp } from "./helpers.mjs";

const SCRIPT_NAMES = [
  "seo-crawl.mjs",
  "dashboard.mjs",
  "seo-diff.mjs",
  "og-card.mjs",
  "doctor.mjs",
  "update-check.mjs",
];
const help = (script, args = ["--help"], opts = {}) => node([join(SCRIPTS, script), ...args], opts).then(r => r.stdout);

// A registry that counts what it's asked and answers with a newer version.
async function registry(t) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(req.url);
    res.setHeader("content-type", "application/json");
    res.end('{"version":"99.0.0"}');
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", () => ok(undefined)));
  t.after(() => new Promise(ok => server.close(ok)));
  return { hits, url: `http://127.0.0.1:${/** @type {any} */ (server.address()).port}` };
}

test("each script answers --help and -h with its usage on stdout and exit 0", async t => {
  const reg = await registry(t),
    home = tmp(),
    cwd = tmp();
  const env = { ...process.env, SEO_SUPERVISOR_HOME: home, SEO_SUPERVISOR_REGISTRY: reg.url, CI: "" };
  for (const script of SCRIPT_NAMES)
    for (const flag of ["--help", "-h"]) {
      const out = await help(script, [flag], { env, cwd }); // rejects on any exit code but 0
      assert.match(out, new RegExp(`^usage: node ${script.replace(".", "\\.")}`, "i"), `${script} ${flag}`);
      for (const line of out.split("\n")) assert.ok(line.length <= 100, `${script}: fits a terminal: ${line}`);
    }
  assert.deepEqual(reg.hits, [], "update-check --help asks npm nothing");
  assert.deepEqual(readdirSync(home), [], "and saves nothing");
  assert.deepEqual(readdirSync(cwd), [], "no script wrote anything");
});

test("dashboard --help shows the usage and runs nothing: no lines, no page", async () => {
  const cwd = tmp(),
    page = join(cwd, "dashboard.html");
  const out = await help("dashboard.mjs", ["seo-audit", "--out", page, "--help"], { cwd });
  assert.doesNotMatch(out, /no seo-audit\.json|Wrote/, "the dashboard didn't run");
  assert.deepEqual(readdirSync(cwd), [], "and wrote no file");
});

test("the crawler's help names every option the parser accepts, each on its own line, and nothing else", async () => {
  const src = readFileSync(join(SCRIPTS, "seo-crawl.mjs"), "utf8");
  const accepted = [...src.matchAll(/^const (?:FLAGS|BOOLEANS) = \[([^\]]*)\]/gm)].flatMap(m =>
    [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]),
  );
  assert.ok(accepted.length >= 29, `found the parser's lists (${accepted.length} options)`);
  const out = await help("seo-crawl.mjs");
  for (const name of accepted)
    assert.match(out, new RegExp(`^ {2}--${name}(?![\\w-])`, "m"), `--${name} has its own line`);
  const listed = [...out.matchAll(/^ {2}--([\w-]+)/gm)].map(m => m[1]);
  assert.deepEqual(
    listed.filter(n => n !== "help" && !accepted.includes(n)),
    [],
    "every option in the help is one the parser accepts",
  );
  for (const group of ["Basics", "Scope", "Outside checks", "Data inputs", "Output"])
    assert.match(out, new RegExp(`^${group}`, "m"), group);
});

test("the scripts on the shared parser stop on a misspelt option with exit 2", async () => {
  for (const script of ["dashboard.mjs", "seo-diff.mjs", "og-card.mjs", "doctor.mjs"]) {
    await assert.rejects(
      node([join(SCRIPTS, script), "--hepl"], { cwd: tmp() }),
      e => e.code === 2 && /unknown option --hepl/.test(e.stderr),
      script,
    );
  }
});

test("update-check's weekly check still prints its one line and exits 0, whatever else is on the line", async t => {
  const reg = await registry(t);
  for (const args of [[], ["--quiet"], ["extra", "words"]]) {
    const out = await help("update-check.mjs", args, {
      env: {
        ...process.env,
        SEO_SUPERVISOR_HOME: tmp(),
        SEO_SUPERVISOR_REGISTRY: reg.url,
        SEO_SUPERVISOR_NO_UPDATE_CHECK: "",
        CI: "",
      },
    });
    assert.match(out, /^SEO Supervisor 99\.0\.0 is out/, args.join(" ") || "no words");
  }
});
