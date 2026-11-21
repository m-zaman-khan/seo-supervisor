# Search intent and performance (INTENT)

> Intent findings rest on what was observed, never on a guess. Each one names its source: the search engine and date the results were looked at, or the Search Console export and its period. **Medium at most**, because the agent's search tool may not be Google, and rankings move. Never state search volumes, difficulty or rankings you didn't observe.

> Target phrases come only from a recorded source: the last approved plan's `target`, the approved profile's "Target phrases" table (a draft profile doesn't count), or a page's own Search Console export. Pages without one are skipped and counted under Limits. INTENT-01 needs outside checks on (the phrase goes to a search provider); INTENT-02 to 04 come from `gsc-import.mjs`, which reads local files only.

### INTENT-01 · The page type matches what ranks · medium
- **Check:** for each key page with a recorded target phrase, search the phrase and record the engine, the date and the type of each of the top 10 results (guide, service page, landing page, hybrid, product, category, tool, local listing, forum, video), plus the search features shown. Method: `strategy.md`.
- **Pass:** the page is the kind of page most top results are. A product page aiming at a phrase where guides rank, or a blog post aiming at a phrase where product listings rank, fails. Where guides and service pages share the results, a hybrid page (service plus education, `page-types.md`) passes.
- **One page:** when the owner names a single URL, run this check for that page alone and add the wireframe: `strategy.md`, "One page".
- **Fix:** change the page to fit the intent (add the guide content, or the comparison table), or aim it at a phrase whose results match what it is. Content changes are the owner's call: set `fixBy: "owner"`.
- **Never** from the phrase's words alone: an intent read from words like "how" or "best" is a guess for planning, never evidence for this finding.

### INTENT-02 · One page per query · medium
- **Check:** `gsc-import.mjs` with per-page exports: two or more of the site's pages getting impressions for the same query.
- **Pass:** each important query has one clear page. Brand queries and the home page are usually fine.
- **Fix:** choose the page that should rank, make it the best answer, link the others to it with that phrase, and merge or refocus overlapping pages (`fixBy: "owner"` when it removes or merges pages).

### INTENT-03 · A low click rate gets a better snippet · low
- **Check:** `gsc-import.mjs`: pages with 100+ impressions whose CTR is under half the site's median at a similar position.
- **Pass:** titles and descriptions tell searchers what the page gives them, in their words.
- **Fix:** rewrite the title and description from the page's top queries. Keep them true to the page; never promise what it doesn't have.

### INTENT-04 · Pages almost on page one get attention first · low
- **Check:** `gsc-import.mjs`: average position 8–20 with 50+ impressions.
- **Pass:** these pages are worked on before pages with no impressions.
- **Fix:** add internal links from related pages (code, the agent can do it). Content changes are the owner's: set `fixBy: "owner"` and suggest matching the main query's intent; comparing with what the top results cover needs outside checks on.

### INTENT-05 · Content opportunities are the owner's decision · needs-decision
- **Check:** topic clusters (`strategy.md`): a group of queries or phrases with evidence of demand and no page that answers it. Evidence is required, e.g. "Search Console: 1,200 impressions for 'flatbed towing cost', no page about cost".
- **Pass:** each gap is reported once, as a decision with `fixBy: "owner"`, stating its evidence.
- **Fix:** never create a page from a gap on your own. The owner decides; if they say yes, `/seo-brief` writes the brief.
