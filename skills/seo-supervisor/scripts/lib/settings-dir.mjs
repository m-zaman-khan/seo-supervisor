// Where settings, logins, keys and add-ons live: ~/.seo-supervisor or SEO_SUPERVISOR_HOME. SEO_SUPERVISOR_CLIENT=<name>
// puts logins and keys in clients/<name> so each client's stay apart; add-ons and the update setting stay shared.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";

// ~ is expanded here, since GitHub Actions, .env files and PowerShell don't. A relative path is refused: it would put
// logins and keys inside whatever folder a script runs from, usually the project, where a commit could take them.
export function settingsDir(env = process.env, home = homedir()) {
  const v = env.SEO_SUPERVISOR_HOME;
  if (!v) return join(home, ".seo-supervisor");
  const p = v === "~" ? home : /^~[\\/]/.test(v) ? join(home, v.slice(2)) : v;
  if (!isAbsolute(p))
    throw new Error(
      `SEO_SUPERVISOR_HOME must be a full path, like ${join(home, ".seo-supervisor")} (got "${v}"), so logins and keys never land inside a project.`,
    );
  return normalize(p);
}
export const toolsDir = (env = process.env, home = homedir()) => join(settingsDir(env, home), "tools");

// A client name is one folder name: letters, digits, - and _, so it can never point outside the settings folder.
export function loginDir(env = process.env, home = homedir()) {
  const c = env.SEO_SUPERVISOR_CLIENT;
  if (!c) return settingsDir(env, home);
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(c))
    throw new Error(`SEO_SUPERVISOR_CLIENT must be a short name made of letters, digits, - and _ (got "${c}").`);
  return join(settingsDir(env, home), "clients", c);
}

// The browser `npx seo-supervisor --with-browser` installed, when there is one and it's still there.
export const browserFile = (env = process.env, home = homedir()) => join(toolsDir(env, home), "chrome-path.txt");
export function installedBrowser(env = process.env, home = homedir()) {
  try {
    const p = readFileSync(browserFile(env, home), "utf8").trim();
    return p && existsSync(p) ? p : null;
  } catch {
    return null;
  }
}
