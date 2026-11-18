# `/seo-setup` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/seo-setup` mode that proposes an SEO plan for a site with no SEO, builds the technical foundation once the plan is approved, and shows everything on a new **Plan** tab of the existing report.

**Architecture:**
- **Plan rendering** lives in a new, focused module, `skills/seo-supervisor/scripts/report-plan.mjs`. It holds the stats, HTML, CSS and Markdown for the plan.
- **`render-report.mjs`** imports that module and adds the tab only when the audit JSON has a `plan`.
- **The agent's behaviour** (how to propose, approve, build and resume) is written as skill docs: `planning.md`, a "Setup mode" section in `SKILL.md`, and `commands/seo-setup.md`.
- **The crawler** gains two per-page fields so planned rows can be verified.

**Tech Stack:** Node 20+, zero dependencies, `node:test`, one offline HTML file.

**Spec:** `design/specs/2026-11-18-seo-setup-design.md`. Read it first; this plan argues from it.

## Global Constraints

- **Code:** zero dependencies; Node ≥ 20; the report stays one offline file (no external scripts, styles or fonts).
- **A report without `plan`** must render exactly as today: same tabs, and `docs/index.html` changes only through the sample data.
- **Safety rules unchanged:** audit never edits; owner-only work is **Needs you**; risky items each need their own yes ("Needs your yes"); setup never switches indexing on.
- **Works for any site:**
  - No services, areas or hub assumptions anywhere in the docs, tests or sample.
  - New pages are proposed only from evidence on the site, at most **10 per run**.
  - Templated sets of **more than 20** pages become one pattern row.
- **Commits:**
  - Identity: the repo's local config (`zamantiger1000@gmail.com`).
  - Messages must never mention AI, Anthropic, Claude or co-authors.
- **Design:** follow `design/DESIGN.md` tokens: `var(--…)` colours, Geist, Geist Mono for figures, light and dark, phone width, print, and no-JS.
- **Version:** **1.1.0** in `package.json` and `.claude-plugin/plugin.json`.

## Review Focus

1. **A plan with no `pages`, or an empty array.** The Plan tab shows an empty state; nothing crashes. *(Test in Task 2.)*
2. **A pattern row with `count: 0` or no `built`.** Progress stays a finite number, never `NaN`. *(Test in Task 2.)*
3. **Site text with `<`, `>`, `&` or quotes in plan fields** (titles, descriptions, targets). It must be escaped and never break the page. *(Test in Task 2.)*
4. **A proposed plan opened with `#findings` in the URL.** The hash still wins over the default tab. With no JavaScript and in print, the Plan panel shows like the others. *(Test in Task 3.)*
5. **Long URLs and titles at 390 px.** No horizontal page scroll; the table becomes cards. *(Visual check in Task 3, step 6.)*

---

### Task 1: Crawler records each page's description and H1 text

**Files:**
- Modify: `skills/seo-supervisor/scripts/seo-crawl.mjs:696` (the `pages: htmlPages.map(…)` output)
- Test: `test/crawl.test.mjs`

**Interfaces:**
- Produces: each `report.pages[]` item gains `description: string | null` and `h1Text: string | null` (the first H1's text).

- [ ] **Step 1: Add a failing assertion to `test/crawl.test.mjs`**, inside the existing crawl test:
```js
const home = report.pages.find(p => new URL(p.url).pathname === "/");
assert.equal(home.h1Text, "Free security tools");
assert.match(home.description, /^A perfectly reasonable description/);
```
- [ ] **Step 2:** `npm test`. Expected: FAIL (`h1Text` is undefined).
- [ ] **Step 3:** In the `pages` mapping, add `description: p.description, h1Text: p.headings.find(h => h.level === 1)?.text ?? null`.
- [ ] **Step 4:** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit:** `git commit -am "Crawler: record each page's description and H1 text"`

---

### Task 2: Plan module: stats, HTML, CSS and Markdown

**Files:**
- Create: `skills/seo-supervisor/scripts/report-plan.mjs`
- Test: `test/plan.test.mjs`

**Interfaces** (the plan JSON shape from the spec, plus decisions 1–3):
- `plan = { status: "proposed" | "approved" | "built", approvedOn?, summary?, yes?: [{ id, what, why?, approved: boolean }], pages?: Row[] }`
  - `yes[]` holds the site-level **Needs your yes** items, such as a host change or AI crawler policy.
- `Row` is one of two kinds:
  - **A single page:** `{ url, type, status, target?, secondary?: string[], intent?, title?, description?, h1?, schema?: string[], parent?, linksTo?: string[], from?, owner?, finding? }`
  - **A pattern:** `{ pattern, count, built?, samples?: [{ url, title?, description?, h1? }], …same fields }`
- `status` is `"exists" | "to-build" | "built" | "to-create"`.
- `owner` is `{ needs: "copy" | "facts" | "decision" | "yes", what, draft?, done: boolean }`.
- **Produces:**
  - `export function planStats(plan): { rows: number, byStatus: { exists, "to-build": n, built, "to-create" }, progress: number /* 0–100 integer */, ownerOpen: number, yesOpen: number }`
    - **progress:** each row is one unit. A row whose status is `exists` or `built` counts 1. A pattern row in any other status counts `built / count`, clamped 0–1, and 0 when `count` is 0 or missing. Any other row counts 0. Progress = round(100 × sum ÷ rows), and 0 when there are no rows.
    - **ownerOpen:** rows with `owner` and `owner.done !== true`.
    - **yesOpen:** `yes[]` items with `approved !== true`, plus rows whose `owner.needs === "yes"` and that aren't done.
  - `export function planHtml(plan, { esc, inl, num }): string`: the Plan panel's inner HTML.
  - `export const PLAN_CSS: string`
  - `export function planMarkdown(plan): string[]`: lines, starting with `## SEO plan`.

**Panel content, in this order:**
1. A summary line with the counts by status and the progress figure and bar (`role="img"` with an aria-label).
2. `plan.summary`.
3. The **Needs your yes** list, only when `yesOpen > 0`.
4. **Site structure:** an indented list built from `parent`. Rows whose parent isn't in the plan sit at the top level.
5. **A page table:** columns Page (url or pattern + `×count`), Targets, Type, Status chip, plus a **Needs you** label from the report's existing `.own` class.
   - Each row is a `<details>` that expands to show the title, description, H1, schema, parent, links, `from` → url, the owner's `what`, and a draft link (`href` = the draft path).
   - A status filter uses `<button aria-pressed>` like the findings toolbar. Its JS is added in Task 3.
6. An empty state when there are no rows: "No pages in this plan yet."

**Status chip labels:** Already right, To build, Built, To create.

- [ ] **Step 1: Write `test/plan.test.mjs`.** It imports the module directly and calls each function with tiny inline plans:
  - `planStats` on 4 single rows (exists, built, to-build, to-create) plus one pattern row (`count: 40, built: 10`, status `to-build`) → `rows === 5`, `progress === 45` (because (1 + 1 + 0 + 0 + 0.25) ÷ 5 = 0.45).
  - `planStats({ status: "proposed" })` → `{ rows: 0, progress: 0 }`. `planStats` on one pattern row with `count: 0` → `Number.isFinite(progress)`.
  - `ownerOpen`/`yesOpen`: one row with `owner: { needs: "copy", done: false }`, one with `owner: { needs: "yes", done: false }`, and `yes: [{ approved: false }, { approved: true }]` → `ownerOpen === 2`, `yesOpen === 2`.
  - `planHtml` with a row titled `<script>alert(1)</script> & "x"` → the output contains `&lt;script&gt;` and no `<script>alert`.
  - `planHtml` shows **Needs your yes** only when `yesOpen > 0`. The output contains `Needs you` for an open owner row, and `No pages in this plan yet` for an empty plan.
  - `planMarkdown` → the first line is `## SEO plan`, and there's one table row per plan row containing its url or pattern.
- [ ] **Step 2:** `npm test`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `report-plan.mjs`** with the four exports above. Use only the passed-in `esc`/`inl`/`num` for escaping and formatting. `PLAN_CSS` uses the existing tokens (`--panel`, `--line`, `--ink2`, `--mute`, `--pass`, `--blue`). Status chips get distinct but calm colours: `exists` mute, `to-build` blue, `built` pass, `to-create` ink2 outline. Below 560 px the table becomes stacked cards.
- [ ] **Step 4:** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit:** `git add skills/seo-supervisor/scripts/report-plan.mjs test/plan.test.mjs && git commit -m "Report: plan module with stats, Plan tab HTML and Markdown"`

---

### Task 3: Wire the Plan tab into the report

**Files:**
- Modify: `skills/seo-supervisor/scripts/render-report.mjs`:
  - the imports (line 11)
  - `const tabs` (line 339)
  - the tab buttons and panels (lines 614–622)
  - `route()` in the inline JS (line 591)
  - the CSS injection (`${CSS}`)
  - the Markdown builder (from line 632)
- Test: `test/render.test.mjs`

**Interfaces:**
- Consumes: `planStats`, `planHtml`, `PLAN_CSS`, `planMarkdown` from Task 2.
- **Produces, in the rendered HTML:**
  - When `raw.plan` exists, there's a tab with id `t-plan` and a panel with id `p-plan`, and the tab's count is `planStats(plan).rows`.
  - **Tab order:** if `plan.status === "proposed"` it's Plan, Overview, Findings…, and Plan is the default tab. Otherwise it's Overview, Plan, Findings…
  - **Default tab:** a `DEFAULT_TAB` value is passed into the JS. `route()` calls `show(DEFAULT_TAB)` when there's no hash, so an explicit hash still wins.
  - **Markdown:** `planMarkdown(plan)` lines are inserted after the area scores section.

- [ ] **Step 1: Add failing tests to `test/render.test.mjs`.** Write a temp JSON that is the sample plus `plan` with `status: "proposed"` and two rows; render it; then assert:
  - the HTML matches `/id="t-plan"[^>]*aria-selected="true"/`
  - `#p-overview` has the `hidden` attribute
  - the Markdown contains `## SEO plan`

  Also render the plain sample with its plan removed, and assert there's no `id="t-plan"`.
- [ ] **Step 2:** `npm test`. Expected: the new assertions fail.
- [ ] **Step 3: Implement the wiring.**
  - The status filter's JS toggles rows with `data-status`, in the same style as the findings filter.
  - Print and no-JS show the Plan panel like the other panels (existing `html:not(.js)` and `@media print` rules).
- [ ] **Step 4:** `npm test`. Expected: the renderer tests pass. The "demo is up to date" test may fail until Task 5 regenerates it. If so, run `npm run demo` now, because a plan-less report must be unchanged.
- [ ] **Step 5: Commit:** `git commit -am "Report: Plan tab, default tab for proposed plans, plan in the Markdown twin"`
- [ ] **Step 6: Visual check.** Render a report with a 6-row plan. Look at it at 1280 px and 390 px, in dark and light, and in print emulation. Confirm:
  - no horizontal scroll at 390 px (`documentElement.scrollWidth === clientWidth`)
  - the chips are readable in both themes
  - the Plan tab follows DESIGN.md
  - with a proposed plan, opening `…/seo-audit.html#findings` shows Findings, not Plan
  - with JavaScript disabled, and in print, the Plan panel is visible along with the others

  Fix anything that's off, then commit: `"Report: Plan tab layout fixes"`.

---

### Task 4: Setup mode in the skill, its rules and the command

**Files:**
- Create: `skills/seo-supervisor/planning.md`, `commands/seo-setup.md`
- Modify: `skills/seo-supervisor/SKILL.md` (the modes table, a new `### Setup mode` workflow section, links), `skills/seo-supervisor/report-format.md` (the `plan` schema)
- Test: `test/manifest.test.mjs`, `test/install.test.mjs`

**Interfaces:**
- `commands/seo-setup.md` frontmatter: `description: Set up SEO from scratch: propose a plan, build it after approval` and `argument-hint: "[url or notes]"`. The body invokes the **seo-supervisor** skill in **setup** mode with `$ARGUMENTS`, and says it stops for approval.
- **`planning.md` holds everything the spec puts under "Works for any kind of site", "How it works" steps 3–5, and decisions 1–6:**
  - The site-shape table, and the fallback to core rules.
  - **New pages only from evidence:** a missing parent path, an offering with no page, or a page a rule requires. At most 10 per run, ranked by intent value. Each proposal states its evidence.
  - **Pattern rows for sets of more than 20 pages,** with templates and up to 3 samples.
  - **Target phrases:** from the site, the business and the owner. Use a Search Console export or keyword CSV only if the owner gives one. Never state or invent search volumes.
  - **What plan approval covers,** versus the **Needs your yes** items (each needs its own yes).
  - **Missing parent pages** are created on plan approval, using only facts already on the site.
  - **Drafts** go to `seo-audit/drafts/<slug>.md`, with visible `[owner: …]` placeholders. New non-parent pages are created only after the owner approves the draft. On a CMS, they're created as drafts, with the go-ahead.
  - **The resume table** keyed by `plan.status` (decision 4), and the hand-off contents (spec step 7).
  - **The profile:** the draft goes to `seo-audit/seo-profile.draft.md` and moves to `docs/` on approval. If `docs/seo-profile.md` already exists, setup updates it.
  - **Before and after:** setup's baseline findings that the build resolves are set to `fixed`, with `fixed.verified`, so the existing before/after score shows.
  - **Indexing:** a live site keeps its current indexing state; a site that isn't live stays off.
- **`SKILL.md`:**
  - A mode row: `| **setup** | No SEO yet, "set up SEO", "SEO from scratch" | Only after the plan is approved | Same report, with a Plan tab |`
  - A short `### Setup mode` section that points to `planning.md`.
  - Keep `SKILL.md` lean.
- **`report-format.md`:** the `plan` schema and statuses exactly as in Task 2's Interfaces, and the progress rule.

- [ ] **Step 1: Update the tests first.**
  - `manifest.test.mjs`: the expected command list becomes `["seo-audit.md", "seo-fix.md", "seo-launch.md", "seo-review.md", "seo-setup.md"]`. Widen the "linked files exist" regex so it also covers root files such as `` `planning.md` ``.
  - `install.test.mjs`: `COMMANDS` gains `"seo-setup"`.
- [ ] **Step 2:** `npm test`. Expected: FAIL (`seo-setup.md` and `planning.md` missing).
- [ ] **Step 3: Write `planning.md`, `commands/seo-setup.md`, and the `SKILL.md` and `report-format.md` changes** as specified above.
- [ ] **Step 4:** `npm test`. Expected: pass. Also run `claude plugin validate .`. Expected: `✔ Validation passed`.
- [ ] **Step 5: Commit:** `git add -A && git commit -m "Add /seo-setup: planning rules, setup mode and the command"`

---

### Task 5: Sample plan, live demo, docs and version 1.1.0

**Files:**
- Modify:
  - `skills/seo-supervisor/examples/sample-audit.json` (add `plan`)
  - `docs/index.html` and the bundled sample, both through `npm run demo`
  - `README.md`, `CHANGELOG.md`, `package.json`, `.claude-plugin/plugin.json`
- Create: `docs/images/report-plan-dark.png`

**Interfaces:**
- **The sample plan** fits the existing sample site (a security-tools site, sample data). It has:
  - `status: "built"`
  - 6–8 rows: home (exists), the tools listing (built), a tools pattern row (`/tools/{slug}`, count 36, built 36), `/pricing` (built, with an open `owner` facts item), `/docs` (built; this was the missing parent), and `/security` (to-create, with an owner copy draft)
  - one `yes` item, already approved

- [ ] **Step 1:** Add the sample plan, then run `npm run demo`. `npm test` must pass, including the "demo is up to date" test.
- [ ] **Step 2: README:**
  - add `/seo-setup` to the commands table
  - add a short "Starting from zero?" section describing the plan → approve → build → drafts flow
  - add the Plan tab screenshot (taken from `docs/index.html#plan` at 1280×860, dark)
- [ ] **Step 3: CHANGELOG** `## 1.1.0 (2026-11-18)`:
  - the new command
  - the Plan tab
  - the crawler's new fields
  - set the version to 1.1.0 in `package.json` and `.claude-plugin/plugin.json`

  The manifest test checks they match.
- [ ] **Step 4:** `npm test` and `npm pack --dry-run`. Expected: tests pass, and the package lists `commands/seo-setup.md` and `skills/seo-supervisor/planning.md`.
- [ ] **Step 5: Commit:** `git add -A && git commit -m "Release 1.1.0: /seo-setup and the Plan tab"`

---

### Task 6: End-to-end check on a zero-SEO app (manual, outside the repo)

**Files:** none in the repo. The scratch app goes in `W:\Softaims\seo-skill-test\setup-demo` and is deleted afterwards.

- [ ] **Step 1:** Install the new version locally with `node bin/seo-supervisor.mjs`. Confirm that `~/.claude/commands/seo-setup.md` exists.
- [ ] **Step 2: Create a minimal Next.js app with zero SEO,** so that several different behaviours get exercised at once. It has:
  - `/`: a landing page with no metadata
  - `/pricing`
  - `/docs/install`, but no `/docs` (a missing parent)
  - `/dashboard`: an app screen "behind login"
  - a contact form that collects an email, with no privacy page

  Make a production build.
- [ ] **Step 3: Have a fresh agent run `/seo-setup` with no owner available.** Expected:
  - it stops at `proposed`
  - the report opens on the Plan tab
  - `/dashboard` is noindex by design
  - `/docs` is proposed as a missing parent
  - a privacy page is proposed (TRUST-03)
  - no services or areas pages are proposed
  - no files changed outside `seo-audit/`
- [ ] **Step 4: Resume as the owner** ("approved, and yes to Y1") with a fresh agent. Expected:
  - the foundation is built
  - `/docs` is created with only facts already on the site
  - the privacy page gets a draft with `[owner: …]` placeholders and is **not** created
  - indexing isn't switched on
  - the score goes up
  - the Plan statuses move to built
- [ ] **Step 5:** Fix any skill wording the run shows is unclear. Re-run the affected step, commit (`"Setup mode: clarify …"`), reinstall locally, then delete the scratch app.
