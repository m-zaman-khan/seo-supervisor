---
description: Audit this site's SEO (read-only) and write the HTML report
argument-hint: "[local or staging URL, or notes]"
---
Use the **seo-supervisor** skill in **audit** mode for this project. Follow its SKILL.md exactly: change no source, content or config; crawl the site, inspect the code and content data, then write `seo-audit/seo-audit.json` and render it, which produces `seo-audit/seo-audit.html` and `seo-audit/seo-audit.md`. Finish with the health score and band, the verdict, counts by severity, the top three problems, both report paths, and an offer to fix.

Extra details from the user (may be empty): $ARGUMENTS
