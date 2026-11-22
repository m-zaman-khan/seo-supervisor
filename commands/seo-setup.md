---
description: "Set up SEO from scratch: propose a plan, build it after approval. Answers: my site has no SEO, where do I start?, can you plan and build the SEO basics? For fixing findings on a site that has SEO, use /seo-fix."
argument-hint: "[url or notes]"
disable-model-invocation: true
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/update-check.mjs)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/doctor.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/seo-crawl.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/seo-diff.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/content-scan.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/gsc-import.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/keyword-ideas.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/schema-check.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/render-report.mjs *)
---
**Script paths:** here `<skill-dir>` is `${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor`. Run each script by that path exactly as written, with no `cd` first, for example `node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/update-check.mjs`: that's the form this command's pre-approved scripts match, so they run without a prompt. Any other form, or a path with a space in it (quote it), still works and asks first. If that path starts with `$` (installed with npx, not as the plugin), `<skill-dir>` is the folder that holds the skill's SKILL.md, and each script asks first.

Use the **seo-supervisor** skill in **setup** mode for this project. Follow its SKILL.md and `planning.md` exactly.

- **No plan in `seo-audit/seo-audit.json` yet:**
  1. Work out what the site is, crawl it, and propose the SEO plan.
  2. Render the report. It opens on the Plan tab.
  3. **Stop.** Ask the owner to approve the plan, and to give a yes or no to each "Needs your yes" item.

  Change nothing outside `seo-audit/` before that.
- **A plan already exists:** continue from its status, as `planning.md` describes. A proposed plan goes to approval. An approved plan gets built, and then setup fixes the audit's other code findings listed in the plan. A built plan gets the pages whose drafts the owner approved.
- **Setup and fix:** Setup builds what's missing; fix mode fixes findings. The code findings in `plan.alsoFixes` are handed to fix mode (SKILL.md step 5) with its rules; setup doesn't fix them its own way, and doesn't take on findings the plan doesn't list.
- **Never:**
  - invent facts, prices, reviews or search volumes
  - switch indexing on
  - edit CMS content, or remove, hide or noindex pages, without the owner's go-ahead

For fixing findings on a site that already has SEO, use `/seo-fix`. For one page's brief, use `/seo-brief`.

Extra details from the user (may be empty): $ARGUMENTS
