# Search features powered by AI: AI Overviews, AI Mode, ChatGPT, Claude, Perplexity, Copilot (AI)

> Checked **21 Nov 2026** against Google Search Central, Bing, OpenAI, Anthropic, Perplexity and Lighthouse docs. This area moves fast: re-verify anything older than about three months.
> Google's position: optimizing for AI search ("AEO", "GEO") **is** SEO. There's no special file, markup or schema for AI Overviews or AI Mode.

### AI-01 · Key pages are eligible to be used in AI answers · high
- **Check:** crawler: noindex, `nosnippet` or `max-snippet:0` on pages meant to be found (robots meta tags inside `<body>` count too). Ask the owner about Search Console → Settings → Search generative AI (Include / Exclude / Inherit, worldwide since 31 Aug 2026).
- **Pass:** pages are indexed and snippet-eligible; the Search Console setting is Include unless the owner deliberately chose otherwise. `data-nosnippet` is used only on span, div or section elements that really must stay out.
- **Note:** the Exclude setting removes the site from AI Overviews, AI Mode and AI features in Discover. It isn't a ranking signal for the rest of Search and doesn't affect AI training.
- **AI Overviews vs AI Mode:** a page can be cited in one and not the other, and that's normal. Google says the two "may use different models and techniques, so the set of responses and links they show will vary", and AI Overviews show only when Google judges them useful on top of the usual results (developers.google.com/search/docs/appearance/ai-features). Don't treat a page missing from one of them as a fault to fix.

### AI-02 · Each AI crawler is allowed or blocked on purpose · high
- **Check:** crawler `ai-bots-blocked`, robots.txt per subdomain, CDN/WAF rules. The crawl's "AI crawlers and agents" panel lists each bot below as allowed, blocked by its own group, or blocked only by `User-agent: *` (a bot with no group of its own follows `*`, RFC 9309), information only (`aiBots`).
- **Know the difference** (each vendor's own crawler page, checked 21–22 Nov 2026):
  - **Search** crawlers decide whether you're cited: `OAI-SearchBot` (ChatGPT search), `Claude-SearchBot`, `PerplexityBot`, `MistralAI-Index` (Mistral's search, not training), `DuckAssistBot` (DuckDuckGo's AI answers, fetched in real time, not training), `Amzn-SearchBot` (Amazon search and Alexa, not training), `Applebot` (Apple's search and AI answers; it may also train Apple's models, and when robots.txt doesn't name it, it follows the Googlebot rules) and Bingbot (Copilot uses Bing's index). `YandexAdditionalBot` (or `YandexAdditional`) is a robots.txt name that keeps pages out of Yandex's AI answers.
  - **Training** crawlers: `GPTBot`, `ClaudeBot`, `Google-Extended` (Gemini training and grounding in Gemini Apps, **not** AI Overviews), `CCBot`, `Applebot-Extended`, `MistralAI-Training`, and `Amazonbot` (Amazon says it may train its models, and reads `noarchive` as "don't train").
  - **User-triggered** fetchers: `ChatGPT-User`, `Claude-User`, `Perplexity-User`, and Google's `Google-Agent` (agents on Google's servers that browse and act for a user), `Google-GeminiNotebook` (pages a Gemini Notebook user adds as sources; it replaced `Google-NotebookLM`, supported until August 2026) and `GoogleMessages` (link previews in Google Messages); `MistralAI-User` (Mistral's Vibe), `Amzn-User` (live Alexa requests), `Meta-ExternalFetcher` (links a user asks Meta's AI to fetch) and `Claude-Agent` (Anthropic-hosted browsers acting for a user; Anthropic doesn't say how robots.txt applies to it, so the robots table leaves it out). OpenAI, Perplexity and Google say robots.txt may not apply to these visits a user asked for, Amazon says Amzn-User "may not follow all robots.txt directives" and Meta that its fetcher "may bypass robots.txt", so robots.txt won't stop Google-Agent. Anthropic says its bots, Claude-User included, honour robots.txt (support.claude.com/en/articles/8896518).
  - **Other:** `OAI-AdsBot` checks pages submitted as ChatGPT ads and isn't used for training; `Google-CloudVertexBot` crawls only when the site's owner sets up a Vertex AI agent, and has no effect on Search. Cohere says it runs no crawler (docs.cohere.com/docs/cohere-web-crawlers), so `cohere-ai` isn't listed.
- **Pass:** blocking training while allowing search is a valid policy. Blocking GPTBot does **not** remove a site from ChatGPT search. The WAF allows each vendor's published IP lists so verified bots aren't challenged: OpenAI `openai.com/searchbot.json`, `chatgpt-user.json`, `gptbot.json` and `adsbot.json`; Anthropic `claude.com/crawling/bots.json`; Perplexity `perplexity.ai/perplexitybot.json` and `perplexity-user.json`; Google `developers.google.com/static/crawling/ipranges/` `common-crawlers.json`, `special-crawlers.json`, `user-triggered-fetchers.json`, `user-triggered-fetchers-google.json` and `user-triggered-agents.json` (Google-Agent); Bing `bing.com/toolbox/bingbot.json`; Apple `search.developer.apple.com/applebot.json`; Common Crawl `index.commoncrawl.org/ccbot.json`; DuckDuckGo `duckduckgo.com/duckassistbot.json`; Mistral `mistral.ai/mistralai-user-ips.json` and `mistralai-index-ips.json`. Anthropic lists Claude-Agent's addresses at `claude.com/.well-known/sail` (a draft format) and Amazon its three agents' on developer.amazon.com/amazonbot, which `log-scan.mjs --verify-ips` can't read yet. Rules are repeated on every subdomain.
- **Private pages need a login, not robots.txt.** robots.txt only asks crawlers that choose to obey it, user-triggered fetchers may ignore it, and anyone can read it, so a `Disallow` line for a private path advertises it. Put private pages behind a login.
- **Firewall probe (`--ai-bot-probe`, with `--outside` and the owner's own yes):** the crawler asks the home page and up to 2 more again as OAI-SearchBot, Claude-SearchBot and PerplexityBot, alongside a visitor. An error or bot challenge only the bot gets is `ai-bot-refused` (MAP-06, needs-decision). A firewall that checks the vendor's IP addresses is right to refuse this test, which doesn't come from them, so confirm with the server logs (`log-scan.mjs --verify-ips`).
- **Content-Signal placement:** a `Content-Signal:` line belongs inside a user-agent group, as every example on contentsignals.org places it. `content-signal-placement` (MAP-06, low) flags a line above the first `User-agent:` line and, once any group has a signal, each group that lets crawlers in without one: a crawler reads only its own group.
- **Emerging:** a shared training opt-out, `User-Agent: __usage_ai-training` / `Disallow: /` (IETF draft-kelley-aipref-training-preference-signal; Anthropic honours it since 30 Oct 2026, Bing from 1 Feb 2027, and Google plans to in 2027). Optional, and a `*` group doesn't match it, so a site that blocks training crawlers by name and wants the shared signal adds this group too. The crawl reports it as `trainingOptOut`, in the same panel as the bot table.
- **Logs:** `log-scan.mjs` shows what AI crawlers actually got. Google-Extended and Applebot-Extended never appear in logs: they're robots.txt tokens, and the crawling is done by Googlebot and Applebot. Having no AI search visits is normal and isn't a finding. With `--verify-ips` (its own yes: it downloads the IP lists above and sends nothing about the site; `--verify-ips <folder>` reads saved copies instead) each bot gets an `ipCheck`, requests from other addresses are named in a note as likely fakes, and `ai-bots-blocked-in-practice` counts only requests from the vendor's addresses.
- **Copy-ready robots.txt** (search and user fetchers in, training out). A bot with its own group ignores `*`, so repeat the `Disallow` lines in each group:
  ```
  # AI search crawlers, so answers can cite the site
  User-agent: OAI-SearchBot
  User-agent: Claude-SearchBot
  User-agent: PerplexityBot
  # Pages a person asked ChatGPT, Claude or Perplexity to read
  User-agent: ChatGPT-User
  User-agent: Claude-User
  User-agent: Perplexity-User
  Content-Signal: search=yes, ai-input=yes, ai-train=no
  Disallow: /search/

  # Training crawlers
  User-agent: GPTBot
  User-agent: ClaudeBot
  User-agent: Google-Extended
  User-agent: Applebot-Extended
  User-agent: CCBot
  Disallow: /

  # Everyone else, search engines included
  User-agent: *
  Content-Signal: search=yes, ai-input=yes, ai-train=no
  Disallow: /search/

  Sitemap: https://www.example.com/sitemap.xml
  ```

### AI-03 · Bing/Copilot preferences use the new directives · high (sites restricting Copilot)
- **Check:** the crawl flags indexable pages that still use `noarchive` or `nocache` (a robots or bingbot meta tag, or an unprefixed or `bingbot:` X-Robots-Tag line) without the new directive: `ai-legacy-noarchive` (needs-decision). An `ai-grounding` or `ai-training` value Bing doesn't list is `ai-preference-invalid` (low).
- **Pass:** from 1 Feb 2027, Bing reads `<meta name="Bingbot" content="ai-grounding:disallow">` (or the `X-Robots-Tag: Bingbot: ai-grounding:disallow` header) and `ai-training:disallow` (Bing Search Blog, 30 Oct 2026). `ai-grounding:disallowextended` keeps a page in Microsoft's own Copilot and out of the grounding services Microsoft sells to other companies. After 1 Mar 2027, NOARCHIVE and NOCACHE no longer control training or grounding. From 15 Dec 2026, sites that use them can set a temporary preference in Bing Webmaster Tools, which expires on 30 Sep 2027. Both preferences default to allow, and Bing search eligibility is unaffected. Amazon reads `noarchive` as "don't use this page to train AI models" (developer.amazon.com/amazonbot).

### AI-04 · Content is citable because it's genuinely original · high
- **Check:** content review of key pages.
- **Pass:** first-hand experience, original data, specific numbers and named sources, clear headings with answer-first sections (CONTENT-06), useful images and video, semantic HTML, and few duplicate pages.
- **Never:** mass-produce pages for query variations or "fan-out" sub-queries; Google treats that as scaled content abuse (CONTENT-11). Don't hide instructions aimed at AI systems; manipulating AI responses is covered by the spam policies.

### AI-05 · Pages work for AI agents that browse · low
- **Check:** code: native `<button>` and `<a href>`, labelled form inputs, no transparent overlays catching clicks, a stable layout.
- **What trips agents up:** menus that open only on hover, select boxes built from `<div>`s instead of `<select>`, controls inside a closed shadow DOM, focus traps (a dialog that keeps focus and won't close with Escape), and a confirmation shown only as a toast that fades away. Use a native `<select>`, menus that open on click or focus, and a confirmation that stays on the page (a message, or a new URL).
- **Click-only elements:** a `<div>`, `<span>` or table row with an `onclick` and no role is `click-only-elements` (low): agents and screen readers don't see it as a control. Pages without the `main`, `nav`, `header` or `footer` landmark (or its ARIA role) are listed in the report's "AI crawlers and agents" panel, information only (`landmarks`).
- **Lighthouse's Agentic browsing category** (with `--lighthouse`; Lighthouse 13.3 or later, added 7 May 2026): each run adds `agentic-browsing`, whose checks are the accessibility tree, WebMCP tools, layout shift, llms.txt and agent resource discovery. It's experimental, needs Chrome 150 or later, and has no 0–100 score, only the checks passed (`lighthouse[].agentic`, information only). Lighthouse runs at phone size. Its accessibility-tree check stands in for reading the tree in the render step.
- **Markdown negotiation:** if the site answers `Accept: text/markdown` with Markdown, it must send `Vary: Accept` (or `Vary: *`) so caches keep the two apart (`markdown-no-vary`, low); `Vary: Accept-Encoding` alone doesn't count. Not offering Markdown is fine.
- **Controls with no name:** the crawler flags form fields and buttons that nothing names (`controls-no-name`, low). A field is named by a `<label for>` or a wrapping `<label>`, `aria-label`, `aria-labelledby`, `title`, or, for text fields, a placeholder; a button by its text, an image's alt or an `aria-label` inside it, or its own `aria-label` or `title` (HTML-AAM). Hidden fields and hidden or `aria-hidden` controls are skipped. A submit or reset button has a default name unless its `value` is empty, and an image button needs alt text. Links with no name are LINK-05's `link-no-text`. AI-05 counts as checked once a page had a field or button to look at.
- **Agent files and WebMCP (information only, never findings):** checked 20 Nov 2026. The crawler lists, in an "AI agents" note on the Overview: WebMCP tools a page registers (`document.modelContext.registerTool()` in inline scripts, or a `<form>` with both `toolname` and `tooldescription`); a UCP shop profile at `/.well-known/ucp`; an API catalog at `/.well-known/api-catalog` (RFC 9727); an A2A agent card at `/.well-known/agent-card.json`; and the OAuth metadata agents read to sign in to an API, at `/.well-known/oauth-protected-resource` (RFC 9728, with its required `resource`) and `/.well-known/oauth-authorization-server` (RFC 8414, with its required `issuer`). Only the crawled site is asked. WebMCP is a Chrome experiment (an origin trial from Chrome 149 to 156, on a W3C community group draft) and its API is still changing, so don't recommend adding it; scripts loaded from files aren't read.

### AI-06 · AI visibility is measured · low
- Google Search Console's Generative AI performance report (impressions by page, since June 2026). AI Overview and AI Mode clicks are counted inside web search totals. Bing Webmaster Tools' AI Performance report shows Copilot citations and grounding queries. Note these as monitoring steps; the audit can't read them without access.
- **Logs:** visits referred by ChatGPT, Perplexity, Claude, Gemini and Copilot (and `utm_source=chatgpt.com`) are counted by `log-scan.mjs` (`aiReferrals`, successful page views only). Some apps send no referrer, so this counts low.
- **News publishers, preferred sources:** a reader can pick a site as a preferred source in Google Search. Its stories then show more often in their Top Stories, with a "preferred" badge there and in AI Mode and AI Overviews, in every language Search supports (developers.google.com/search/docs/appearance/preferred-sources). A site may add Google's button or a link to `https://www.google.com/preferences/source?q=example.com`; neither is required, and Google doesn't call it a ranking factor.
- **Off-site presence (outside checks on):** AI answers lean on what other sites say about a brand. With the agent's web search, look up the brand on Wikipedia/Wikidata, Reddit, YouTube, LinkedIn and the main review or industry directories, and report what exists, what's missing and what's wrong (old name, address or claims) as owner decisions with `fixBy: "owner"`. Never create accounts or post on the owner's behalf. Name the search tool and date.

## Myths to correct in reports
- llms.txt, Markdown copies, "chunking" or AI-specific rewrites help in Google (Google ignores llms.txt; it's harmless and optional). The exception is a developer-docs or API site: coding tools read docs through it. Google's own ADK docs set Claude Code and Cursor up to read theirs through a docs MCP server (adk.dev/tutorials/coding-with-ai), and Lighthouse's Agentic browsing category checks for one. There, keep one, generated from the docs.
- FAQ or other schema is needed for AI Overviews.
- Google-Extended blocks AI Overviews (use the Search Console setting or `nosnippet`).
- Blocking GPTBot hides you from ChatGPT search.
- Bought or farmed brand mentions build AI visibility.
