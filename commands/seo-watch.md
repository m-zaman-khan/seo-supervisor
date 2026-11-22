---
description: "What changed since the last audit, and did it help? Answers: what changed on my pages?, did my change help?, did a Google update hit my site?, how are all my sites doing? Read-only; files go to seo-audit/watch/. For the full report, use /seo-audit; for what to do next, use /seo-grow."
argument-hint: "[change date YYYY-MM-DD, pages, or folders for several sites]"
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/update-check.mjs)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/seo-crawl.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/seo-diff.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/change-check.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/dashboard.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/deploy-check.mjs *)
---
**Script paths:** here `<skill-dir>` is `${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor`. Run each script by that path exactly as written, with no `cd` first, for example `node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/update-check.mjs`: that's the form this command's pre-approved scripts match, so they run without a prompt. Any other form, or a path with a space in it (quote it), still works and asks first. If that path starts with `$` (installed with npx, not as the plugin), `<skill-dir>` is the folder that holds the skill's SKILL.md, and each script asks first.

Use the **seo-supervisor** skill in **watch** mode for this project. Follow SKILL.md's Watch mode.

- **Read-only.** Change no source, content or config.
- **Never replace the audit's files.** Everything this command writes goes to `seo-audit/watch/`. Leave `seo-audit/seo-crawl.json`, `seo-audit/seo-diff.json`, `seo-audit/history/` and the report as they are.
- **What changed:** crawl the site with `seo-crawl.mjs --url <site> --out seo-audit/watch/seo-crawl.json` (the same `--site-origin` and options as the last audit, without `--outside`). Then compare it with the last audit's crawl: `seo-diff.mjs seo-audit/seo-crawl.json seo-audit/watch/seo-crawl.json --out seo-audit/watch/seo-diff.json`. With no earlier audit, say so and offer `/seo-audit` instead.
- **Did my change help?** With Google connected and a change date: `change-check.mjs --site <live origin> --date <YYYY-MM-DD> --pages <file>` (or `--from-diff seo-audit/watch/seo-diff.json`) `--out seo-audit/watch/change-check.json`. Say "likely up", "likely down" or "inconclusive" with its range, and what changed in the numbers, never why. If the days after the change aren't final yet, give the date to look again and stop. Without Google connected, offer `/seo-connect`.
- **Did a Google update hit the site?** Only with `updates` in `outsideChecks.approved` (otherwise ask once): `google-updates.mjs --since <the last audit's crawledAt> --out seo-audit/watch/google-updates.json --yes`. List the updates by date. Never say an update caused a change.
- **Several sites:** `dashboard.mjs <folder> <folder> --out seo-audit/watch/dashboard.html` reads the audits already on this machine and sends nothing.
- **Every deploy:** offer `deploy-check.mjs --site <origin>` (or `npx seo-supervisor deploy-check --site <origin>`) as a CI step, and regular crawls from `examples/scheduled-runs.md`. Set either up only on the owner's yes.

Answer in chat: what changed (regressions first), the change check's verdict, any Google update in the period, and the paths in `seo-audit/watch/`. Then offer a full audit (`/seo-audit`) to refresh the report.

For a full audit and report, use `/seo-audit`. For what to do next, use `/seo-grow`. For going live or a site move, use `/seo-launch`.

Details from the user (may be empty): $ARGUMENTS
