# `/seo-setup`: SEO from scratch — design

Status: ready for owner approval · 18 Nov 2026 · reviewed by an independent builder check

## Intent

Some sites have had no SEO work at all. They are either brand new, or an old app that never got it. On such a site, `/seo-audit` returns 50–60 findings ("no title", "no sitemap", "no schema"…), and `/seo-fix` patches them one by one with no blueprint. The result is overwhelming for the owner and inconsistent in the code.

`/seo-setup` works plan-first:

1. It maps the whole site.
2. It proposes an SEO plan: which pages exist or should exist, what each one targets, and how they link.
3. It waits for the owner to approve the plan.
4. It builds the technical foundation exactly as planned.
5. It drafts content for the owner to approve.
6. It proves the result with an audit.

All of this lives in the report people already use, on a new **Plan** tab.

## Goals

- **One new command, `/seo-setup`.** As a plugin it appears as `/seo-supervisor:seo-setup`. It works for any framework (through `frameworks/*.md`) and any site type (through `site-types/*.md`).
- **Plan before code.** Nothing in the project changes until the owner approves the plan.
- **After approval, the agent builds the technical foundation itself.** That means metadata, canonicals, the sitemap, robots, schema, headings, breadcrumbs and internal links.
- **A content plan:**
  - which pages should exist
  - the target search phrase for each
  - a drafted title, description and H1
  - the content each page still needs

  Body copy is drafted and labelled **Needs you**.
- **One report.** The Plan tab sits alongside the score and findings, and the score shows before and after setup.

## Non-goals

- **Keyword research with search volumes.** There are no paid APIs. Target phrases come from the business, the site's own content and the owner. If the owner provides a Search Console export or a keyword CSV, the plan uses it.
- **Writing and publishing body copy or new pages without the owner's approval.**
- **Off-site SEO:** backlinks, Google Business Profile, citations. These are listed as owner steps.
- **Replacing audit or fix.** After setup, the normal `/seo-audit` → `/seo-fix` → `/seo-review` → `/seo-launch` cycle takes over.

## Anti-goals (failures even if everything "works")

- **Mass-producing pages,** such as every service × every town. That's the doorway and scaled-content pattern the skill already warns against. A new page is proposed only for a distinct search intent. A location page is proposed only where the owner can supply real local proof.
- **Inventing anything,** in copy or schema: facts, claims, reviews, ratings, prices or search volumes.
- **Changing CMS content, page visibility or production indexing without the owner's go-ahead.** The existing fix-mode rules apply unchanged.
- **Changing the URL of a live, indexed page without a redirect plan and approval.**
- **A plan too long to read.** The plan is prioritised, and new-page proposals are capped (see "Left to the builder").

## Constraints

- **Same stack as today:** zero dependencies, Node 20+, and one offline HTML report from the existing renderer.
- **Existing safety rules stay as they are:** an audit never edits, fixes need re-checks, and owner-only work is `fixBy: "owner"` / **Needs you**.
- **Finding IDs stay stable across runs.** The existing score model is unchanged.

## Works for any kind of site

Setup never assumes a structure. The plan follows the site's **own** shape: its routes, its content and what the business offers. It never follows a template of what a site "should" have.

- **Step 1 decides what the site is,** from the site itself. It uses the matching `site-types/*.md` file. If none match, it applies only the 107 core rules, which work for any site.
- **Sections, hubs, locations and services exist in the plan only if the site has them,** or its own URLs nest under them.

| Site | What the plan looks like |
| --- | --- |
| **Single landing page** | One row: title, description, H1 and heading order, one schema type that fits (Organization, SoftwareApplication, Product, Event…), share image, performance basics, a one-URL sitemap and robots. No hubs. Usually no new pages. |
| **SaaS / web app** | The marketing pages (home, features, pricing, docs, if they exist) get rows. App screens behind a login are *noindex by design*. Docs get a pattern row if there are many. |
| **Blog or content site** | Home and the listing page, plus one pattern row for posts (title and description templates, Article schema). Categories and author pages only if they exist. |
| **Online shop** | Category pages plus one pattern row for products (Product schema with the real price and stock, never invented). |
| **Portfolio or personal site** | Home, About and one pattern row for projects (Person, CreativeWork). |
| **Local or service business** | Services and locations, but only the ones the business really has. A location page only with real local proof. |
| **Tools site** | One pattern row for tools, plus the tools listing. |
| **Anything else** | Core rules only, page by page or by pattern. |

**New pages are proposed rarely, and only from evidence on the site:**
- **A missing parent page:** the site's own URLs nest under a path with no page, e.g. `/docs/install` exists but `/docs` doesn't. That's a broken breadcrumb level.
- **Something the business offers but has no page for:** for example, the home page lists three products but only two have pages.
- **A page a rule requires:** for example, a privacy policy when the site collects personal data (TRUST-03).

A landing page or a small site will usually get zero new-page proposals, and that's the right result. The cap still applies.

## Approaches (decided with the owner)

**Where the plan lives:**
1. *Audit + fix only, no new command.* Rejected: the plan gets buried in a long problem list, and fixes have no blueprint.
2. *A new command with a separate plan document.* Rejected: it's a second place to look.
3. ✅ *A new command whose plan is a **Plan tab in the same report**.* Chosen: one place for plan, score and findings, and setup's progress shows in the report people already use.

**How far "implement SEO" goes:**
- **A.** Technical foundation only. Rejected: no content plan.
- **B.** ✅ Foundation plus a content plan, with drafted copy that is labelled **Needs you** and goes live only after approval. Chosen.
- **C.** Full build, where the agent writes and publishes pages. Rejected: invented copy at scale is what search engines penalise, and it breaks the safety promise.

## How it works

1. **Understand.** This is the same as audit step 1: framework, site types, project rules, the content source, and the launch state checked on the real domain. If `docs/seo-profile.md` already exists, setup updates that plan instead of starting over.
2. **Measure.** Crawl and run a content scan as an audit does (pre-launch flags where needed). Record the baseline findings.
3. **Propose the plan, then stop.**
   - **Site level:** a draft `docs/seo-profile.md` from `profile-template.md`. It covers the brand and title template, origin, trailing slash, decisions, URL map patterns, hubs, noindex-by-design, internal-linking rules and claims.
   - **Page level:** `plan.pages[]` (format below). It covers every existing indexable page plus the proposed new ones.
   - **New-page rule:** only from evidence on the site (see "Works for any kind of site"). Each proposal says the intent and its evidence. If the site has no nested sections, there are no hubs.
   - **Report and approval:** render the report with the Plan tab open first, show a summary in chat, and ask for approval. The owner can approve as is, or change things in chat ("change /about's target", "drop /areas/plano", "use www"). Re-render after each change.
   - **If no one can answer** (for example a subagent run): stop here with the plan proposed. That's a complete, useful result.
4. **On approval, build the foundation.** Code only, fixed once in the shared place, using `frameworks/*.md` and `examples/snippets.md`:
   - **Metadata:** one metadata helper with the title template. Titles, descriptions, H1s and canonicals come from the approved plan. Approving the plan approves these, because they are shown in it.
   - **Sitemap and robots:** generated, and they respect the launch state. Setup never switches indexing on.
   - **Schema per page type:** Organization and WebSite once, then the plan's types per page. Only facts already on the site go into schema.
   - **Headings and breadcrumbs:** one H1 per page (the approved H1), heading order, and breadcrumbs with BreadcrumbList.
   - **Internal links:** hubs, plus related links per the linking rules in the profile.
   - **Basics:** a real 404 for unknown URLs, a default share image, security headers, and `security.txt`. A missing security contact becomes **Needs you**.
5. **Content drafts.**
   - **Where drafts go:** for each page that needs copy, write `seo-audit/drafts/<slug>.md`: an intro, a section outline, and FAQs based on real customer questions.
   - **What drafts may contain:** only facts from the site or from the owner. Missing facts are written as visible placeholders, like `[owner: a real customer result to quote]`, never invented.
   - **Labelling:** these pages are **Needs you** in the plan.
   - **Creating pages:** a new page is created only after the owner approves its draft. On a CMS site it's created as a CMS draft, with the go-ahead, under the existing rules.
6. **Verify.**
   - **Re-check:** re-crawl, re-audit, and run the project's tests and linters.
   - **Statuses:** plan rows move to `built` only when the re-check passes. Setup's baseline findings that are now resolved become `fixed`, so the report shows the score before and after setup.
7. **Hand-off in chat:**
   - the score before and after
   - what was built
   - what needs the owner, with the score that work unlocks
   - next steps: `/seo-fix` for remaining findings, `/seo-launch` before indexing goes on

## Decisions from the design review

**1. What plan approval covers.** This was decided by the owner in conversation: changes the owner doesn't see must not happen.
- **Covered by one plan approval:** the code-level foundation, as shown in the plan. That means titles, descriptions, H1s and canonicals *in code*, plus schema, the sitemap, headings, breadcrumbs and internal links.
- **Not covered:** risky items get their own section in the chat summary and on the Plan tab, **"Needs your yes"**. They are:
  - a host or trailing-slash change on a live site (it redirects every URL)
  - robots or noindex changes on a live site
  - AI crawler policy
  - any URL change on a live page
  - any write to a CMS, including titles and descriptions stored there

  Each needs an explicit yes. The owner can give several in the same reply ("approve the plan, and yes to 1 and 3"). Until then those rows stay `needs-you`.
- **CMS sites:** metadata is written as CMS drafts, and published only when the owner says so. That's the existing fix-mode rule.
- **URL changes:** a row can carry `from` (the old URL). A redirect is part of building that row.

**2. Large and templated sites** *(builder's call)*.
- **Key pages get their own row:** the home page, hubs, and the main service, product and tool pages.
- **Templated sets get one pattern row** when there are more than 20 pages of a type, such as products, cities or posts. A pattern row holds:
  - `pattern` (e.g. `/blog/{slug}`) and `count`
  - title, description and H1 **templates**
  - up to 3 sample URLs with their resolved values

  The owner approves the template, not 5,000 titles. Progress counts pattern rows by pages built ÷ `count`.

**3. Status** *(builder's call)*. A row has two independent things:
- **`status`, for the agent's work:** `exists`, `to-build`, `built` or `to-create`.
- **`owner`, for the owner's part** (optional): `{ "needs": "copy | facts | decision | yes", "what": "…", "draft": "drafts/x.md", "done": false }`. It shows as **Needs you** while `done` is false. It replaces the `needs-you` status and `fixBy` on rows.

How the counts work:
- **Progress** = rows whose agent work is done (`exists` + `built`) ÷ all rows with agent work.
- **`plan.status` becomes `built`** when all agent work is done. Owner items can still be open; the hand-off lists them, with the score they unlock.

**4. Across sessions** *(builder's call)*. `/seo-setup` picks up from `plan.status` in `seo-audit/seo-audit.json`:

| `plan.status` | What `/seo-setup` does |
| --- | --- |
| No plan | Proposes one |
| `proposed` | Shows it and asks for approval, applying any changes first |
| `approved` | Builds |
| `built` | Creates the pages whose drafts the owner has approved, then points to `/seo-audit` and `/seo-fix` |

- A build run ends after writing the drafts. Page creation happens when the owner says the drafts are approved, in the same session or a later one.
- **Source of truth:** `plan` in `seo-audit.json` holds the page rows, and the profile holds site-level decisions. They're written together.

**5. Missing parent pages** *(decided by the owner, 18 Nov 2026)*. This applies only when the site's own URLs nest under a path that has no page, e.g. `/docs/install` with no `/docs`. The plan shows that parent page's title, H1, a 1–2 sentence intro (only from facts already on the site) and the pages it will list. Approving the plan creates it, because every word was shown. If the site has no such gap, nothing is created.

**6. The Markdown twin** *(builder's call)*. It's read-only output, like the rest of `seo-audit.md`. There's no parser. The owner gives changes in chat, and the agent updates the JSON and re-renders.

**Also settled:**
- The draft profile goes to `seo-audit/seo-profile.draft.md`, and moves to `docs/` on approval (the existing rule).
- Setup keeps a live site's indexing state as it is. A site that isn't live stays off, behind its switch.
- The crawler will also record each page's meta description and H1 text, so rows can be verified.
- The live demo's plan is `built` with a few owner items, so the demo opens on Overview with the Plan tab next to it.

## Report changes

### JSON (`report-format.md`): a new optional top-level `plan`

```json
"plan": {
  "status": "proposed | approved | built",
  "approvedOn": "2026-11-18",
  "summary": "One paragraph: the structure and what setup will do.",
  "pages": [
    {
      "url": "/pricing",
      "type": "Pricing page",
      "status": "exists | to-build | built | to-create",
      "target": "acme invoicing pricing",
      "secondary": ["invoicing software cost"],
      "intent": "Someone comparing plans before signing up",
      "title": "Pricing | Acme Invoicing",
      "description": "…",
      "h1": "Simple pricing for every team",
      "schema": ["WebPage", "BreadcrumbList"],
      "parent": "/",
      "linksTo": ["/features", "/signup"],
      "owner": { "needs": "facts", "what": "Confirm the current plan prices", "done": false },
      "finding": "F-004"
    }
  ]
}
```

**Statuses:**
- `exists`: already right, nothing to do.
- `to-build`: the agent will do it after approval.
- `built`: done and re-checked.
- `to-create`: a proposed new page.

The owner's part of a row is a separate `owner` field, which shows as **Needs you** (see decision 3).

### HTML

- **When there's no `plan`,** the report is exactly as today.
- **When there is a `plan`,** a **Plan** tab appears and is selected first while `plan.status` is `proposed`. It has:
  - **A summary line:** counts by status and a progress bar (built ÷ planned).
  - **A site structure:** hubs → children as an indented list, so the hierarchy is visible at a glance.
  - **A page table:** URL, target phrase, page type, status chip, and Needs you where it applies. A row expands to show the title, description, H1, schema, parent, links, the content still needed, and a link to the draft file. It can be filtered by status. On phones, rows become cards.
- **Styling:** everything follows `design/DESIGN.md` (tokens, type, light and dark, print and no-JS fallbacks).

### Markdown twin

A `## SEO plan` section with the summary and one table row per page. It includes every field so it can be edited and re-fed.

### Score

The model doesn't change. "Before setup" uses the existing before-this-run mechanism, through setup's resolved findings.

## Files that change

| File | Change |
| --- | --- |
| `commands/seo-setup.md` | New command: invokes the skill in setup mode with `$ARGUMENTS` |
| `skills/seo-supervisor/SKILL.md` | A mode row and a "Setup mode" workflow step, kept short |
| `skills/seo-supervisor/planning.md` | New: rules for proposing pages, target phrases, intents, drafts and the cap |
| `skills/seo-supervisor/report-format.md` | The `plan` schema and statuses |
| `skills/seo-supervisor/scripts/render-report.mjs` | The Plan tab and the Markdown section |
| `skills/seo-supervisor/examples/sample-audit.json` | A sample `plan`, so the live demo shows the tab |
| `test/*.test.mjs` | Renderer tests with and without a plan. Manifest and installer tests expect 5 commands |
| `README.md`, `CHANGELOG.md`, `package.json`, `.claude-plugin/plugin.json`, `docs/index.html` | The new command, version 1.1.0, and the regenerated demo |

## Testing

- **CI:**
  - Renderer tests check the tab is present when there's a plan and absent without one, plus the status counts, the progress figure, Needs you labels, the Markdown section, and offline output.
  - The manifest and installer tests cover the new command.
- **Manual end-to-end** (as for audit and fix), on a scratch app with zero SEO outside the repo. A fresh agent runs `/seo-setup`. Check that it:
  - stops for approval
  - builds only after approval
  - writes drafts with placeholders instead of invented facts
  - never flips indexing
  - raises the score

## Left to the builder

- The exact visual design of the Plan tab within the DESIGN.md system.
- The cap on new-page proposals per run. Suggested: at most 10, prioritised by intent value.
- The wording of the chat summary and the approval prompt.
- The scratch app used for the manual end-to-end test.
