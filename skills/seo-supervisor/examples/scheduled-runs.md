# Scheduled runs (opt-in)

A scheduled run crawls the live site, compares it with the last crawl, and files it in `seo-audit/history/`. The next audit's "Since last audit" tab and its audit timeline then cover every run, not just the last two audits.

It runs no agent. The crawler fetches only the site you name, and `seo-diff.mjs` reads local files. No outside checks run, so nothing goes to Google or anyone else. Nothing is installed by default: agents set one up only when the owner says yes.

## What it runs

From the project folder:

```sh
node .agents/skills/seo-supervisor/scripts/seo-crawl.mjs --url https://www.example.com --out seo-audit/seo-crawl.json
node .agents/skills/seo-supervisor/scripts/seo-diff.mjs --history seo-audit/history seo-audit/seo-crawl.json --out seo-audit/seo-diff.json --fail-on-regressions
```

- `--history` compares with the newest crawl in `seo-audit/history/`, adds the timeline, then files this crawl there as `<date>-seo-crawl.json`. The first run only files.
- `--fail-on-regressions` exits with code 1 when something got worse (a page now fails, went noindex, lost its H1 …), so the scheduler can tell you. The diff is written first.
- The paths assume a project install for most agents. Claude Code's is `.claude/skills/seo-supervisor/`, and a user install sits in your home folder.
- The crawler reads up to 1,000 pages (`--max`). Pick a quiet hour.

A full audit, with findings checked and the report written, needs your agent. Most agents have a mode a scheduler can start, but it runs without you there to approve each step, so it isn't covered here.

## Linux and macOS: cron

Run `crontab -e` and add one line. This one runs every Monday at 06:00. cron has a short PATH, so give node's full path (`command -v node` prints it):

```
0 6 * * 1 cd /path/to/project && /usr/bin/node .agents/skills/seo-supervisor/scripts/seo-crawl.mjs --url https://www.example.com --out seo-audit/seo-crawl.json >> seo-audit/schedule.log 2>&1 && /usr/bin/node .agents/skills/seo-supervisor/scripts/seo-diff.mjs --history seo-audit/history seo-audit/seo-crawl.json --out seo-audit/seo-diff.json >> seo-audit/schedule.log 2>&1
```

To stop it, delete the line with `crontab -e`.

## Windows: Task Scheduler

Save this as `seo-schedule.cmd` in the project folder:

```bat
@echo off
cd /d C:\path\to\project
node .agents\skills\seo-supervisor\scripts\seo-crawl.mjs --url https://www.example.com --out seo-audit\seo-crawl.json >> seo-audit\schedule.log 2>&1 || exit /b 1
node .agents\skills\seo-supervisor\scripts\seo-diff.mjs --history seo-audit\history seo-audit\seo-crawl.json --out seo-audit\seo-diff.json >> seo-audit\schedule.log 2>&1
```

Then create a weekly task (Mondays at 06:00). It runs while you're signed in:

```bat
schtasks /Create /TN "SEO Supervisor weekly" /SC WEEKLY /D MON /ST 06:00 /TR "C:\path\to\project\seo-schedule.cmd"
```

To stop it: `schtasks /Delete /TN "SEO Supervisor weekly" /F`.

## GitHub Actions

Save as `.github/workflows/seo-weekly.yml`. It needs a committed project install. It commits the new crawl to `seo-audit/history/`, so the next run can compare with it. When something got worse, the job fails and GitHub emails you. The schedule is in UTC.

```yaml
name: SEO weekly crawl

on:
  schedule:
    - cron: "0 6 * * 1"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  crawl:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Crawl the live site
        run: node .agents/skills/seo-supervisor/scripts/seo-crawl.mjs --url https://www.example.com --out seo-audit/seo-crawl.json
      - name: Compare with the last crawl and file this one
        run: node .agents/skills/seo-supervisor/scripts/seo-diff.mjs --history seo-audit/history seo-audit/seo-crawl.json --out seo-audit/seo-diff.json --fail-on-regressions
      - name: Commit the history
        if: always()
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add seo-audit/history
          git commit -m "SEO crawl $(date -u +%F)" || exit 0
          git push
```

Each run adds one crawl file to the repository.
