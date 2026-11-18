---
description: Pre-launch SEO gate: pass or fail, plus the launch-day steps
argument-hint: "[staging or production URL]"
---
Use the **seo-supervisor** skill in **launch** mode for this project (site or URL, may be empty: $ARGUMENTS).

Run the audit, with `--check-live` once the production origin answers, then give a clear **PASS** or **FAIL**. It passes only with zero open blockers and zero open high findings in the CRAWL, URL, REND, MAP and TRUST-07 rules; a certificate blocker always fails. List what blocks launch, then the launch-day steps from `rules/launch-monitoring.md`. Don't edit anything.
