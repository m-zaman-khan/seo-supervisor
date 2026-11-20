import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { proxyNote, chromeProxyArgs } from "../skills/seo-supervisor/scripts/lib/proxy.mjs";
import { SCRIPTS } from "./helpers.mjs";

const P = "http://proxy.corp:8080",
  NOW = { execArgv: [], version: "24.12.0" };
// This machine's own proxy settings left out (Windows reads variable names in any case).
const envWith = extra => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^(https?_proxy|no_proxy|node_use_env_proxy|node_options)$/i.test(k)),
  ),
  ...extra,
});

test("a proxy variable without the Node flag prints one plain note; Chrome gets --proxy-server", () => {
  assert.equal(proxyNote({}, NOW), null, "no proxy, no note");
  const note = proxyNote({ HTTPS_PROXY: P }, NOW);
  assert.match(note, /NODE_USE_ENV_PROXY=1/);
  assert.match(note, /--use-env-proxy/);
  assert.equal(proxyNote({ HTTPS_PROXY: P, NODE_USE_ENV_PROXY: "1" }, NOW), null);
  assert.equal(proxyNote({ http_proxy: P }, { ...NOW, execArgv: ["--use-env-proxy"] }), null);
  assert.equal(proxyNote({ HTTP_PROXY: P, NODE_OPTIONS: "--max-old-space-size=4096 --use-env-proxy" }, NOW), null);
  assert.match(
    proxyNote({ HTTPS_PROXY: P, NODE_USE_ENV_PROXY: "1" }, { ...NOW, version: "22.12.0" }),
    /Node 22\.12\.0 can't .*22\.21 or 24\.0/,
    "too old for the flag",
  );
  assert.match(
    proxyNote({ HTTPS_PROXY: P, NODE_USE_ENV_PROXY: "1" }, { ...NOW, version: "23.11.0" }),
    /Node 23\.11\.0 can't/,
    "23 never had it",
  );
  // NODE_USE_ENV_PROXY=1 covers fetch() from 24.0 and 22.21; --use-env-proxy only from 24.5 and 22.21.
  // https://nodejs.org/api/cli.html
  for (const version of ["24.0.0", "24.4.1", "22.21.0"])
    assert.equal(proxyNote({ HTTPS_PROXY: P, NODE_USE_ENV_PROXY: "1" }, { ...NOW, version }), null, version);
  const early = proxyNote({ HTTPS_PROXY: P }, { ...NOW, version: "24.4.1" });
  assert.match(early, /NODE_USE_ENV_PROXY=1/);
  assert.doesNotMatch(early, /can't|--use-env-proxy/, "24.4 can, but has no --use-env-proxy flag yet");

  assert.deepEqual(chromeProxyArgs({}), []);
  assert.deepEqual(
    chromeProxyArgs({ HTTPS_PROXY: P, HTTP_PROXY: P, NO_PROXY: "localhost, .corp.example,10.0.0.0/8" }),
    ["--proxy-server=http://proxy.corp:8080", "--proxy-bypass-list=localhost;.corp.example;10.0.0.0/8"],
  );
  assert.deepEqual(
    chromeProxyArgs({ https_proxy: "http://user:secret@proxy.corp:8080/" }),
    ["--proxy-server=https=http://proxy.corp:8080"],
    "only https goes through it, and no password on Chrome's command line",
  );
  assert.deepEqual(chromeProxyArgs({ HTTP_PROXY: P, HTTPS_PROXY: "http://secure.corp:3128" }), [
    "--proxy-server=http=http://proxy.corp:8080;https=http://secure.corp:3128",
  ]);
  assert.deepEqual(chromeProxyArgs({ HTTPS_PROXY: P, NO_PROXY: "*" }), [], "everything bypasses the proxy");

  // Every script that calls fetch(). schema-check notes it only when given a URL (its hook and file runs stay silent);
  // the one here is refused offline.
  const ARGS = { "schema-check.mjs": ["https://example.com/"] };
  for (const script of [
    "seo-crawl.mjs",
    "google.mjs",
    "connect-keys.mjs",
    "google-updates.mjs",
    "indexnow.mjs",
    "schema-check.mjs",
  ]) {
    const run = env =>
      spawnSync(process.execPath, [join(SCRIPTS, script), ...(ARGS[script] || [])], {
        env: envWith(env),
        encoding: "utf8",
      });
    const r = run({ HTTPS_PROXY: P });
    assert.equal(r.stderr.match(/A proxy is set/g)?.length, 1, `${script} prints it once: ${r.stderr}`);
    assert.doesNotMatch(
      run({ HTTPS_PROXY: P, NODE_USE_ENV_PROXY: "1" }).stderr,
      /A proxy is set/,
      `${script} with the flag`,
    );
  }
  assert.doesNotMatch(
    spawnSync(process.execPath, [join(SCRIPTS, "schema-check.mjs"), "--quiet", join(SCRIPTS, "..", "examples")], {
      env: envWith({ HTTPS_PROXY: P }),
      encoding: "utf8",
    }).stderr,
    /A proxy is set/,
    "schema-check on files fetches nothing",
  );
});

test("a proxy password never reaches Chrome's command line, with or without a scheme", () => {
  assert.deepEqual(
    chromeProxyArgs({ HTTP_PROXY: "user:secret@proxy.corp:8080" }),
    ["--proxy-server=http=http://proxy.corp:8080"],
    "curl-style, no scheme",
  );
  assert.deepEqual(chromeProxyArgs({ HTTP_PROXY: "http://user:secret@proxy.corp:8080" }), [
    "--proxy-server=http=http://proxy.corp:8080",
  ]);
  assert.deepEqual(
    chromeProxyArgs({ HTTPS_PROXY: "proxy.corp:8080" }),
    ["--proxy-server=https=http://proxy.corp:8080"],
    "a bare host:port",
  );
  assert.deepEqual(
    chromeProxyArgs({ HTTPS_PROXY: "user:secret@" }),
    [],
    "no host left: no argument, never the raw value",
  );
  assert.deepEqual(chromeProxyArgs({ HTTP_PROXY: "user:secret@", HTTPS_PROXY: P }), [
    "--proxy-server=https=http://proxy.corp:8080",
  ]);
});
