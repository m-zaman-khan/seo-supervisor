// @ts-check
// A command the user can paste into a terminal to confirm a fix, for checks a one-liner can prove; no script runs it.
// The finding's first evidence URL may come from a crawled page, so it goes in only when plain: http(s), printable
// ASCII, and none of ' " ` $ \ (which could end the quotes or start code in sh, bash, zsh or PowerShell) or { } [ ]
// (curl's URL globbing). Single quotes then keep every shell from reading any of it; anything else gets no command.
// Windows PowerShell aliases "curl" to Invoke-WebRequest, so Windows gets curl.exe, which ships with Windows 10 and 11.
// The grep commands need a POSIX shell.
// https://curl.se/windows/microsoft.html
const KINDS = /** @type {[(u: string) => string, string, string[]][]} */ ([
  [
    u => `curl -sI '${u}'`,
    "It prints the status and the response headers. After the fix, the header or status this finding names is right.",
    [
      "no-hsts",
      "hsts-short",
      "hsts-invalid",
      "hsts-no-subdomains",
      "sec-headers",
      "csp-weak",
      "referrer-unsafe",
      "cookie-flags",
      "soft-404",
      "server-error",
    ],
  ],
  [
    u => `curl -sIL '${u}'`,
    "It prints each redirect in turn. After the fix, one permanent redirect (301 or 308) goes straight to the final address, which answers 200.",
    [
      "redirect-chain",
      "slash-redirect-temporary",
      "old-url-temporary",
      "http-not-redirected",
      "http-redirect-hops",
      "host-not-redirected",
      "host-redirect-hops",
      "host-redirect-drops-path",
      "redirect-temporary",
    ],
  ],
  [
    u => `curl -si '${new URL(u).origin}/robots.txt'`,
    "It prints robots.txt with its status. After the fix, it answers 200 and its rules say what you meant.",
    [
      "robots-blocks-all",
      "robots-server-error",
      "robots-missing",
      "robots-blocks-assets",
      "sitemap-not-in-robots",
      "content-signal-invalid",
      "content-signal-placement",
      "ai-robots-conflict",
    ],
  ],
  [
    u => `curl -s -D - '${u}' | grep -ioE -e '^link:.*canonical.*' -e '<link[^>]*canonical[^>]*>'`,
    "It prints the page's canonical. After the fix, there's exactly one, naming the URL you want in search.",
    [
      "canonical-missing",
      "canonical-multiple",
      "canonical-not-self",
      "canonical-query",
      "canonical-origin",
      "canonical-missing-sitewide",
    ],
  ],
  [
    u => `curl -s -D - '${u}' | grep -ioE -e '^x-robots-tag:.*' -e '<meta[^>]*(robots|googlebot)[^>]*>'`,
    "It prints the robots meta tags and any X-Robots-Tag header. After the fix, none of them carries the rule this finding names.",
    [
      "home-noindex",
      "noindex-in-sitemap",
      "noindex-review",
      "robots-conflict",
      "page-nofollow",
      "nosnippet",
      "ai-legacy-noarchive",
    ],
  ],
]);
const BY_CHECK = new Map(KINDS.flatMap(([cmd, hint, ids]) => ids.map(id => [id, { cmd, hint }])));

export const safeUrl = u => {
  try {
    return typeof u === "string" &&
      /^https?:\/\/[\x21-\x7e]+$/i.test(u) &&
      !/['"`$\\{}[\]]/.test(u) &&
      /^https?:$/.test(new URL(u).protocol)
      ? u
      : null;
  } catch {
    return null;
  }
};
// The finding's command and what to look for, or null.
export function recheckOf(f) {
  const k = BY_CHECK.get(f?.check),
    url = k && safeUrl((Array.isArray(f.evidence) ? f.evidence : []).find(e => e?.url)?.url);
  return url ? { command: k.cmd(url), hint: k.hint } : null;
}
export const RECHECK_NOTE =
  "Some findings show a command to check the fix yourself, once it's live. They're for a terminal: macOS, Linux, Git Bash or WSL. Windows 10 and 11 have curl built in: in PowerShell, type curl.exe instead of curl (plain curl there is a different command), and run the ones with grep in Git Bash or WSL. Nothing runs them for you.";
