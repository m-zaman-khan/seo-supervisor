#!/usr/bin/env node
// @ts-check
// Pre-action hook: reads the hook's JSON on stdin and answers allow, ask (with a plain reason) or deny. Rules live in
// guard/rules.mjs, each host's payload and answer format in guard/adapters/<agent>.mjs.
import { readFileSync } from "node:fs";
import { isMain } from "./lib/is-main.mjs";
import { checkAction } from "./guard/rules.mjs";
import { guardMode, projectSettings } from "./guard/mode.mjs";

/** Checks the adapter's actions in order; the first that isn't allowed decides.
 * @param {string} agent @param {any} input
 * @param {{ check?: typeof checkAction, env?: Record<string, string | undefined>, event?: string, cwd?: string }} [opts]
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>} */
export async function run(agent, input, { check = checkAction, env = process.env, event, cwd } = {}) {
  if (!/^[a-z][a-z0-9-]*$/.test(String(agent))) throw new Error(`unknown agent "${agent}"`);
  const ad = await import(`./guard/adapters/${agent}.mjs`);
  const ev = event || (typeof input?.hook_event_name === "string" ? input.hook_event_name : "");
  const dir = cwd || (typeof input?.cwd === "string" && input.cwd) || process.cwd();
  const actions = ad.toActions(input, ev, dir) || [];
  const own = ad.session?.(input, ev, dir, actions, env); // an adapter may answer session events itself
  if (own) return own;
  if (!actions.length) return ad.respond({ decision: "allow" }, ev);
  const mode = guardMode(env, dir),
    settings = mode === "off" ? {} : projectSettings(dir, env);
  let result = { decision: "allow" };
  for (const a of actions) {
    const r = check(a, { mode, settings, cwd: dir });
    if (r?.decision && r.decision !== "allow") {
      result = r;
      break;
    }
  }
  return ad.respond(result, ev);
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2),
    opt = n => {
      const i = argv.indexOf(n);
      return i >= 0 ? argv[i + 1] : undefined;
    };
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      "usage: node guard.mjs --agent claude-code [--event <hook event>]   (reads the agent hook's JSON on stdin)",
    );
    process.exit(0);
  }
  try {
    const raw = readFileSync(0, "utf8");
    const r = await run(opt("--agent") || "claude-code", raw.trim() ? JSON.parse(raw) : {}, { event: opt("--event") });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    process.exitCode = r.exitCode || 0;
  } catch (e) {
    // The guard must never block on its own failure: bad input or a bug allows the action, with one line on stderr.
    process.stderr.write(
      `seo-supervisor guard: allowed the action after its own error (${String(e?.message || e)
        .split("\n")[0]
        .slice(0, 200)})\n`,
    );
    // Answer in the host's own format: some hooks (Cursor's) block on empty or invalid output.
    try {
      const agent = opt("--agent") || "claude-code";
      if (/^[a-z][a-z0-9-]*$/.test(agent)) {
        const out = (await import(`./guard/adapters/${agent}.mjs`)).respond(
          { decision: "allow" },
          opt("--event") || "",
        ).stdout;
        if (out) process.stdout.write(out);
      }
    } catch {}
    process.exitCode = 0;
  }
}
