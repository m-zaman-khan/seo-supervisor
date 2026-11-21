---
description: "Write an SEO content brief for a topic or page"
argument-hint: "[topic or URL]"
---
Use the **seo-supervisor** skill in **brief** mode for: $ARGUMENTS

Follow the brief format in `strategy.md` exactly, with its headings: Intent · Target and related phrases · Title and description · What's new here · Outline · Questions to answer · Facts needed from the owner · Internal links in and out.

- **Read-only.** Write only in `seo-audit/briefs/`. Never edit the project's code, content or config.
- **Facts:** use only what the site or the owner says. Anything else is a visible `[owner: …]` placeholder.
- **What ranks:** look at the search results only if outside checks are on (`seo-audit/settings.json` or the SEO profile; if neither says, ask once). Name the search engine and the date. Never invent volumes or rankings.
- **Links:** read the site's routes or the last crawl (`seo-audit/seo-crawl.json`) so every internal link in the brief points at a page that exists.
- **Sources:** use the project's files, its content dump and the last crawl. Don't query a CMS or other API; what you can't find there is a question for the owner.
- **The URL of an existing page:** start with the One page review in `strategy.md`, and put its wireframe at the top of the brief.
- **A comparison page** ("X vs Y", "alternatives to X", "best X"): add the parts under "Comparison briefs" in `strategy.md`.
- **A whole cluster:** write one brief per post, as "Briefs for a whole cluster" in `strategy.md` says. Confirm the list of posts with the owner first.

Finish with the brief's path (or the cluster's index) and the facts it still needs from the owner.
