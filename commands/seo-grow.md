---
description: "Plan how to get more visitors from search, from the site's own data. Answers: how do I get more visitors?, what should I work on next?, which searches am I almost winning? For whether a past change helped, use /seo-watch; for one page's brief, use /seo-brief."
argument-hint: "[goal, page or audience]"
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/update-check.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/gsc-import.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/google.mjs fetch *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/keyword-ideas.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/change-check.mjs *)
---
Use the **seo-supervisor** skill in **grow** mode for this project. Follow `grow.md` exactly, stage by stage.

- **Read-only.** Grow mode's own output is `seo-audit/grow-plan.md`. The steps it runs with the owner's OK, such as `keyword-ideas.mjs`, `change-check.mjs` and the audience check, write their usual files in `seo-audit/`. Never edit the project's code, content or config.
- **Real data only.** Every item gives its evidence: the file, the numbers and their period. When a stage's data is missing, say what's missing and how to get it, and carry on without it. Never guess.
- **The owner decides.** Only phrases the owner picks become targets. Nothing is built in grow mode: each item names who does it and the mode that does it (brief, rewrite or fix), and starts only with the owner's yes.
- **Considered, not recommended:** the plan lists the ideas you looked at and left out, each with what you found and the reason, so they aren't suggested again.
- **Never** invent search volumes, rankings, audiences or traffic forecasts, and never suggest buying or disavowing links as a way to grow.
- **An earlier plan:** if `seo-audit/grow-plan.md` exists, continue from it. Once its "check again after" date has passed, start with the check (Stage 6): with Google connected, `change-check.mjs` compares the changed pages with similar unchanged ones.

Finish with the plan's path, the top three items and who does each, the data still missing, and the check-again date.

For whether one change helped, use `/seo-watch`. For a brief for one page, use `/seo-brief`.

Focus from the user (may be empty): $ARGUMENTS
