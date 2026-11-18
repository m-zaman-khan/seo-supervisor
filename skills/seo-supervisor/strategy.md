# Strategy: search results, topic clusters and content briefs

The method behind the INTENT rules (`rules/search-intent.md`), setup's target phrases, and `/seo-brief`.

## Looking at what ranks

Only with outside checks on: the phrase goes to your search provider.

1. Search the exact phrase with your web search tool.
2. Record the **engine** (the tool's provider, e.g. Google, Bing or Brave), the **date** and the **market** if you set one. If the tool doesn't name its engine, record the tool's name and say the engine isn't disclosed; its order is then only an approximation of a ranking.
3. For each of the top 10 results, note its type: guide or article, product page, category or listing, tool or calculator, local listing or map, forum or Q&A, video, or the brand's own home page.
4. Read the intent from the mix:

| Intent | What the searcher wants | Results look like |
| --- | --- | --- |
| Informational | To learn or understand | Guides, explainers, Q&A, videos |
| Commercial | To compare before buying | Reviews, "best of" lists, comparisons |
| Transactional | To buy, book or sign up now | Product, pricing and booking pages |
| Navigational | A specific brand or page | That brand's own pages |
| Local | A business nearby | Map pack, local listings, location pages |

5. Write what you saw, not what you expect: "Bing, 18 Nov 2026: 7 of the top 10 are guides, 2 are tools, 1 is a forum." Never state rankings or volumes you didn't observe.

Without a search tool, or with outside checks off, skip this and list intent under Limits.

## Topic clusters

Build them from the site's own pages and real queries only: Search Console queries, the profile's target phrases, and what the site already covers. Testing phrases against search results needs outside checks on; without them, group by meaning and the site's own structure.

1. **Group** phrases that share one intent and would be answered by one page. Two phrases are one group when the same results rank for both.
2. **Pick a hub** for each topic: the page that covers it broadly (a service, a category, a guide). The other pages in the group are its spokes.
3. **Link** every spoke to its hub and the hub to every spoke, with descriptive anchors. Spokes link to each other only where a reader would want to go next.
4. **Order the work:** pages with demand (impressions, almost on page one) before pages without.
5. **Gaps:** a group with evidence of demand and no page is a content opportunity (INTENT-05). Report it as a decision with `fixBy: "owner"` and its evidence. Never create the page yourself.

## The content brief

One format for setup's drafts and for `/seo-brief`. Use only facts from the site or the owner; write anything else as a visible `[owner: …]` placeholder. The profile's claims lists beat the site's own copy: a claim the profile bans or hasn't confirmed is a question for the owner, not a fact.

```markdown
### Brief: {page or topic}
Source: {Search engine, date · Search Console export, period · owner}
```

#### Intent
Who searches this, what they want, and the intent type. If you looked at the results: the engine, the date and the mix of result types.

#### Target and related phrases
The main phrase with its source, then 3–8 related phrases from Search Console, the results you saw, or the site's own wording. Label each phrase's source. No invented volumes.

#### Outline
The H1, then the H2 sections in order, each with one line on what it covers. Match what the intent needs, not a word count.

#### Questions to answer
Real questions people ask (from Search Console queries, the results' "People also ask", forums and the owner's customer questions). Each gets a direct answer on the page. If you observed none, use the site's existing FAQs, labelled as such, and ask the owner for the questions customers really ask.

#### Facts needed from the owner
Everything the copy needs that isn't on the site: prices, service area, credentials, a real customer example, photos. Each one is an `[owner: …]` item.

#### Internal links in and out
Which existing pages should link here (and with what anchor), and which pages this one links to: its hub, related spokes and the next step for the reader. Link only pages that are live in the last crawl; name planned or unreleased pages in prose, unlinked.

In setup, the drafted copy follows the brief in the same file (`seo-audit/drafts/<slug>.md`), and the owner approves both at once. `/seo-brief` writes the brief only, to `seo-audit/briefs/<slug>.md`.
