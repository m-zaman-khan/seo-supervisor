#!/usr/bin/env node
// @ts-check
// Checks this machine is ready for an audit. Read-only and offline; it reports whether a key or token is there, never
// its value.
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findBrowser } from "./checks/render.mjs";
import { findLighthouse } from "./checks/lighthouse.mjs";
import { SERVICES, savedKeys } from "./connect-keys.mjs";
import { installedBrowser, loginDir, settingsDir, toolsDir } from "./lib/settings-dir.mjs";
import { proxyNote } from "./lib/proxy.mjs";
import { isMain } from "./lib/is-main.mjs";

const writable = p => {
  try {
    accessSync(p, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};
// The folder itself, or the nearest folder above it that exists (where it would be made).
const canWrite = p => {
  while (!existsSync(p) && dirname(p) !== p) p = dirname(p);
  return writable(p);
};

export function doctor({ env = process.env, cwd = process.cwd(), version = process.versions.node } = {}) {
  // bad means the audit can't run; warn is something to fix that doesn't stop it.
  let ready = true;
  const lines = [],
    add = (state, text) => {
      lines.push(`${{ ok: "ok", off: "--", bad: "!!", warn: "!!" }[state]}  ${text}`);
      if (state === "bad") ready = false;
    };
  const [major, minor] = version.split(".").map(Number);
  add(
    major >= 22 ? "ok" : "bad",
    `Node ${version}${major >= 22 ? "" : ": SEO Supervisor needs Node 22 or later. Install it from https://nodejs.org"}`,
  );

  const browser = findBrowser(env) || installedBrowser(env);
  add(
    browser ? "ok" : "off",
    browser
      ? `Chrome or Edge: ${browser}`
      : "Chrome or Edge: not found. The render, phone and lab-speed checks, screenshots, share cards and the PDF report need one. Install Chrome or Edge, set CHROME_PATH to it, or in a container or CI run: npx seo-supervisor --with-browser",
  );
  const lh = findLighthouse(env);
  const lhNode = major > 22 || (major === 22 && minor >= 19);
  add(
    lh ? "ok" : "off",
    lh
      ? `Lighthouse: ${lh}`
      : `Lighthouse: not installed (optional). Add it with: npx seo-supervisor --with-lighthouse (about 170 MB${lhNode ? "" : `; it needs Node 22.19 or later, this is ${version}`})`,
  );
  let tools = null;
  try {
    tools = toolsDir(env);
  } catch (e) {
    add("bad", e.message);
  }
  const sharp = !!tools && existsSync(join(tools, "node_modules", "sharp"));
  add(
    sharp ? "ok" : "off",
    sharp
      ? "Image add-on (sharp): installed"
      : "Image add-on (sharp): not installed (optional). Add it with: npx seo-supervisor --with-image-tools (about 20 MB)",
  );

  const dir = tools && settingsDir(env);
  if (dir)
    add(
      canWrite(dir) ? "ok" : "warn",
      `Settings folder: ${dir}${existsSync(dir) ? "" : " (not made yet; it's made the first time a login or key is saved)"}${canWrite(dir) ? "" : ". It can't be written to, so logins and keys can't be saved. Choose another folder with SEO_SUPERVISOR_HOME"}`,
    );
  let logins = null;
  try {
    logins = loginDir(env);
  } catch (e) {
    add("bad", e.message);
  }
  if (logins && env.SEO_SUPERVISOR_CLIENT)
    add("ok", `Client: ${env.SEO_SUPERVISOR_CLIENT}, with its own logins and keys in ${logins}`);

  if (logins) {
    let g = null;
    try {
      g = JSON.parse(readFileSync(join(logins, "google.json"), "utf8"));
    } catch {}
    const how =
      {
        shared: "SEO Supervisor's shared sign-in",
        "own-client": "your own Google Cloud client",
        "service-account": "a service account",
      }[g?.method] || "a saved sign-in";
    add(
      g ? "ok" : "off",
      g
        ? `Google: connected with ${how}${/^\d{4}-\d{2}-\d{2}/.test(g.connected_at || "") ? ` on ${g.connected_at.slice(0, 10)}` : ""}. To test it: node google.mjs status`
        : existsSync(join(logins, "google.json"))
          ? "Google: the saved sign-in can't be read. Connect again: node google.mjs connect"
          : "Google: not connected (optional). Connect Search Console and Analytics with: node google.mjs connect",
    );
    let saved = {};
    try {
      saved = savedKeys();
    } catch {
      add(
        "warn",
        `Saved keys: ${join(logins, "keys.json")} can't be read. Fix it or delete it, then set the keys again`,
      );
    }
    const names = Object.keys(saved)
      .filter(k => SERVICES[k])
      .map(k => SERVICES[k].name);
    add(
      names.length ? "ok" : "off",
      names.length
        ? `Saved keys: ${names.join(", ")}`
        : "Saved keys: none (optional). See: node connect-keys.mjs guide <service>",
    );
  }
  const envKeys = ["PSI_API_KEY", "CRUX_API_KEY", ...Object.values(SERVICES).map(s => s.env)].filter(k => env[k]);
  add(
    envKeys.length ? "ok" : "off",
    envKeys.length ? `Keys set in the environment: ${envKeys.join(", ")}` : "Keys set in the environment: none",
  );
  if (!env.PSI_API_KEY)
    add(
      "off",
      "Real-user speed needs a free PageSpeed Insights key in PSI_API_KEY; without one, PERF-01 goes under Limits",
    );

  const audit = join(cwd, "seo-audit");
  add(
    canWrite(audit) ? "ok" : "bad",
    canWrite(audit)
      ? `This folder can be written to (the audit writes ${audit})`
      : `This folder can't be written to, so the audit can't save ${audit}. Run it from a folder you can write to`,
  );
  const proxy = proxyNote(env);
  if (proxy) add("warn", proxy);
  return {
    ready,
    text: `SEO Supervisor readiness check (read-only: nothing was changed)\n\n${lines.join("\n")}\n\nok = ready · -- = optional, not set up · !! = needs fixing`,
  };
}

if (isMain(import.meta.url)) {
  const r = doctor();
  console.log(r.text);
  process.exitCode = r.ready ? 0 : 1;
}
