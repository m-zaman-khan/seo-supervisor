# Setup mode: SEO for a site that has none

Use this for a site with no SEO work: brand new, or an old app that never got it. Setup works plan-first:

1. Map the site.
2. Propose a plan, then **stop for the owner's approval**.
3. Build the technical foundation exactly as planned.
4. Draft the content the owner still has to approve.
5. Prove the result with an audit.

Everything goes in the usual report, which gains a **Plan** tab.

**Core rule:** nothing in the project changes before the owner approves the plan. Nothing risky changes without its own yes. Nothing is ever invented.

## Pick up where the plan left off

Read `plan.status` in `seo-audit/seo-audit.json` first:

| `plan.status` | What `/seo-setup` does |
| --- | --- |
| No plan | Steps 1–3: understand, measure, propose. Then stop. |
| `proposed` | Show the plan and ask for approval. Apply any changes the owner asks for, re-render, and ask again. |
| `approved` | Steps 4–7: build, draft, verify, hand off. |
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
- If `docs/seo-profile.md` already exists, update that instead.

**Page level.** Write `plan.pages[]` (the shape is in `report-format.md`):
- **One row per key page:** the home page, any section parents, and the main product, service, tool or feature pages.
- **One pattern row for any set of more than 20 pages of one type** (posts, products, docs, cities). It holds `pattern`, `count`, title, description and H1 **templates**, and up to 3 `samples` with their resolved values. The owner approves the template, not thousands of titles.
- **Each row says what the agent will do.** Use `status`: `exists` if it's already right, `to-build`, or `to-create`. Give the planned `title`, `description`, `h1`, `schema`, `parent` and `linksTo`.
- **Anything the owner must supply goes in `owner`:** `{ "needs": "copy" | "facts" | "decision" | "yes", "what", "draft", "done": false }`.

**Target phrases.**
- Take them from what the site and the business actually offer, in the words a customer would search with. Use the owner's input too.
- Use a Search Console export or keyword CSV only if the owner gives one.
- Never state or invent search volumes, difficulty or rankings.
- Each row also gets an `intent`: who searches this, and what they want.

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

**Render, summarise, stop.**
- Set `plan.status: "proposed"` and render the report. It opens on the Plan tab.
- In chat, give a short summary: the site's shape, how many pages are planned and to be created, the "Needs your yes" items as a numbered list, and anything the owner must supply.
- Then ask: "Approve the plan? And yes or no to each numbered item?"
- Change nothing outside `seo-audit/` before the answer.

## 4. Build, after approval

Set `plan.status: "approved"` and `approvedOn`.

**Plan approval covers** the code-level foundation shown in the plan. Fix each thing once, in the shared place, using `frameworks/*.md` and `examples/snippets.md`:
- **Metadata:** one metadata helper with the title template. The planned titles, descriptions, H1s and canonicals go in code.
- **Sitemap and robots:** generated, and they respect the launch state. A live site keeps its current indexing state; a site that isn't live stays off behind its switch. Setup never switches indexing on.
- **Schema:** Organization and WebSite once, then the planned types per page. Only facts already on the site go into schema.
- **Headings and breadcrumbs:** one H1 per page and a clean heading order. Breadcrumbs with BreadcrumbList where the site has levels.
- **Internal links:** following the profile's linking rules.
- **Basics:** a real 404 for unknown URLs, a default share image and security headers. Add `security.txt` only once the owner has given a contact.
- **Missing parent pages:** create them now. Use the title, H1 and 1–2 sentence intro shown in the plan, built only from facts already on the site, plus a list of the pages under them.

**Items that got their own yes:** do them as well. On a CMS, write drafts and publish only when the owner says so.

**Everything else waits:** items without a yes stay as open `owner` items.

## 5. Draft the content the owner must approve

- **One draft per page:** for each row that needs copy, write `seo-audit/drafts/<slug>.md`. It holds an intro, a section outline, and FAQs based on real customer questions.
- **Facts:** use only facts from the site or the owner. Write anything missing as a visible placeholder, such as `[owner: a real customer result to quote]`. Never invent it.
- **Linking:** set the row's `owner.draft` to the file.
- **Creating the page:** new pages other than missing parents are created only after the owner approves their draft. On a CMS site, create them as CMS drafts, with the go-ahead.

## 6. Verify

- **Re-check everything:** re-crawl, re-audit, and run the project's tests and linters.
- **Confirm each row is live:** the crawler records each page's `title`, `description`, `h1Text`, `canonical` and `schema`. Compare them with the plan.
- **Statuses:** a row becomes `built` only when its re-check passes. A pattern row also records `built`, the number of pages done.
- **Findings:** baseline findings the build resolved become `fixed`, with `fixed.verified`, so the report shows the score before and after setup.
- **Plan status:** set `plan.status: "built"` once all of the agent's work is done. Owner items can still be open.

## 7. Hand off

In chat, give:
- the score before and after
- what was built
- what is still waiting for the owner (drafts to approve, facts to supply, yes items), with the score that work unlocks
- next steps: `/seo-fix` for remaining findings, and `/seo-launch` before indexing goes on

Then ask before committing `seo-audit/`.
