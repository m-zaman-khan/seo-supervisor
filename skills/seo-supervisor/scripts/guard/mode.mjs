// @ts-check
// The guard's mode: ask (the default), block or off.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MODES = new Set(["ask", "block", "off"]);

/** seo-audit/settings.json in the working folder, else in the project folder Claude Code names, else {}. */
export function projectSettings(cwd = process.cwd(), env = process.env) {
  for (const d of [cwd, env.CLAUDE_PROJECT_DIR]) {
    if (!d) continue;
    try {
      return JSON.parse(readFileSync(join(d, "seo-audit", "settings.json"), "utf8")) || {};
    } catch {}
  }
  return {};
}

// Claude Code exports the plugin's guard_mode setting to hooks as CLAUDE_PLUGIN_OPTION_GUARD_MODE; other agents use
// SEO_SUPERVISOR_GUARD or settings.json. Empty values are skipped.
// https://code.claude.com/docs/en/plugins-reference
/** @returns {"ask"|"block"|"off"} */
export function guardMode(env = process.env, cwd = process.cwd()) {
  const v = [env.CLAUDE_PLUGIN_OPTION_GUARD_MODE, env.SEO_SUPERVISOR_GUARD, projectSettings(cwd, env).guard]
    .map(x =>
      String(x ?? "")
        .trim()
        .toLowerCase(),
    )
    .find(Boolean);
  return MODES.has(v) ? /** @type {"ask"|"block"|"off"} */ (v) : "ask";
}
