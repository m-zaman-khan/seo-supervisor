---
description: "Set up SEO from scratch: propose a plan, build it after approval"
argument-hint: "[url or notes]"
---
Use the **seo-supervisor** skill in **setup** mode for this project. Follow its SKILL.md and `planning.md` exactly.

- **No plan in `seo-audit/seo-audit.json` yet:**
  1. Work out what the site is, crawl it, and propose the SEO plan.
  2. Render the report. It opens on the Plan tab.
  3. **Stop.** Ask the owner to approve the plan, and to give a yes or no to each "Needs your yes" item.

  Change nothing outside `seo-audit/` before that.
- **A plan already exists:** continue from its status, as `planning.md` describes. A proposed plan goes to approval, an approved plan gets built, and a built plan gets the pages whose drafts the owner approved.
- **Never:**
  - invent facts, prices, reviews or search volumes
  - switch indexing on
  - edit CMS content, or remove, hide or noindex pages, without the owner's go-ahead

Extra details from the user (may be empty): $ARGUMENTS
