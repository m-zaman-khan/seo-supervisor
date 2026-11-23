# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 2.x | Yes |
| 1.x | No |

Security fixes go into the latest 2.x release.

## Reporting a vulnerability

Report security issues privately through GitHub. Open the repository's **Security** tab and choose **Report a vulnerability**, or go straight to [github.com/m-zaman-khan/seo-supervisor/security/advisories/new](https://github.com/m-zaman-khan/seo-supervisor/security/advisories/new).

Please don't open a public issue for a security problem.

Include what you ran, what happened and what you expected. A minimal reproduction helps most.

## What counts

SEO Supervisor runs on your machine, inside your coding agent, so these matter most:

- **A way past the guard:** an agent makes a change the guard should have stopped or asked about.
- **A leaked secret:** a key, token or sign-in ends up in a log, a report, a finding or the agent's chat.
- **An unapproved outside request:** something is sent to an outside service without the user's yes, whether by the crawler, a connection or the update check.
- **Hostile page content:** a crawled page makes the crawler or the report run code, read files outside the project, or reach private network addresses.

Problems in a site that SEO Supervisor audits belong to that site, not to this project.

## What to expect

This is a volunteer project, so responses are best effort:
- You'll get an acknowledgement as soon as possible.
- You'll get updates while the fix is made.
- You'll get credit in the release notes, unless you'd rather not be named.
