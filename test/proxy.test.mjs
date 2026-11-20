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
    /Node 22\.12\.0 can't .*22\.21 or 24\.5/,
    "too old for the flag",
  );

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

  for (const script of ["seo-crawl.mjs", "google.mjs"]) {
    const r = spawnSync(process.execPath, [join(SCRIPTS, script)], {
      env: envWith({ HTTPS_PROXY: P }),
      encoding: "utf8",
    });
    assert.equal(r.stderr.match(/A proxy is set/g)?.length, 1, `${script} prints it once: ${r.stderr}`);
    const on = spawnSync(process.execPath, [join(SCRIPTS, script)], {
      env: envWith({ HTTPS_PROXY: P, NODE_USE_ENV_PROXY: "1" }),
      encoding: "utf8",
    });
    assert.doesNotMatch(on.stderr, /A proxy is set/, `${script} with the flag`);
  }
});
