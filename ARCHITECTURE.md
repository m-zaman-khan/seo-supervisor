# Architecture

SEO Supervisor is a skill for coding agents: Markdown instructions the agent follows, plus Node scripts it runs.
- There's no server and no build step.
- Everything runs from source on Node 22+, with no runtime dependencies.

## The flow

An audit has three steps:

1. **Crawl.** `scripts/seo-crawl.mjs` fetches the site (a local dev server by default), reads each page and runs the checks. It writes `seo-audit/seo-crawl.json`, holding the pages, findings, passed rules and notes.
2. **Judge.** The agent follows `SKILL.md` and the rule files to review what a crawler can't decide: the code behind each finding, content quality, and choices only the site owner can make.
3. **Report.** `scripts/render-report.mjs` turns the audit into one offline HTML file, plus a Markdown copy, in `seo-audit/`.

The fix, review, launch and other modes reuse the same crawl and report.

## Codemap

### `bin/`

The npm entry point, `seo-supervisor.mjs`. It installs the skill into each coding agent, along with whatever that agent supports besides skills: the `/seo-*` commands, the subagents and the guard hooks.
- `agents.mjs` says where each agent keeps these.
- `extras.mjs` writes them in each agent's own format.

### `skills/seo-supervisor/`

The skill itself. Agents copy it as one folder.

- **`SKILL.md`:** the workflow the agent follows, mode by mode.
- **`rules/`:** one file per area. Each rule has an ID (like `MAP-03`), a severity, how to check it, how to fix it, and its source.
- **`site-types/`, `frameworks/` and the other guides:** extra rules per kind of site, and how to apply fixes per framework.
- **`scripts/`:** everything the agent runs.
  - **`seo-crawl.mjs` and `crawl/`:** fetching, the page queue, reading a page (`crawl/page.mjs`), and the catalog of finding IDs and severities (`crawl/catalog.mjs`).
  - **`checks/`:** one module per area: technical, content, links, structured data, speed, AI crawlers, local businesses, security and more. Each one reads the crawled pages and adds findings.
  - **`render-report.mjs` and `report/`:** one module per tab, the Overview's panels in `report/panels/`, and `report/panel.mjs`, which draws each panel as both HTML and Markdown so the two never drift.
  - **`guard.mjs` and `guard/`:** the guard.
    - `guard/rules.mjs` decides allow, ask or deny for an action.
    - `guard/adapters/` translates each agent's hook format.
    - `guard.mjs` is what the hooks run.
  - **`keys/` and `google/`:** the optional connections (Search Console, Analytics, Bing and others).
  - **`lib/`:** shared helpers: arguments, HTTP, the private-address guard, HTML reading and findings.
  - **The other top-level scripts** are single tools: the content scan, the schema check, the log scan, comparing two audits, and so on. Each prints its usage with `--help`.
- **`examples/`:** a sample audit and its rendered report, plus opt-in hook examples.

### Plugin files

- `commands/`: the `/seo-*` slash commands.
- `agents/`: the `seo-auditor` and `seo-reviewer` subagents.
- `hooks/hooks.json`: the guard and schema-check hooks for Claude Code.
- `.claude-plugin/`: the plugin and marketplace manifests, and the icon.

### `test/`

`node:test` suites, one file per feature.
- `test/fixture-site/` is a small site with one planted problem per checked rule.
- `test/golden/` holds snapshot outputs.
- `test/browser/` holds the tests that need Chrome, which run separately with `npm run test:browser`.

### `docs/` and `assets/logo/`

- `docs/` is the project site, served by GitHub Pages. `docs/index.html` is the sample report.
- `assets/logo/` holds the logo sources and the script that renders its PNGs.

## Rules that hold everywhere

- **No runtime dependencies.** The scripts use Node's standard library only. TypeScript is a dev dependency, used only to type-check the files marked `// @ts-check`. Nothing is compiled.
- **Nothing leaves the machine without a yes.** The crawl talks only to the site you point it at. Outside services (PageSpeed, Google, Bing and the rest) run only with `--outside`, a connected key, or a command you run. The one exception is a weekly npm version check, which can be turned off.
- **The guard fails open.** If the guard itself errors, it answers "allow" in the agent's own format, so a bug in the guard never blocks your work.
- **Information never moves the score.** Findings have a severity and count towards the score. Notes and information-only data are shown, but never scored.
- **Tests run offline.** `npm test` loads `test/offline.mjs`, which refuses any outside connection, DNS lookup or browser start.

## Why the scripts live inside the skill

The Agent Skills format keeps a skill's scripts next to its `SKILL.md`, so the skill still works when an agent copies the folder on its own. That's why there's no top-level `src/`.
