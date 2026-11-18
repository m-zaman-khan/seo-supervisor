---
description: "Write an SEO content brief for a topic or page"
argument-hint: "[topic or URL]"
---
Use the **seo-supervisor** skill in **brief** mode for: $ARGUMENTS

Follow the brief format in `strategy.md` exactly, with its six headings: Intent · Target and related phrases · Outline · Questions to answer · Facts needed from the owner · Internal links in and out.

- **Read-only.** Write only `seo-audit/briefs/<slug>.md`. Never edit the project's code, content or config.
- **Facts:** use only what the site or the owner says. Anything else is a visible `[owner: …]` placeholder.
- **What ranks:** look at the search results only if outside checks are on (`seo-audit/settings.json` or the SEO profile; if neither says, ask once). Name the search engine and the date. Never invent volumes or rankings.
- **Links:** read the site's routes or the last crawl (`seo-audit/seo-crawl.json`) so every internal link in the brief points at a page that exists.
- **Sources:** use the project's files, its content dump and the last crawl. Don't query a CMS or other API; what you can't find there is a question for the owner.

Finish with the brief's path and the facts it still needs from the owner.
