import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION, isNewer } from "../skills/seo-supervisor/scripts/update-check.mjs";
import { ROOT, SCRIPTS, node, tmp } from "./helpers.mjs";

const CHECK = join(SCRIPTS, "update-check.mjs");
// A stand-in for https://registry.npmjs.org/seo-supervisor/latest.
async function fakeRegistry(latest) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(req.url);
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ name: "seo-supervisor", version: latest }));
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise(ok => server.close(ok)) };
}
const env = (home, registry, extra = {}) => {
  const e = { ...process.env, HOME: home, USERPROFILE: home, SEO_SUPERVISOR_REGISTRY: registry, ...extra };
  delete e.CI;
  delete e.SEO_SUPERVISOR_NO_UPDATE_CHECK;
  return { ...e, ...extra };
};
const run = async (args, e) => (await node([CHECK, ...args], { env: e })).stdout.trim();

test("the version the skill reports matches the package, the plugin and the crawler", () => {
  assert.equal(VERSION, JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version);
  assert.equal(VERSION, JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "plugin.json"), "utf8")).version);
  assert.match(
    readFileSync(join(SCRIPTS, "seo-crawl.mjs"), "utf8"),
    new RegExp(`const VERSION = "${VERSION.replace(/\./g, "\\.")}"`),
  );
});

test("versions compare by number, not as text", () => {
  assert.ok(isNewer("2.10.0", "2.9.9"));
  assert.ok(isNewer("3.0.0", "2.99.0"));
  assert.ok(!isNewer("2.0.0", "2.0.0"));
  assert.ok(!isNewer("2.0.0-beta.1", "2.0.0"), "a pre-release isn't newer than the release");
  assert.ok(!isNewer("garbage", "2.0.0"));
});

test("a newer version on npm gives one line saying how to update; the same version says nothing", async () => {
  const reg = await fakeRegistry("99.0.0"),
    home = tmp();
  try {
    const out = await run([], env(home, reg.url));
    assert.match(out, /SEO Supervisor 99\.0\.0 is out \(you have \d+\.\d+\.\d+\)/);
    assert.match(out, /npx seo-supervisor@latest/);
    assert.match(out, /update-check\.mjs off/);
    assert.equal(reg.hits[0], "/seo-supervisor/latest");
  } finally {
    await reg.close();
  }
  const same = await fakeRegistry(VERSION),
    home2 = tmp();
  try {
    assert.equal(await run([], env(home2, same.url)), "");
  } finally {
    await same.close();
  }
});

test("npm is asked at most once a week; the answer is remembered", async () => {
  const reg = await fakeRegistry("99.0.0"),
    home = tmp();
  try {
    await run([], env(home, reg.url));
    const second = await run([], env(home, reg.url));
    assert.equal(reg.hits.length, 1, "the second run within a week uses the remembered answer");
    assert.match(second, /99\.0\.0 is out/, "and still mentions the update");
    const cache = join(home, ".seo-supervisor", "update-check.json");
    const c = JSON.parse(readFileSync(cache, "utf8"));
    writeFileSync(cache, JSON.stringify({ ...c, checkedAt: new Date(Date.now() - 8 * 864e5).toISOString() }));
    await run([], env(home, reg.url));
    assert.equal(reg.hits.length, 2, "after a week it asks again");
  } finally {
    await reg.close();
  }
});

test("turned off, in CI, or offline, it sends nothing and says nothing", async () => {
  const reg = await fakeRegistry("99.0.0");
  try {
    const home = tmp();
    assert.match(await run(["off"], env(home, reg.url)), /turned off/i);
    assert.equal(await run([], env(home, reg.url)), "");
    assert.equal(reg.hits.length, 0, "off sends nothing");
    assert.match(await run(["on"], env(home, reg.url)), /turned on/i);
    assert.equal(await run([], env(tmp(), reg.url, { SEO_SUPERVISOR_NO_UPDATE_CHECK: "1" })), "");
    assert.equal(await run([], env(tmp(), reg.url, { CI: "true" })), "");
    assert.equal(reg.hits.length, 0, "the environment switch and CI send nothing");
  } finally {
    await reg.close();
  }
  assert.equal(await run([], env(tmp(), "http://127.0.0.1:9")), "", "no network: silent, exit 0");
});
