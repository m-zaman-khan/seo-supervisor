---
description: "Audit this site's SEO (read-only) and write the HTML report. Answers: what's wrong with my SEO?, why aren't my pages indexed or ranking?, what should I fix first? Given a page URL: what's wrong with this page? For a change or PR, use /seo-review; for fixing, use /seo-fix."
argument-hint: "[site or page URL, or notes]"
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/update-check.mjs)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/doctor.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/seo-crawl.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/seo-diff.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/content-scan.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/gsc-import.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/google.mjs fetch *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/keyword-ideas.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/links-import.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/log-scan.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/render-report.mjs *)
---
**Script paths:** here `<skill-dir>` is `${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor`. Run each script by that path exactly as written, with no `cd` first, for example `node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/update-check.mjs`: that's the form this command's pre-approved scripts match, so they run without a prompt. Any other form, or a path with a space in it (quote it), still works and asks first. If that path starts with `$` (installed with npx, not as the plugin), `<skill-dir>` is the folder that holds the skill's SKILL.md, and each script asks first.

Use the **seo-supervisor** skill in **audit** mode for this project. Follow its SKILL.md exactly: change no source, content or config; crawl the site, inspect the code and content data, then write `seo-audit/seo-audit.json` and render it, which produces `seo-audit/seo-audit.html` and `seo-audit/seo-audit.md`.

- **One page:** when the user gives a URL with a path (`https://www.example.com/pricing/`), check that one page only. Crawl it with `seo-crawl.mjs --url <that URL> --max 1 --out seo-audit/page/seo-crawl.json` and skip the history step, so the full audit's files stay as they are. Report only the findings whose evidence is that URL, and say "one page only" in the answer. A URL without a path (or none) audits the whole site.
- **AI search and local results** are part of the audit: the AI crawler table and AI referrals, and for a local business, the local checks.

Finish with the score and band (and, while blockers are open, the score fixing them unlocks and who has to do it), the verdict, counts by severity, the top three problems, both report paths, and an offer to fix (`/seo-fix`). Then offer, once each and only where it fits:
- the data connections not set up yet (`/seo-connect`; record the answers in `seo-audit/settings.json`)
- GitHub issues for the open findings (`issues.mjs`: a dry run first, `--yes` only after the owner's yes)
- the AI answer check, for any site: whether ChatGPT or Perplexity cite it (the owner's own key, at their cost)
- the geo-grid, for a local business: where it shows up around town (the owner's own Google key)
- setup (`/seo-setup`) if the site has almost no SEO in place

For a change or PR, use `/seo-review`. For fixing findings, use `/seo-fix`. For what changed since this audit, use `/seo-watch`.

Extra details from the user (may be empty): $ARGUMENTS
