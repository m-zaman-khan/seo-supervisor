---
description: "Rewrite a page's text in plain words, with your yes before anything changes. Answers: can you make this page easier to read?, fix what the writing notes flagged? For planning a new page, use /seo-brief."
argument-hint: '[page, file, or "writing notes"]'
disable-model-invocation: true
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/update-check.mjs)
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/seo-crawl.mjs *)
---
**Script paths:** here `<skill-dir>` is `${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor`. Run each script by that path exactly as written, with no `cd` first, for example `node ${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor/scripts/update-check.mjs`: that's the form this command's pre-approved scripts match, so they run without a prompt. Any other form, or a path with a space in it (quote it), still works and asks first. If that path starts with `$` (installed with npx, not as the plugin), `<skill-dir>` is the folder that holds the skill's SKILL.md, and each script asks first.

Use the **seo-supervisor** skill in **rewrite** mode for: $ARGUMENTS

Follow `rewrite.md` exactly.

- **Which text:** the page or file named, or "writing notes": the pages the last crawl's writing notes list (`writingNotes` in `seo-audit/seo-crawl.json`). If nothing is named, ask which.
- **You rewrite it yourself.** No API, and no script edits the text.
- **Change:** long sentences and paragraphs, stock phrases, jargon, filler and needless passive voice.
- **Never change:** facts, numbers, prices, dates, names, brand or product terms, what a claim means, legal text, quotes, testimonials, code, URLs or links.
- **Target phrases** (the profile's and the page's top Search Console queries) stay in the title, the H1 and the opening paragraph.
- **Nothing changes without the owner's yes.** Show before → after for each paragraph first. Content in a CMS follows fix steps 3–4: drafts, and publish only when the owner says so.
- **Other languages:** only with the owner's yes, as the writing notes are English-only.

Finish with a re-crawl: the writing notes should drop. List what changed, and what still waits for the owner.

For planning a new page, use `/seo-brief`. For titles and descriptions that code builds, use `/seo-fix`.
