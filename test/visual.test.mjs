// Tests that need no Chrome; the ones that launch it are in test/browser/visual.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchChrome, containerArgs } from "../skills/seo-supervisor/scripts/lib/cdp.mjs";
import { SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";

test("Chrome gets --no-sandbox only as root on Linux or in a container", () => {
  const none = () => false,
    off = ["--no-sandbox", "--disable-dev-shm-usage"],
    linux = { platform: "linux", uid: 1000, env: {}, exists: none };
  assert.deepEqual(containerArgs(linux), [], "an ordinary Linux user keeps the sandbox");
  assert.deepEqual(containerArgs({ ...linux, uid: 0 }), off, "root");
  assert.deepEqual(containerArgs({ ...linux, exists: f => f === "/.dockerenv" }), off, "Docker");
  assert.deepEqual(containerArgs({ ...linux, exists: f => f === "/run/.containerenv" }), off, "Podman");
  assert.deepEqual(containerArgs({ ...linux, env: { KUBERNETES_SERVICE_HOST: "10.0.0.1" } }), off, "a Kubernetes pod");
  assert.deepEqual(
    containerArgs({ platform: "darwin", uid: 0, env: {}, exists: () => true }),
    [],
    "macOS keeps it, even as root",
  );
  assert.deepEqual(
    containerArgs({ platform: "win32", uid: undefined, env: { KUBERNETES_SERVICE_HOST: "x" }, exists: () => true }),
    [],
  );
});

test("a browser that won't start fails fast and cleanly", async () => {
  await assert.rejects(launchChrome(process.execPath, { timeoutMs: 5000 }), /exited|timed out/);
});

test("the overview shows one line of indicative lab speed for the home page", async () => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  data.labSpeed = [
    { url: "https://example.com/about/", lcp: 1800, cls: 0, tbt: 90 },
    { url: "https://example.com/", lcp: 3240, cls: 0.041, tbt: 450 },
  ];
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  const line = /Lab speed, slow mobile \(indicative\): LCP 3\.2 s · CLS 0\.04 · TBT 450 ms on the home page/;
  assert.ok(line.test(readFileSync(join(dir, "r.html"), "utf8")), "HTML overview");
  assert.ok(line.test(readFileSync(join(dir, "r.md"), "utf8")), "Markdown overview");
});
