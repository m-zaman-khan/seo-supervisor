---
description: "Check the setup and connect data sources. Answers: is my setup OK?, why did a script fail?, is Search Console connected?, how do I add my Bing, Clarity or other key? Changes nothing in the project. For using the data in a report, use /seo-audit."
argument-hint: "[service, e.g. google, bing, clarity]"
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/update-check.mjs)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/doctor.mjs *)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/google.mjs status)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/google.mjs guide)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/connect-keys.mjs status)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/connect-keys.mjs guide *)
---
**Script paths:** here `<skill-dir>` is `${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor`. Run each script by that path exactly as written, with no `cd` first, for example `node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/update-check.mjs`: that's the form this command's pre-approved scripts match, so they run without a prompt. Any other form, or a path with a space in it (quote it), still works and asks first. If that path starts with `$` (installed with npx, not as the plugin), `<skill-dir>` is the folder that holds the skill's SKILL.md, and each script asks first.

Use the **seo-supervisor** skill in **connect** mode for this project. Follow SKILL.md's Connect mode and its Connections list (step 2).

1. **Run `doctor.mjs` first.** It checks Node, Chrome or Edge, the add-ons and the connections, and changes nothing. Pass on anything marked `!!` with its fix.
2. **Show each connection's status** from `google.mjs status`, `connect-keys.mjs status` and `seo-audit/settings.json` `"connections"`: Google Search Console and Analytics, Bing Webmaster Tools, Open PageRank, Ahrefs, Moz, YouTube, Microsoft Clarity, Matomo or PostHog (only if the site uses one), and the owner-paid ones: AI answers (Perplexity, OpenAI) and the geo-grid (Google Places, local businesses).
3. **Offer to connect** the ones not set up (or only the service named), one at a time, saying what each adds and what it sends where. A no is fine: record it in `settings.json` and don't ask again.
   - **Google:** sign-in with `google.mjs connect --print-url`, as SKILL.md step 2 says.
   - **Keys:** `connect-keys.mjs guide <service>` says where to get one. The owner types it at the hidden prompt in their own terminal: `node <skill-dir>/scripts/connect-keys.mjs set <service>` (in Claude Code, type `!` first). **Never ask for a key in chat**, and never put one on the command line, in a file in the project, or in a commit. If the owner pastes a key in chat, tell them to revoke it with the service and make a new one.
4. Confirm each new connection with its status line.

Finish with a table: each connection, connected or not, and what it adds. Then offer `/seo-audit` to use the new data.

For an audit that uses the connections, use `/seo-audit`. For whether a change helped, use `/seo-watch`.

Service from the user (may be empty): $ARGUMENTS
