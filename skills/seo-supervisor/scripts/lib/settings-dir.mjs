// @ts-check
// Where settings, logins, keys and add-ons live: ~/.seo-supervisor or SEO_SUPERVISOR_HOME. SEO_SUPERVISOR_CLIENT=<name>
// puts logins and keys in clients/<name> so each client's stay apart; add-ons and the update setting stay shared.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize } from "node:path";

// ~ is expanded here, since GitHub Actions, .env files and PowerShell don't. A relative path is refused: it would put
// logins and keys inside whatever folder a script runs from, usually the project, where a commit could take them.
// Errors carry code SEO_SETTINGS so scripts show them as plain messages: the fix is in the environment, not the code.
const settingsError = msg => Object.assign(new Error(msg), { code: "SEO_SETTINGS" });
export function settingsDir(env = process.env, home = homedir()) {
  const v = env.SEO_SUPERVISOR_HOME;
  if (!v) return join(home, ".seo-supervisor");
  const p = v === "~" ? home : /^~[\\/]/.test(v) ? join(home, v.slice(2)) : v;
  if (!isAbsolute(p))
    throw settingsError(
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
    throw settingsError(`SEO_SUPERVISOR_CLIENT must be a short name made of letters, digits, - and _ (got "${c}").`);
  return join(settingsDir(env, home), "clients", c);
}

// The saved Google sign-in (google.mjs connect writes it; doctor.mjs only looks).
export const googleFile = (env = process.env, home = homedir()) => join(loginDir(env, home), "google.json");

// A login or key file, renamed over the old one so a crash never leaves half of it, and made readable by this user
// only before it does. Unix: mode 600 in a 700 folder, then checked, since some drives ignore modes. Windows ignores
// modes, so icacls removes inherited entries and grants this user alone full control. locked says whether that held;
// when it didn't, the file is only as private as its folder, and privacyOf says so rather than claiming more.
/** @param {string} file @param {string} text @returns {{ locked: boolean }} */
export function writePrivate(file, text) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  chmodSync(dirname(file), 0o700);
  const t = `${file}.${process.pid}.tmp`;
  writeFileSync(t, text, { mode: 0o600 });
  chmodSync(t, 0o600);
  let locked;
  if (process.platform === "win32") {
    const user =
      process.env.USERDOMAIN && process.env.USERNAME
        ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
        : process.env.USERNAME;
    // The full path, never a search: an icacls.exe in the current folder isn't run.
    locked =
      !!user &&
      spawnSync(
        join(process.env.SystemRoot || "C:\\Windows", "System32", "icacls.exe"),
        [t, "/inheritance:r", "/grant:r", `${user}:F`],
        { stdio: "ignore", windowsHide: true },
      ).status === 0;
  } else locked = (statSync(t).mode & 0o077) === 0;
  renameSync(t, file);
  return { locked };
}
/** The words for where a writePrivate file stands, for "Saved to <file> (…)". @param {{ locked: boolean }} r */
export const privacyOf = r =>
  r.locked
    ? "only your user account can read it"
    : "this system didn't let it be limited to your user account, so it's as private as the folder it's in";

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
