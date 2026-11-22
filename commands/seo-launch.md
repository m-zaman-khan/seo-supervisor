---
description: "Pre-launch SEO gate: pass or fail, plus the launch-day steps. Answers: is it safe to switch indexing on?, are we ready to go live?, will our site move or URL change lose traffic? For checking each deploy after launch, use /seo-watch."
argument-hint: "[staging or production URL, or the old site's URL list]"
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/update-check.mjs)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/seo-crawl.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/seo-diff.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/render-report.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/deploy-check.mjs *)
---
**Script paths:** here `<skill-dir>` is `${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor`. Run each script by that path exactly as written, with no `cd` first, for example `node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/update-check.mjs`: that's the form this command's pre-approved scripts match, so they run without a prompt. Any other form, or a path with a space in it (quote it), still works and asks first. If that path starts with `$` (installed with npx, not as the plugin), `<skill-dir>` is the folder that holds the skill's SKILL.md, and each script asks first.

Use the **seo-supervisor** skill in **launch** mode for this project (site or URL, may be empty: $ARGUMENTS).

Run the audit, with `--check-live` once the production origin answers, then give a clear **PASS** or **FAIL**. It passes only with zero open blockers and zero open high findings in the CRAWL, URL, REND, MAP and TRUST-07 rules; a certificate blocker always fails. List what blocks launch, then the launch-day steps from `rules/launch-monitoring.md`. Don't edit anything.

- **A site move or URL change** (new domain, new URL scheme, a redesign): ask for the old site's URLs, one per line, and crawl with `--urls old-urls.txt` (or `--next-manifest .next/routes-manifest.json`). Each old URL must 301 in one hop to its closest new page: list the dead ends, the chains, and the old URLs that all land on one page (often the home page), which lose what they ranked for. For a new domain, add Change of Address in Search Console to the launch-day steps (LAUNCH-01). After the move, offer the known-backlinks check (`backlinks.mjs`, a dry run first).
- **IndexNow** goes in the launch-day steps: once the site is live, fix mode (`/seo-fix`) writes the key file with the owner's yes, the owner deploys, and `indexnow.mjs submit --site <origin> --key <key> --from-sitemap <origin>/sitemap.xml` (a dry run; `--yes` sends) tells Bing and the others about every page.
- **After launch:** suggest `deploy-check.mjs --site <origin>` (or `npx seo-supervisor deploy-check --site <origin>`) as a CI step after each deploy. It takes about ten seconds and fails on a blocker.

For checking each deploy or what changed after launch, use `/seo-watch`. For fixing what blocks launch, use `/seo-fix`.
