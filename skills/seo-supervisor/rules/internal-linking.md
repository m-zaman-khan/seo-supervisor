# Internal linking (LINK)

The goal: every page links **up** to its parent, **across** to its siblings and **forward** to the next useful step, and the forward links close into loops, so a visitor or crawler who lands anywhere can reach everything.

```mermaid
flowchart LR
  subgraph group["Inside one group (e.g. a tool family)"]
    Hub["Section hub"] -->|lists| A["Item A"] & B["Item B"] & C["Item C"]
    A -->|next step| B -->|next step| C -->|next step| A
    A & B & C -->|breadcrumb| Hub
  end
  subgraph cycle["Across content types"]
    Post["Blog post"] -->|defines terms| Term["Glossary term"] -->|explained in| Guide["Guide"] -->|test it| Tool["Tool"] -->|fix it| Tpl["Template / checklist"] -->|step in| Path["Path"] -->|get it done| Money["Service page"] -->|read more| Post
    Money -->|proof| Report["Sample report"]
  end
  Res["Resources hub"] -->|links to every section| Post & Term & Guide & Tool & Tpl
  Post & Term & Guide & Tool & Tpl -->|breadcrumb| Res
```
Inside each group, items chain into a loop. Across content types, each type points to the next and the money pages point back. A central hub links to every section, and every breadcrumb links back to it.

### LINK-01 · Hubs exist, and every page is within three clicks of home · high
- **Check:** crawler `deep-page` and the `depth` per page. Code: nav, footer, hub pages.
- **Pass:** home → section hubs → items. Each hub has an intro and links to everything in it. Groupings that aren't URLs (e.g. tool families) are sections with H2s on the hub.

### LINK-02 · No orphan pages · medium
- **Check:** crawler `orphan` (sitemap pages with no inbound internal links). Code: content-graph checks.
- **Pass:** every indexable page has at least one link from the **body** of another page. Sitemap, footer and menu links alone don't count.
- **Fix:** add the page to its hub and to the related blocks of its siblings. Add a build check that fails orphans.

### LINK-03 · Circular linking: up, across, forward, and across content types · high
- **Check:** code: related-content components and the data behind them. Content: a sample of pages of each type.
- **Pass:**
  - **Up:** breadcrumb plus the hub link.
  - **Across:** 3–6 siblings from the same group, both ways (adding an item updates its siblings).
  - **Forward:** 1–2 "next step" links. Chain each group so its last item points back to its first.
  - **Across types:** each content type points to the next one, ending at the pages that make money, which link back. A typical cycle: blog post → glossary term → guide → tool → template or checklist → path → service page → back to posts and guides. Local sites: service ↔ city ↔ nearby cities ↔ projects ↔ reviews. Shops: category ↔ product ↔ buying guide ↔ comparison.
- **Fix:** generate these links from data (related, next and guide fields), never by hand.

### LINK-04 · Links point only at live pages · high
- **Check:** crawler `broken-internal-link`, `link-to-redirect`. Code: are generated links filtered through the set of published items?
- **Fix:** filter at render time, and add a build check that fails on links to unknown or unpublished slugs. Unreleased product or feature pages stay unlinked.

### LINK-05 · Anchor text says what the target is · low
- **Check:** crawler `generic-anchor`, and `link-no-text` (medium): an `<a href>` with no visible text, no `aria-label`, `aria-labelledby` or `title`, and no image alt, SVG `<title>` or label inside. A link marked `aria-hidden="true"` is left out, as axe and Lighthouse leave it out: screen readers skip it (the usual case is a card's image link next to its text link to the same page). Content: anchor variety.
- **Pass:** descriptive anchors ("check your DMARC record"). The same exact keyword isn't repeated on every link to a page; vary it naturally. Icon-only links (social icons, logo, cart) carry an `aria-label`.

### LINK-06 · Link blocks stay focused · low
- **Check:** crawler `too-many-links` (more than 150 per page).
- **Pass:** about 12–15 relevant contextual links on a content page, up to 6 siblings and 2 next steps. The footer links to hubs, not to every item. Nav doesn't list programmatic pages such as service × city.

### LINK-08 · An HTML sitemap page lists every hub and item · low
- **Check:** crawler pages for `/sitemap/` or similar. Code: footer link.
- **Pass:** a plain page linked from the footer that lists every hub, browse page and item, generated from the same data as the XML sitemap. It's a safety net for crawlers and for people who prefer scanning a list.

### LINK-09 · Defined terms link to their glossary entry once · low
- **Check:** content: guides, tool pages and posts that use glossary terms.
- **Pass:** the first mention of a term on a page links to its glossary entry, once per page, never every occurrence. Each glossary entry links back to the guide that explains it and the tool that tests it.

### LINK-07 · Browse pages and their items link both ways · medium
- **Check:** code: category, topic and tag pages.
- **Pass:** items link to their browse page (breadcrumb plus a "More in …" block). Browse pages link to every item, paginated. Tag pages exist only once there's enough volume.

### LINK-10 · Links from other sites are earned, never bought · medium
> Checked 19 Nov 2026 against developers.google.com/search/docs/essentials/spam-policies#link-spam; the link text and disavow notes on 20 Nov 2026 against support.google.com/webmasters/answer/2648487 (disavow) and developers.google.com/search/blog/2022/12/december-22-link-spam-update.

Google uses links from other well-known sites as one sign of quality, and for local businesses, as part of how well known the business is. Links worth having come from giving people a reason to link.
- **Check:** ask the owner how the site gets links. Search Console's Links report shows who links now; `links-import.mjs` reads its exports into the report.
- **Link text from other sites:** the report shows its mix: your brand, your web address, generic words like "click here", and other words. A natural mix is mostly brand, address and words that say what the page is about, because other people choose it. Google's spam policies count "links with optimized anchor text in articles, guest posts, or press releases distributed on other sites" as link spam, so never ask for keyword-rich link text. The mix is information only. Google publishes no target shares, so there are none here.
- **No "toxic links":** don't hunt for toxic links or disavow them. Google says that "in most cases, Google can assess which links to trust without additional guidance", and its SpamBrain systems neutralize unnatural links, so the credit they passed is simply lost. Disavow only when unnatural links (paid links or other link schemes) have caused a manual action, or likely will, and can't be removed. Google warns that a disavow done wrong "can potentially harm your site's performance in Google Search results".
- **Pass:** links come from:
  - **Something worth citing:** original data, a free tool, or a guide that answers a question better than anything else (AI-04).
  - **Digital PR with real news:** a study, a launch or a local first, sent to the journalists who cover it.
  - **Partners and suppliers:** the companies the business works with list it on their sites.
  - **Local press and associations:** local news, chambers of commerce and trade bodies (LOCAL-14).
  - **Unlinked mentions:** a site names the business without linking; ask it to add the link.
  - **Dead pages that have links:** redirect them to the closest live page, and ask the linking site to update the link (LAUNCH-05).
- **Never:** buying or selling links, sending free products in return for a link, large-scale link swaps or partner pages made only to cross-link, automated link building, or links hidden in widgets and footers on other sites. All are link spam under Google's spam policies. A paid link is fine only when it's marked `rel="sponsored"` or `rel="nofollow"`.
- These are owner actions: report them as notes.
