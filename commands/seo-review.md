---
description: "Review current changes or a PR for SEO problems. Answers: will this change hurt my SEO?, did this PR break a canonical, noindex, title or schema? For the whole site, use /seo-audit."
argument-hint: "[PR number, branch or files]"
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/update-check.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/seo-crawl.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/seo-diff.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/schema-check.mjs *)
---
Use the **seo-supervisor** skill in **review** mode. Review: $ARGUMENTS. If nothing is named, review the uncommitted changes plus the current branch's changes against its base branch.

- **Before and after:** if the site runs, crawl the changed pages with `--out seo-audit/review-crawl.json`, so the branch's crawl stays out of the history. When there's an earlier crawl (a committed one, or the newest in `seo-audit/history/`), compare it with the branch's: `seo-diff.mjs <earlier crawl> seo-audit/review-crawl.json --out seo-audit/review-diff.json`, and include its regressions.
- **Structured data:** when the change touches JSON-LD or a template that builds it, run `schema-check.mjs` on the built page or the running server's URL, and report its errors.

Report only SEO regressions and new problems those changes introduce, with file:line evidence and how to fix each. Don't edit anything.

For the whole site, use `/seo-audit`. For fixing what this finds, use `/seo-fix`.
