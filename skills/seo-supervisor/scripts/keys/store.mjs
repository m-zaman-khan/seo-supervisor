// @ts-check
// Saved service keys: where they live, reading and writing them, and asking for one without echoing it.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { loginDir, writePrivate } from "../lib/settings-dir.mjs";
import { Fail, fail, setLine } from "./http.mjs";
import { SERVICES, serviceOf } from "./services.mjs";

export const keyFile = () => join(loginDir(), "keys.json"); // honours SEO_SUPERVISOR_HOME and SEO_SUPERVISOR_CLIENT
export function savedKeys() {
  const f = keyFile();
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    fail(`${f} isn't valid JSON. Fix it or delete it, then set the keys again.`);
  }
}
// Renamed over the old file, so a crash never leaves half a keys file, and readable by this user only where the
// system allows; { locked } says whether that held.
const save = keys => writePrivate(keyFile(), JSON.stringify(keys, null, 2) + "\n");

// What set still needs. Piped stdin gives a line each, in order; a terminal asks for the address and ID in plain view
// (they aren't secret), then for the key without showing it.
export async function ask(id, missing, needKey) {
  const { stdin, stderr } = process,
    values = {};
  if (!stdin.isTTY) {
    let text = "";
    const n = missing.length + (needKey ? 1 : 0);
    for await (const c of stdin) {
      text += c;
      if (text.split("\n").length > n) break;
    }
    const lines = text.split(/\r?\n/).map(s => s.trim());
    missing.forEach((f, i) => {
      values[f.id] = lines[i];
    });
    return {
      values,
      key: needKey
        ? lines[missing.length] ||
          fail(`no key was given. In your own terminal, run ${setLine(id)} and paste the key when it asks.`)
        : undefined,
    };
  }
  if (missing.length) {
    const rl = createInterface({ input: stdin, output: stderr });
    rl.on("SIGINT", () => rl.close());
    try {
      for (const f of missing) values[f.id] = await rl.question(`${f.ask}: `);
    } catch {
      fail("cancelled, nothing was saved.");
    } finally {
      rl.close();
    }
  }
  return { values, key: needKey ? await readKey(id) : undefined };
}
// The key from the terminal, without showing it.
async function readKey(id) {
  const { stdin, stderr } = process;
  stderr.write(`Paste the ${SERVICES[id].name} ${SERVICES[id].secret || "key"} and press Enter (it isn't shown): `);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  return new Promise((ok, no) => {
    let key = "";
    const done = () => {
      stdin.setRawMode(false);
      stdin.off("data", onData);
      stdin.pause();
      stderr.write("\n");
    };
    const onData = s => {
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") {
          done();
          return ok(key);
        }
        if (ch === "\u0003") {
          done();
          return no(new Fail("connect-keys: cancelled, nothing was saved."));
        }
        if (ch === "\u007f" || ch === "\b") {
          if (key) {
            key = key.slice(0, -1);
            stderr.write("\b \b");
          }
        } else {
          key += ch;
          stderr.write("*");
        }
      }
    };
    stdin.on("data", onData);
    stdin.resume();
  });
}
// values: Matomo's or PostHog's address and ID, checked and tidied before anything is saved. Returns { locked }.
export function setKey(id, key, values = {}) {
  const s = SERVICES[serviceOf(id)];
  key = String(key ?? "").trim();
  if (!key || /\s/.test(key))
    fail(`that doesn't look like a key (it's empty or has spaces). Copy it again from ${s.where}.`);
  if (id === "posthog" && key.startsWith("phc_"))
    fail(
      `that's the project key from your site's tracking code (it starts with phc_), which can only send data to PostHog. Reading needs a personal API key, which starts with phx_. To make one: node connect-keys.mjs guide posthog`,
    );
  // Microsoft: "Access to the API is secured via JWT tokens", three parts joined by dots.
  if (id === "clarity" && !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(key))
    fail(
      `that isn't a Clarity API token: those are long, with two dots in them. A short code like the one in Clarity's tracking code is the project ID, which can't read data. To make a token: node connect-keys.mjs guide clarity`,
    );
  const extra = Object.fromEntries((s.fields || []).map(f => [f.id, f.check(String(values[f.id] ?? "").trim())]));
  return save({ ...savedKeys(), [id]: s.fields ? { ...extra, key } : key });
}
export function removeKey(id) {
  serviceOf(id);
  const keys = savedKeys();
  if (!(id in keys)) return false;
  delete keys[id];
  save(keys);
  return true;
}
// { bing: { key, from } | null, matomo: { key, from, url, siteId } | null, ... }; an environment variable wins over the
// saved value. Matomo and PostHog count as set only with their address and ID too.
export function activeKeys(env = process.env) {
  const saved = savedKeys();
  return Object.fromEntries(
    Object.entries(SERVICES).map(([id, s]) => {
      const v = saved[id],
        savedKey = s.fields ? v?.key : v;
      const k = env[s.env] ? { key: env[s.env], from: s.env } : savedKey ? { key: savedKey, from: keyFile() } : null;
      for (const f of (k && s.fields) || []) k[f.id] = env[f.env] ? f.check(env[f.env].trim()) : v?.[f.id];
      return [id, k && (s.fields || []).every(f => k[f.id]) ? k : null];
    }),
  );
}
export const mask = k => (k.length > 8 ? "…" + k.slice(-4) : "…");
