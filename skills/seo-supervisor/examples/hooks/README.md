# Structured data triggers (opt-in)

These run `scripts/schema-check.mjs` for you: after an agent edits a page, before a commit, or in CI. Nothing is installed by default. Copy the ones you want.

Each one stays silent when the JSON-LD passes and only looks at `.html`, `.htm`, `.jsonld` and `.json` files that contain JSON-LD. Errors are unknown types or properties, wrong value shapes and missing Google-required properties. Warnings are never shown here; run the checker by hand to see them.

The paths assume a project install (`npx seo-supervisor --scope project`): `.claude/skills/seo-supervisor/` for Claude Code, `.agents/skills/seo-supervisor/` for the other agents. For a user install, point them at the copy in your home folder. The pre-commit hook and CI only see a project install that's committed.

Agent hooks only see the files the agent edits. A framework page (`.tsx`, `.vue`, `.astro`, `.erb`) builds its JSON-LD at runtime, so it can't be checked from source. Check the built output instead, with the CI step or `node schema-check.mjs out/`, or check the running dev server: `node schema-check.mjs http://localhost:3000/`.

Hook formats checked against each vendor's docs on 19 Nov 2026.

| File | Where it goes | What happens on errors |
| --- | --- | --- |
| `claude-code-settings.json` | Merge into `.claude/settings.json` ([hooks](https://code.claude.com/docs/en/hooks)). | `PostToolUse` on Edit, Write and MultiEdit; exit 2 sends the errors to Claude. |
| `codex-hooks.json` | `.codex/hooks.json` ([hooks](https://learn.chatgpt.com/docs/hooks)), then trust it in `/hooks`. | `PostToolUse` on `apply_patch`; exit 2 sends the errors to Codex. |
| `cursor-hooks.json` | `.cursor/hooks.json` ([hooks](https://cursor.com/docs/hooks)). | `afterFileEdit`; the errors appear in Cursor's Hooks output. Cursor doesn't pass this hook's output to the agent. |
| `copilot-hooks.json` | `.github/hooks/schema-check.json` ([CLI hooks reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference)). | `postToolUse` on `edit` and `create`; the errors go back to Copilot as `additionalContext`. |
| `pre-commit` | `.git/hooks/pre-commit`, then `chmod +x` it. POSIX sh. | Lists the errors and stops the commit. It checks the files as they are on disk. |
| `github-actions.yml` | `.github/workflows/structured-data.yml`. Set your build command and output folder. | Fails the job. |
