---
description: "Fix SEO findings from the last audit (all open ones, or the IDs you give). Answers: can you fix these SEO problems?, fix F-012 for me? For building SEO a site doesn't have yet, use /seo-setup; for page wording, use /seo-rewrite."
argument-hint: "[finding IDs, e.g. F-001 F-004]"
disable-model-invocation: true
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/update-check.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/doctor.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/seo-crawl.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/seo-diff.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/content-scan.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/schema-check.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/render-report.mjs *)
---
Use the **seo-supervisor** skill in **fix** mode for this project.

- If `seo-audit/seo-audit.json` doesn't exist yet, run the audit first, show the results, and ask which findings to fix before changing anything.
- Otherwise fix these findings: $ARGUMENTS. If none are named, fix all open findings, most serious first.
- Follow the skill's fix rules:
  - Fix the cause in the shared place.
  - **Ask first, and wait for the owner's go-ahead in this conversation, before:**
    - editing or publishing content in a CMS or content database
    - removing, merging, holding, unpublishing or noindexing pages
    - changing a live URL (it needs a redirect plan)
    - touching robots or noindex in production
    - setting AI crawler policy (which AI bots robots.txt lets in)
    - anything under "Decisions needed"

    Without an answer, leave the finding open as **Needs you**, and say what fixing it unlocks. Never get around it with a code change that has the same effect.
  - Re-check every fix, then update and re-render the same report.
- At the end, offer GitHub issues for what's still open (`issues.mjs`, a dry run first).

For building SEO the site doesn't have yet, use `/seo-setup`. For rewriting a page's wording, use `/seo-rewrite`. For finding new problems, use `/seo-audit`.
