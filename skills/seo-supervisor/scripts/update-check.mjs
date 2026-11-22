#!/usr/bin/env node
// @ts-check
// Weekly at most, says when a newer version is on npm. It never updates anything and sends only the package name.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { runMain } from "./lib/cli.mjs";
import { settingsDir } from "./lib/settings-dir.mjs";

export const VERSION = "2.0.0"; // kept equal to package.json by test/update-check.test.mjs
const WEEK = 7 * 864e5;
const dir = () => settingsDir(); // ~/.seo-supervisor, or SEO_SUPERVISOR_HOME
const readJson = f => {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return {};
  }
};
const writeJson = (f, data) => {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(f, JSON.stringify(data, null, 2) + "\n");
};

// Numeric, so "2.10.0" > "2.9.9". A pre-release or anything unparsable is never newer.
export function isNewer(candidate, current) {
  const parse = v => (/^\d+\.\d+\.\d+$/.test(String(v)) ? String(v).split(".").map(Number) : null);
  const a = parse(candidate),
    b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

async function checkForUpdate({ env = process.env, now = Date.now(), fetchFn = fetch } = {}) {
  const settingsFile = join(dir(), "settings.json"),
    cacheFile = join(dir(), "update-check.json");
  if (env.SEO_SUPERVISOR_NO_UPDATE_CHECK || env.CI || readJson(settingsFile).updateCheck === false) return null;
  let { checkedAt, latest } = readJson(cacheFile);
  if (!checkedAt || now - Date.parse(checkedAt) > WEEK || Number.isNaN(Date.parse(checkedAt))) {
    try {
      const registry = (env.SEO_SUPERVISOR_REGISTRY || "https://registry.npmjs.org").replace(/\/$/, "");
      const r = await fetchFn(`${registry}/seo-supervisor/latest`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return null;
      latest = /** @type {any} */ (await r.json()).version;
      writeJson(cacheFile, { checkedAt: new Date(now).toISOString(), latest });
    } catch {
      return null;
    } // offline or blocked: say nothing
  }
  return isNewer(latest, VERSION) ? latest : null;
}

if (isMain(import.meta.url)) {
  const cmd = process.argv[2];
  // A bad SEO_SUPERVISOR_HOME can't save the setting; runMain prints one plain line and exits 2.
  if (cmd === "off" || cmd === "on")
    await runMain(() => {
      const f = join(dir(), "settings.json");
      writeJson(f, { ...readJson(f), updateCheck: cmd === "on" });
      console.log(
        cmd === "off"
          ? "Update notices turned off. Turn them on again with: node update-check.mjs on"
          : "Update notices turned on (npm is checked at most once a week).",
      );
    });
  else {
    const latest = await checkForUpdate().catch(() => null);
    if (latest)
      console.log(
        `SEO Supervisor ${latest} is out (you have ${VERSION}). Update with: npx seo-supervisor@latest (plugin installs: update it from Claude Code's /plugin menu). Turn these notices off: node update-check.mjs off`,
      );
  }
}
