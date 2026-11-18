# Search features powered by AI: AI Overviews, AI Mode, ChatGPT, Claude, Perplexity, Copilot (AI)

> Checked **17 Nov 2026** against Google Search Central, Bing, OpenAI, Anthropic and Perplexity docs. This area moves fast: re-verify anything older than about three months.
> Google's position: optimizing for AI search ("AEO", "GEO") **is** SEO. There's no special file, markup or schema for AI Overviews or AI Mode.

### AI-01 · Key pages are eligible to be used in AI answers · high
- **Check:** crawler: noindex, `nosnippet` or `max-snippet:0` on pages meant to be found (robots meta tags inside `<body>` count too). Ask the owner about Search Console → Settings → Search generative AI (Include / Exclude / Inherit, worldwide since 31 Aug 2026).
- **Pass:** pages are indexed and snippet-eligible; the Search Console setting is Include unless the owner deliberately chose otherwise. `data-nosnippet` is used only on span, div or section elements that really must stay out.
- **Note:** the Exclude setting removes the site from AI Overviews, AI Mode and AI features in Discover. It isn't a ranking signal for the rest of Search and doesn't affect AI training.

### AI-02 · Each AI crawler is allowed or blocked on purpose · high
- **Check:** crawler `ai-bots-blocked`, robots.txt per subdomain, CDN/WAF rules.
- **Know the difference:**
  - **Search** crawlers decide whether you're cited: `OAI-SearchBot` (ChatGPT search), `Claude-SearchBot`, `PerplexityBot`, and Bingbot (Copilot uses Bing's index).
  - **Training** crawlers: `GPTBot`, `ClaudeBot`, `Google-Extended` (Gemini training and grounding in Gemini Apps, **not** AI Overviews), `CCBot`, `Applebot-Extended`.
  - **User-triggered** fetchers: `ChatGPT-User`, `Claude-User`, `Perplexity-User`. These may not follow robots.txt.
- **Pass:** blocking training while allowing search is a valid policy. Blocking GPTBot does **not** remove a site from ChatGPT search. The WAF allows each vendor's published IP lists (`openai.com/searchbot.json`, `perplexity.ai/perplexitybot.json`) so verified bots aren't challenged. Rules are repeated on every subdomain.
- **Emerging:** a shared training opt-out, `User-Agent: __usage_ai-training` / `Disallow: /` (IETF draft; Anthropic honours it, Google plans to in 2027). Optional, and a `*` group doesn't match it.

### AI-03 · Bing/Copilot preferences use the new directives · high (sites restricting Copilot)
- **Check:** grep for `noarchive` / `nocache` used to keep content out of Copilot.
- **Pass:** from 1 Feb 2027, Bing reads `<meta name="Bingbot" content="ai-grounding:disallow">` (or the `X-Robots-Tag: Bingbot: ai-grounding:disallow` header) and `ai-training:disallow`. After 1 Mar 2027, NOARCHIVE and NOCACHE no longer control training or grounding. Both preferences default to allow, and Bing search eligibility is unaffected.

### AI-04 · Content is citable because it's genuinely original · high
- **Check:** content review of key pages.
- **Pass:** first-hand experience, original data, specific numbers and named sources, clear headings with answer-first sections (CONTENT-06), useful images and video, semantic HTML, and few duplicate pages.
- **Never:** mass-produce pages for query variations or "fan-out" sub-queries; Google treats that as scaled content abuse (CONTENT-11). Don't hide instructions aimed at AI systems; manipulating AI responses is covered by the spam policies.

### AI-05 · Pages work for AI agents that browse · low
- **Check:** code: native `<button>` and `<a href>`, labelled form inputs, no transparent overlays catching clicks, a stable layout. Chrome Lighthouse has an informational "Agentic browsing" audit.

### AI-06 · AI visibility is measured · low
- Google Search Console's Generative AI performance report (impressions by page, since June 2026). AI Overview and AI Mode clicks are counted inside web search totals. Bing Webmaster Tools' AI Performance report shows Copilot citations and grounding queries. Note these as monitoring steps; the audit can't read them without access.

## Myths to correct in reports
- llms.txt, Markdown copies, "chunking" or AI-specific rewrites help in Google (Google ignores llms.txt; it's harmless and optional).
- FAQ or other schema is needed for AI Overviews.
- Google-Extended blocks AI Overviews (use the Search Console setting or `nosnippet`).
- Blocking GPTBot hides you from ChatGPT search.
- Bought or farmed brand mentions build AI visibility.
