# Setup mode: SEO for a site that has none

Use this for a site with no SEO work: brand new, or an old app that never got it. Setup works plan-first:

1. Map the site.
2. Propose a plan, then **stop for the owner's approval**.
3. Build the technical foundation exactly as planned, then fix the audit's other code findings listed in the plan.
4. Draft the content the owner still has to approve. Every draft follows CONTENT-13 (plain language); re-read it against the writing notes before showing it.
5. Prove the result with an audit.

Everything goes in the usual report, which gains a **Plan** tab.

**Core rule:** nothing in the project changes before the owner approves the plan. Nothing risky changes without its own yes. Nothing is ever invented.

## Pick up where the plan left off

Read `plan.status` in `seo-audit/seo-audit.json` first:

| `plan.status` | What `/seo-setup` does |
| --- | --- |
| No plan | Steps 1–3: understand, measure, propose. Then stop. |
| `proposed` | Show the plan and ask for approval. Apply any changes the owner asks for, re-render, and ask again. |
| `approved` | Steps 4–8: build, fix, draft, verify, hand off. |
| `built` | Create the pages whose drafts the owner has approved, re-check them, then point to `/seo-audit` and `/seo-fix`. |

If no one can answer (for example a subagent run), stop at `proposed`. A proposed plan is a complete result.

## 1. Work out what the site is

Do SKILL.md step 1: framework, project rules, the content source, and the launch state checked on the real domain. Then decide the site's shape from the site itself: its routes, its content and what the business offers. Never start from a template of what a site "should" have.

| Site | What the plan looks like |
| --- | --- |
| **Single landing page** | One row: title, description, H1 and heading order, one schema type that fits (Organization, SoftwareApplication, Product, Event…), share image, performance basics, a one-URL sitemap and robots. No hubs. Usually no new pages. |
| **SaaS or web app** | The marketing pages that exist (home, features, pricing, docs). App screens behind a login are *noindex by design*. |
| **Blog or content site** | Home and the listing page, plus one pattern row for posts. Categories and author pages only if they exist. |
| **Online shop** | Category pages plus one pattern row for products. Product schema uses the real price and stock only. |
| **Portfolio or personal site** | Home, About and one pattern row for projects (Person, CreativeWork). |
| **Local or service business** | Its real services and locations. A location page only with real local proof. |
| **Tools site** | One pattern row for tools, plus the tools listing. |
| **Anything else** | The core rules in `rules/`, page by page or by pattern. |

Use the matching `site-types/*.md` file. If none matches, use the core rules only.

## 2. Measure

Crawl and run a content scan exactly as an audit does (SKILL.md step 2, pre-launch flags included), and write the baseline findings. These give the "before" score.

## 3. Propose the plan

**Site level.**
- Write the draft profile from `profile-template.md` to `seo-audit/seo-profile.draft.md`. It covers the brand and title template, origin, trailing slash, decisions, URL map, noindex-by-design, internal-linking rules and claims.
- If `docs/seo-profile.md` already exists, copy it to `seo-audit/seo-profile.draft.md` and edit the copy. Never touch `docs/` before approval.

**Page level.** Write `plan.pages[]` (the shape is in `report-format.md`):
- **One row per key page:** the home page, any section parents, and the main product, service, tool or feature pages.
- **One pattern row for any set of more than 20 pages of one type** (posts, products, docs, cities). It holds `pattern`, `count`, title, description and H1 **templates**, and up to 3 `samples` with their resolved values. The owner approves the template, not thousands of titles.
- **Each row says what the agent will do.** Use `status`: `exists` if it's already right, `to-build`, or `to-create`. Give the planned `title`, `description`, `h1`, `schema`, `parent` and `linksTo`.
- **Anything the owner must supply goes in `owner`:** `{ "needs": "copy" | "facts" | "decision" | "yes", "what", "draft", "done": false }`.
- **A missing parent page also gets `intro`:** its 1–2 sentence intro, built only from facts already on the site. The Plan tab shows it, so approving the plan approves exactly these words.

**Schema by business type.** The crawl's `businessType` guesses what the business is from the home page and the schema already there. `scripts/data/business-types.json` maps each guess to its schema.org type, key fields, the Google feature it can unlock and the usual mistakes. Use it to choose the business node's type and the rows' `schema`:
- **A `strong` guess:** plan that type, in place of a plain Organization or LocalBusiness.
- **A `weak` guess, or `none` on a business site:** don't pick. Show the owner the top 2 guesses (`guess` and the first of `alternatives`) and ask, as the home row's `owner` item (`needs: "decision"`).
- **Fields:** plan only the key fields the site already has facts for. `examples/snippets.md` (Business types) has the pattern for each.

**Target phrases.** Never guessed. Each one comes from a recorded source:
- **The site and the owner:** what the business actually offers, in the words a customer would search with, plus the owner's input.
- **Search Console:** when `seo-audit/` holds the Performance export, run `gsc-import.mjs` (SKILL.md step 2). Site-level queries are *suggested* phrases and are labelled as suggestions. A per-page export's queries belong to that page.
- **A keyword CSV,** only if the owner gives one.

Never state or invent search volumes, difficulty or rankings. Each row also gets an `intent`: who searches this, and what they want. Once the plan is approved, copy the phrases into the profile's "Target phrases" table (page, phrase, source), so later audits know them.

**Search intent.** With outside checks on and a web search tool available, check each planned page's phrase as `rules/search-intent.md` says (INTENT-01). If what ranks is a different kind of page, change the row's page type or its phrase. Without them, list intent under Limits.

**Topic clusters** (`strategy.md`) group the phrases and pages into hubs and spokes. They shape `linksTo` and the order of pages that already qualify. A cluster gap never becomes a plan row. It becomes a content opportunity (INTENT-05): a needs-decision finding with `fixBy: "owner"` that states its evidence.

**New pages, rarely, and only from evidence on the site:**
- **A missing parent:** the site's own URLs nest under a path with no page, e.g. `/docs/install` exists but `/docs` doesn't.
- **An offering with no page:** the home page lists three products, but only two have pages.
- **A page a rule requires:** for example, a privacy policy when the site collects personal data (TRUST-03).

At most **10 new pages per run**, ranked by how much each intent matters to the business. Each proposal states its evidence. A landing page or a small site will usually get none, and that's the right result. Never propose every service × every town: that's a doorway pattern (`site-types/local-business.md`).

**Needs your yes.** These never ride on plan approval. List them in `plan.yes[]` (site level) or as a row's `owner.needs: "yes"`, each with what and why:
- a host or trailing-slash change on a live site
- robots or noindex changes on a live site
- AI crawler policy
- any URL change on a live page (the row's `from`, with a redirect)
- any write to a CMS, including titles and descriptions stored there

On a live site, any robots.txt change beyond adding the `Sitemap:` line is a yes item.

**Record each answer.** A yes is `approved: true`. A no is `declined: true` (on the `yes[]` item, or on the row's `owner`). A declined item stays in the plan as a record and is never carried out.

**Code findings setup will also fix.**
- Put in `plan.alsoFixes` the IDs of the open findings the agent can fix in code: forms, results output, rendering, speed, headers and the like.
- Leave out `fixBy: "owner"` findings, needs-decision findings, anything on the "Needs your yes" list, and anything a plan row already covers.
- The Plan tab shows the list, so approving the plan approves these fixes.

**Render, summarise, stop.**
- Set `plan.status: "proposed"` and render the report. It opens on the Plan tab.
- In chat, give a short summary: the site's shape, how many pages are planned and to be created, how many audit findings setup will also fix, the "Needs your yes" items as a numbered list, and anything the owner must supply.
- Then ask: "Approve the plan? And yes or no to each numbered item?"
- Change nothing outside `seo-audit/` before the answer.

## 4. Build, after approval

Set `plan.status: "approved"` and `approvedOn`. On approval, move the draft profile to `docs/seo-profile.md`.

**Plan approval covers** the code-level foundation shown in the plan. Fix each thing once, in the shared place, using `frameworks/*.md` and `examples/snippets.md`:
- **Metadata:** one metadata helper with the title template. The planned titles, descriptions, H1s and canonicals go in code.
- **Sitemap and robots:** generated, and they respect the launch state. On a live site, robots.txt changes other than adding the `Sitemap:` line need their own yes. A live site keeps its current indexing state; a site that isn't live stays off behind its switch. Setup never switches indexing on.
- **Schema:** Organization and WebSite once, then the planned types per page. Only facts already on the site go into schema.
- **Headings and breadcrumbs:** one H1 per page and a clean heading order. Breadcrumbs with BreadcrumbList where the site has levels.
- **Internal links:** following the profile's linking rules.
- **Basics:** a real 404 for unknown URLs, a default share image and security headers. Add `security.txt` only once the owner has given a contact.
- **Missing parent pages:** create them now, with exactly the title, H1 and `intro` shown in the plan, plus a list of the pages under them. Never add copy the plan didn't show.

**Items that got their own yes:** do them as well. On a CMS, write drafts and publish only when the owner says so.

**Everything else waits:** items without a yes stay as open `owner` items.

## 5. Fix the audit's code findings

Run fix mode (SKILL.md step 5) on every finding in `plan.alsoFixes`, most serious first:
- Fix each cause once, in the shared place.
- Run the project's tests and linters after each batch.
- A finding becomes `fixed` only when its re-check passes (step 7).
- If a fix turns out to need the owner (content, a CMS write, a live URL or robots change), stop on that one, set `fixBy: "owner"`, and carry on with the rest.

## 6. Draft the content the owner must approve

- **One draft per page:** for each row that needs copy, write `seo-audit/drafts/<slug>.md`. It starts with the brief from `strategy.md` (Intent · Target and related phrases · Title and description · What's new here · Outline · Questions to answer · Facts needed from the owner · Internal links in and out), followed by the copy: an intro, the sections and FAQs based on real customer questions. The owner approves both with one yes.
- **Facts:** use only facts from the site or the owner. Write anything missing as a visible placeholder, such as `[owner: a real customer result to quote]`. Never invent it.
- **Linking:** set the row's `owner.draft` to the file.
- **Creating the page:** new pages other than missing parents are created only after the owner approves their draft. On a CMS site, create them as CMS drafts, with the go-ahead.

## 7. Verify

- **Re-check everything:** re-crawl, re-audit, and run the project's tests and linters.
- **Confirm each row is live:** the crawler records each page's `title`, `description`, `h1Text`, `canonical` and `schema`. Compare them with the plan.
- **Statuses:** a row becomes `built` only when its re-check passes. A pattern row also records `built`, the number of pages done.
- **Findings:** baseline findings the build resolved become `fixed`, with `fixed.verified`, so the report shows the score before and after setup.
- **Plan status:** set `plan.status: "built"` once all of the agent's work is done. Owner items can still be open.

## 8. Hand off

In chat, give:
- the score before and after
- what was built
- what is still waiting for the owner (drafts to approve, facts to supply, yes items), with the score that work unlocks
- next steps: `/seo-fix` for remaining findings, and `/seo-launch` before indexing goes on

Then ask before committing `seo-audit/`.
