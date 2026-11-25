---
description: "Write an SEO content brief for a topic or page. Answers: what should this page say?, which phrases and questions should it cover?, how do I plan a cluster of posts? Read-only. For changing the words of a page that exists, use /seo-rewrite."
argument-hint: "[topic or URL]"
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/update-check.mjs)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/keyword-ideas.mjs *)
---
**Script paths:** here `<skill-dir>` is `${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor`. Run each script by that path exactly as written, with no `cd` first, for example `node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/update-check.mjs`: that's the form this command's pre-approved scripts match, so they run without a prompt. Any other form, or a path with a space in it (quote it), still works and asks first. If that path starts with `$` (installed with npx, not as the plugin), `<skill-dir>` is the folder that holds the skill's SKILL.md, and each script asks first.

Use the **seo-supervisor** skill in **brief** mode for: $ARGUMENTS

Follow the brief format in `strategy.md` exactly, with its headings: Intent · Target and related phrases · Title and description · What's new here · Outline · Questions to answer · Facts needed from the owner · Internal links in and out.

- **Read-only.** Write only in `seo-audit/briefs/`. Never edit the project's code, content or config.
- **Facts:** use only what the site or the owner says. Anything else is a visible `[owner: …]` placeholder.
- **Intent first:** state the page's search intent, and get the owner's OK on it before reading any search results.
- **What ranks:** look at the search results only with outside checks on and `intent` in `outsideChecks.approved` (`seo-audit/settings.json` or the SEO profile; if neither says, ask once). Name the search engine and the date. Never invent volumes or rankings.
- **Keyword ideas:** when `seo-audit/` has `google.json` or `gsc.json`, run `keyword-ideas.mjs` as SKILL.md's Keyword ideas says, and show the ideas with their sources. Only phrases the owner picks become targets.
- **Keyword data (optional, the owner pays):** if `connect-keys.mjs status` shows DataForSEO or Semrush, offer `keyword-data.mjs` for the candidate phrases as SKILL.md says: show its dry run, and add `--yes` only after the owner agrees.
- **Links:** read the site's routes or the last crawl (`seo-audit/seo-crawl.json`) so every internal link in the brief points at a page that exists.
- **Sources:** use the project's files, its content dump and the last crawl. Don't query a CMS or other API; what you can't find there is a question for the owner.
- **The URL of an existing page:** start with the One page review in `strategy.md`, and put its wireframe at the top of the brief.
- **A comparison page** ("X vs Y", "alternatives to X", "best X"): add the parts under "Comparison briefs" in `strategy.md`.
- **A whole cluster:** write one brief per post, as "Briefs for a whole cluster" in `strategy.md` says. Confirm the list of posts with the owner first.

Finish with the brief's path (or the cluster's index) and the facts it still needs from the owner.

For changing the words of a page that exists, use `/seo-rewrite`. For which pages to work on next, use `/seo-grow`.
