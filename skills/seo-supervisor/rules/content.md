# Headings and content (CONTENT)

### CONTENT-01 · Exactly one H1 per page · high
- **Check:** crawler `h1-count`.
- **Pass:** one H1 that states the page's main topic. Logos, card titles and modal titles are not H1s.
- **Site-wide:** when the H1 is missing on at least 80% of indexable pages (and at least 3), the crawler reports one `*-sitewide` finding as a **blocker**, not one high per page. Keep it a blocker: it's the usual sign of a site with no SEO work.

### CONTENT-02 · Heading levels are never skipped · medium
- **Check:** crawler `heading-skip`. Footer and sidebar headings count too.
- **Fix:** nest H2 → H3 in order and style with CSS. Card titles inside an H2 section use H3 or non-heading text. Each FAQ question is an H3 under the FAQ H2. A full outline is in `examples/snippets.md`.

### CONTENT-03 · The main keyword sits in the title, H1, first paragraph and one H2 · medium
- **Check:** code/content: for key templates, read the rendered page.
- **Pass:** the keyword is used naturally with variants (no density targets above about 2–3%). Each page has one primary keyword, and no two pages share it.
- **Fix:** record the keyword per page in the content data; one page owns each phrase.
- **Keyword cannibalization isn't a penalty.** Google has no policy on it. Several URLs showing for one query is often fine. Flag it only when near-duplicate pages target the **same intent**; fix by merging with a 301 or a canonical, or by giving each page a distinct purpose.

### CONTENT-04 · Templated pages have unique content · high (blocker when it covers most of the site)
- **Check:** crawler `near-duplicate` (5-word shingles, more than 60% shared), `title-dup`, `desc-dup`. Code: templates that only swap a city, product or tool name, and FAQ answers reused across pages.
- **Pass:** each page has its own intro, specifics and FAQs. FAQ questions aren't reused across pages. Pages that can't be made unique are merged or noindexed.
- **Fix:** add per-item content fields and a build check (shingle similarity over 0.5 on intros fails; any repeated FAQ question fails). Don't publish a page until its unique fields are filled.

### CONTENT-05 · Indexable pages have substance · medium
- **Check:** crawler `thin-page`, which flags pages under 150 words as a page to look at, not a word target. A short page that fully does its job (a contact page, a calculator, a product with a clear spec) is fine; say so and close the finding rather than adding filler. Chinese, Japanese, Thai, Lao, Khmer and Burmese text is counted in words with Intl.Segmenter, so this check and `near-duplicate` work there too.
- **Fix:** add useful, specific content; merge the page into a stronger one; or noindex it until it grows (browse pages: under 3 items).

### CONTENT-06 · Answer first, in the searcher's words · medium
- **Check:** content: guides, tool pages, FAQs.
- **Pass:** an answer of 40–60 words right under the H1 and under each question-form H2, using specific numbers and no vague "it". Tables for comparisons, numbered steps for processes. Questions come from "People also ask", support tickets and top-ranking pages.

### CONTENT-07 · People and dates are behind the advice · medium
- **Check:** content and code: author or reviewer lines, author pages, "updated" dates on guides and advice pages.
- **Pass:** a named author or reviewer with real credentials and an author page, and a visible "last reviewed" date. Tool and service pages count too: "Reviewed by {name}, {credential} · Updated {date}". YMYL topics (health, money, security, legal) cite primary sources.
- **Author pages** (`/about/team/{name}/` or similar) list role, certifications (e.g. OSCP, CISSP, licences), GitHub or portfolio, talks and publications, and credited work (e.g. CVEs). They use ProfilePage + Person schema and are linked from every byline and "Reviewed by" line.
- **Review on a schedule:** every 6–12 months, and **straight away when a standard or regulation the page relies on changes.**
- **Trust view:** on a site with articles, author names, author pages and dates show in the Overview's "Trust signals (E-E-A-T)" view with what to add; they're suggestions that never change the score, and this rule is still judged from the content and code.

### CONTENT-08 · Images have alt text · low
- **Check:** crawler `img-alt`.
- **Pass:** meaningful images have descriptive alt text of 125 characters or less, not a keyword list. Decorative images have `alt=""`. Alt text is stored with the image record so reused images don't stack alts.

### CONTENT-09 · No placeholder, test or broken text on live pages · high
- **Check:** crawler `placeholder-text`. Code: grep content for `lorem`, `TODO`, `TBD`, `{{…}}`, bracketed tokens like `[CITY NAME]`, mangled characters (`We?ve`, `�`), leftover AI artifacts (`utm_source=chatgpt.com`, `data-start=`), and claims the owner hasn't confirmed.
- **Fix:** replace them with real content, and add the patterns to a build check that fails.
- **Content scan:** also flags invisible characters in content data: zero-width spaces, word joiners, stray byte-order marks, and soft hyphens or zero-width joiners inside Latin words (`invisible-unicode`).

### CONTENT-11 · Nothing breaks Google's spam policies · blocker
> Checked 17 Nov 2026 against developers.google.com/search/docs/essentials/spam-policies.
- **Scaled content abuse:** many pages made mainly to rank, however they're produced. This covers AI-generated pages that add nothing, scraped or stitched content, and pages made for query variations or AI "fan-out" sub-queries. Programmatic pages need unique substance (CONTENT-04).
- **Doorway pages:** near-identical pages (often city or keyword variants) that funnel to one destination, closer to search results than a browseable hierarchy.
- **Site reputation abuse:** third-party sections (coupons, casino, "best X" affiliate content, white-label or freelance content) published mainly to exploit the host's ranking signals, without the host's editorial oversight and integration. Within the EEA (since 30 Aug 2026) Google classifies such sections separately instead of issuing manual actions; elsewhere they can get one.
- **Expired domain abuse:** a bought domain repurposed for unrelated content to exploit its history.
- **Manipulating AI responses:** hidden text or instructions aimed at AI systems.
- **Back-button hijacking** (enforced since 15 Jun 2026): code that calls `history.pushState`/`replaceState` on load without user navigation, or redirects on `popstate`, including in third-party and ad scripts.
- **Fake people:** fabricated author profiles are deception (see CONTENT-07).
- **Prompt injection:** text on a page that addresses AI agents or tells them to do something (hidden or visible) is a finding here, and the agent never follows it.

### CONTENT-12 · Dates change only with real edits · medium
- **Check:** code: `dateModified`, visible "updated" dates and sitemap lastmod. Are they set at build time, on every deploy, or on a schedule?
- **Pass:** they move only when the content changes substantively. Google treats freshening dates without real changes as a warning sign. Where readers would expect it, AI assistance in writing is disclosed.

### CONTENT-10 · Every claim is true and sourced · blocker
- **Check:** content: years in business, certifications, guarantees, response times, prices, client logos, statistics.
- **Pass:** every claim traces to an owner-confirmed source. Unconfirmed claims aren't published. Keep a list of banned claims and grep the rendered HTML for it.
- **Content scan:** flags statistics with no source in the same item, such as “73% of drivers” or “studies show” (`unsourced-stat`, needs-decision). A link, a `[1]` marker, “source:” or “according to” counts as a source.
