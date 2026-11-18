---
description: Fix SEO findings from the last audit (all open ones, or the IDs you give)
argument-hint: "[finding IDs, e.g. F-001 F-004]"
---
Use the **seo-supervisor** skill in **fix** mode for this project.

- If `seo-audit/seo-audit.json` doesn't exist yet, run the audit first, show the results, and ask which findings to fix before changing anything.
- Otherwise fix these findings: $ARGUMENTS. If none are named, fix all open findings, most serious first.
- Follow the skill's fix rules:
  - Fix the cause in the shared place.
  - Never edit or publish CMS content, and never hide, remove or noindex pages, without the owner's go-ahead in this conversation. Leave those findings open as **Needs you**, and say what fixing them unlocks.
  - Ask before other risky changes: live URLs, robots or noindex in production, anything under "Decisions needed".
  - Re-check every fix, then update and re-render the same report.
