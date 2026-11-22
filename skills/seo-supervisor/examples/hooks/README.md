# Structured data triggers (opt-in)

These run `scripts/schema-check.mjs` for you: after an agent edits a page, before a commit, or in CI. Nothing is installed by default. Copy the ones you want.

The Claude Code plugin already runs this check after each edit (its `hooks/hooks.json`), next to the guard, so plugin users need none of these for Claude Code. `claude-code-settings.json` is for a Claude Code install without the plugin.

Each one stays silent when the JSON-LD passes and only looks at `.html`, `.htm`, `.jsonld` and `.json` files that contain JSON-LD. Errors are unknown types or properties, wrong value shapes and missing Google-required properties. Warnings are never shown here; run the checker by hand to see them.

The paths assume a project install (`npx seo-supervisor --scope project`): `.claude/skills/seo-supervisor/` for Claude Code, `.agents/skills/seo-supervisor/` for the other agents. For a user install, point them at the copy in your home folder. The pre-commit hook and CI only see a project install that's committed.

Agent hooks only see the files the agent edits. A framework page (`.tsx`, `.vue`, `.astro`, `.erb`) builds its JSON-LD at runtime, so it can't be checked from source. Neither can a template `.html` file (Hugo, Jekyll, Django/Jinja, Eleventy, Liquid, ERB) whose JSON-LD holds template tags (`{{`, `{%`, `{#`, `<%`): the checker reports that block as a note, "templated; check the built output", and never fails on it. Check the built output instead, with the CI step or `node schema-check.mjs out/`, or check the running dev server: `node schema-check.mjs http://localhost:3000/`.

Hook formats checked against each vendor's docs on 19 Nov 2026, and Codex's and Copilot's again on 23 Nov 2026.

| File | Where it goes | What happens on errors |
| --- | --- | --- |
| `claude-code-settings.json` | Merge into `.claude/settings.json` ([hooks](https://code.claude.com/docs/en/hooks)). | `PostToolUse` on Edit, Write and MultiEdit; exit 2 sends the errors to Claude. |
| `codex-hooks.json` | `.codex/hooks.json` ([hooks](https://learn.chatgpt.com/docs/hooks)), then trust it in `/hooks`. Its `commandWindows` line replaces `command` on Windows, where Codex runs hooks through cmd; it finds the skill from the folder Codex starts in, with no git. | `PostToolUse` on `apply_patch`; exit 2 sends the errors to Codex. |
| `cursor-hooks.json` | `.cursor/hooks.json` ([hooks](https://cursor.com/docs/hooks)). | `postToolUse` on `Write`; the errors go back to the agent as `additional_context`. |
| `copilot-hooks.json` | `.github/hooks/schema-check.json` ([CLI hooks reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference)). Its `"cwd": "."` runs it from the repository root, so the relative path works when Copilot starts in a subfolder. | `postToolUse` on `edit`, `create`, `str_replace_editor` and `apply_patch`; the errors go back to Copilot as `additionalContext`. The checker doesn't yet read the file names in a Copilot `apply_patch`, so those edits pass unchecked. |
| `pre-commit` | `.git/hooks/pre-commit`, then `chmod +x` it. POSIX sh. | Lists the errors and stops the commit. It checks the files as they are on disk. |
| `github-actions.yml` | `.github/workflows/structured-data.yml`. Set your build command and output folder. | Fails the job. |

## Reading ease in CI (opt-in)

`reading-ease.yml` goes in `.github/workflows/`. It runs `scripts/checks/writing.mjs` on the built site, lists every English page with its Flesch reading ease (0 to 100, higher is easier), and fails the job when a page scores below the pass mark you pick with `--min` (default 60, where Flesch's 1948 table moves from "standard" to "fairly difficult").

It's SEO Supervisor's own check, not Google's, and it never changes the audit score. It reads the page's `<main>` (or the body without header, nav, footer and aside), only its paragraphs, and leaves out code and tables. Pages in other languages, and pages under 100 words, are skipped. Run it by hand the same way: `node scripts/checks/writing.mjs dist --min 60`.
