# Contributing

Thanks for helping. The most valuable contributions are rule updates when search changes, new checks, and framework guides.

## Setup

```bash
git clone https://github.com/m-zaman-khan/seo-supervisor
cd seo-supervisor
npm test            # Node 20+, no dependencies to install
```

The tests crawl a small fixture site (`test/fixture-site/`) that has one planted problem per checked rule. They also scan sample content, render the report and run the installer in a temporary home folder.

## Where things live

| Path | What it is |
| --- | --- |
| `skills/seo-supervisor/SKILL.md` | The workflow the agent follows |
| `skills/seo-supervisor/rules/*.md` | Rules by area. Each has an ID, a severity, how to check it and how to fix it |
| `skills/seo-supervisor/site-types/`, `frameworks/` | Extra rules per site type, and how to apply them per framework |
| `skills/seo-supervisor/scripts/` | The crawler, the content scanner and the report renderer |
| `commands/` | The four slash commands |

## Changing a rule

1. Cite a primary source (Google Search Central, Bing Webmaster, a spec or an official announcement) and its date in the PR.
2. Keep the rule's ID. Add new rules at the end of their file.
3. If the crawler checks it, add a planted case to `test/fixture-site/` and the rule ID to `test/crawl.test.mjs`.

## Changing the report

Run `npm run demo` afterwards. It refreshes `docs/index.html` (the live demo) and the bundled sample, and a test checks that they're current. Keep the report one offline file: no external scripts, styles or fonts.

## Pull requests

- Keep each one focused, and add a line to `CHANGELOG.md`.
- `npm test` must pass. CI runs it on Node 20, 22 and 24.
