# Troubleshooting

Start with the readiness check. It changes nothing and contacts nothing:

```bash
node <skill-dir>/scripts/doctor.mjs        # or, in a terminal: npx seo-supervisor doctor
```

It lists Node, Chrome or Edge, the optional add-ons, the settings folder, what's connected and whether this folder can be written to. `ok` is ready, `--` is optional and not set up, `!!` needs fixing.

## Setup

| What you see | Why | What to do |
| --- | --- | --- |
| A script fails at once with a syntax or import error | Node is older than 22 | Install Node 22 or later from nodejs.org. |
| "Chrome or Edge isn't installed" under Limits | The render, phone, lab-speed and back/forward cache checks need a browser | Install Chrome or Edge, or set `CHROME_PATH` to its executable. In a container or CI with neither: `npx seo-supervisor --with-browser` installs Chrome for Testing in the settings folder's `tools`. On Linux it also needs system libraries: run it as root on Debian or Ubuntu, or install them with your package manager. |
| The browser starts but every page fails in a container | Chrome's sandbox doesn't run as root, and a small `/dev/shm` crashes it | The scripts add `--no-sandbox` and `--disable-dev-shm-usage` by themselves when they see root, Docker, Podman or Kubernetes. If yours isn't detected, run the container as a normal user. |
| "Lighthouse isn't installed" in the crawl notes | Lighthouse is an optional add-on | `npx seo-supervisor --with-lighthouse` (about 170 MB, Node 22.19 or later), or `npm i -g lighthouse`, or set `LIGHTHOUSE_PATH`. Everything else works without it. |
| `images.mjs` converts nothing | The image add-on isn't installed | `npx seo-supervisor --with-image-tools` (sharp, about 20 MB). |
| Requests to other sites fail behind a company proxy | Node uses `HTTPS_PROXY` only when asked | Set `NODE_USE_ENV_PROXY=1` (Node 22.21 or later, or 24.5 or later). Chrome gets the same proxy by itself. Behind a proxy, `--check-live` may report the site unreachable: that's the proxy, not the site. |
| Paths like `/blog/` turn into `C:/Program Files/Git/blog/` | Git Bash on Windows rewrites arguments that start with `/` | Put `MSYS_NO_PATHCONV=1` before the command. |
| The home folder can't be written to (CI, a locked-down machine) | Settings, logins and add-ons live in `~/.seo-supervisor` | Set `SEO_SUPERVISOR_HOME` to a folder you can write to. Every script and the installer use it. |

## The crawl

| What you see | Why | What to do |
| --- | --- | --- |
| A pre-launch site looks clean | Per-page checks skip noindex pages | Crawl again with `--ignore-noindex`. |
| "Crawl stopped at 1000 pages (--max)" | The page limit | Raise `--max`. |
| Many 403, 429 or 503 answers, or a bot challenge | Bot protection or a rate limit on the server | Crawl a local production build instead. On production, use `--concurrency 2`. The crawler waits out a 429's Retry-After (30 s at most) by itself. A firewall that turns away Googlebot is its own finding (CRAWL-09). |
| Canonicals point at production while you crawl localhost | Expected | Pass `--site-origin` with the public address; the crawler maps it. |
| "PageSpeed refused the requests" | Google refuses almost every request without a key | Set a free PageSpeed Insights key in `PSI_API_KEY`. Until then PERF-01 is under Limits. |

## Connections

| What you see | Why | What to do |
| --- | --- | --- |
| Signing in to Google from a server or over SSH: the browser can't open, or the last page doesn't load | Google sends the browser back to `http://127.0.0.1` on the machine running the script | Run `node google.mjs connect --paste` in your own terminal. Open the link on any computer, sign in, then copy the address the browser ended on (it starts with `http://127.0.0.1` and shows an error page) and paste it at the prompt. Or use a service account: `node google.mjs guide`. |
| "no sign-in within 5 minutes" | Connect waits 5 minutes | Run `connect` again when you're ready. |
| "Google didn't accept the sign-in" or `invalid_grant` | The sign-in was removed or expired. A client made through the regular Google Cloud setup also ends sign-ins after 7 days until its app is published | Run `node google.mjs connect` again. For such a client, open Google Auth Platform → Audience → Publish app (`google.mjs guide`). |
| "isn't in the Search Console properties this account can see" | You signed in with another Google account | `node google.mjs status` lists what the account sees. Connect with the account that has the site, or add it as a user in Search Console. |
| Google Analytics visits are missing, with a note naming properties | Several GA4 properties, or none with a web stream for this site | Pass the right one: `google.mjs fetch --ga4-property <id>`, and note it in the profile's Connections. |
| A key "doesn't work" though it's saved | A key in the environment wins over the saved one | Check the variable `connect-keys.mjs` names, or unset it. Set keys only with `connect-keys.mjs set <service>` at its hidden prompt, never in chat. |
| An agency's clients share one Google sign-in | One settings folder holds one sign-in | Give each client a name: run the scripts with `SEO_SUPERVISOR_CLIENT=<name>`. Its sign-in and keys then live in `clients/<name>` in the settings folder. |

## The report

| What you see | Why | What to do |
| --- | --- | --- |
| "Not scored: no checked rules in this file" | The JSON has no findings and no passed rules | Copy `findings` and `passed` from the crawl into `seo-audit.json` (`report-format.md`). |
| `--pdf` says no Chrome or Edge was found | Printing uses the installed browser | See "Chrome or Edge isn't installed" above. The HTML and Markdown are written anyway. |
| The score looks different from Lighthouse or another tool | It's SEO Supervisor's own score, not Google's | It counts only the rules this audit checked (`report-format.md`, "The score"). |
| An update notice every week | `update-check.mjs` asks npm once a week | `node update-check.mjs off`, or set `SEO_SUPERVISOR_NO_UPDATE_CHECK=1`. |

Still stuck? Run the failing script on its own: each one prints its usage and a plain reason when it stops.
