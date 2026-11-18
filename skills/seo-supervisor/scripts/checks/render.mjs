// Renders sample pages in an installed Chrome or Edge and compares the result with the raw HTML. The page's own
// scripts, analytics included, run.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHECKS = {
  "render-changes-head": [
    "REND-06",
    "high",
    n => `JavaScript changes the title, canonical or robots tag on ${n} page(s)`,
    "Search engines read the raw HTML first and the rendered page later. When the two disagree, which value wins isn't predictable, and a robots or canonical change can drop a page.",
    "Output the final title, canonical and robots tag in the server HTML and don't change them in client code.",
  ],
  "render-adds-content": [
    "REND-01",
    "medium",
    n => `${n} page(s) get their H1, schema or many links only after JavaScript runs`,
    "Crawlers that don't run JavaScript (most AI crawlers, and Google's first pass) miss whatever only appears after rendering.",
    "Render the H1, JSON-LD and navigation links on the server; keep client JavaScript for interactivity.",
  ],
};

// A CHROME_PATH with no file there (a typo, or a Git Bash /c/... path on Windows) throws rather than quietly running a
// browser nobody chose.
export function findBrowser(env = process.env, platform = process.platform, exists = existsSync) {
  const pf = env.PROGRAMFILES ?? env.ProgramFiles,
    pf86 = env["PROGRAMFILES(X86)"] ?? env["ProgramFiles(x86)"],
    local = env.LOCALAPPDATA ?? env.LocalAppData;
  const candidates =
    {
      win32: [pf, pf86, local]
        .filter(Boolean)
        .flatMap(base => [
          `${base}\\Google\\Chrome\\Application\\chrome.exe`,
          `${base}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ]),
      darwin: [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
      ],
      linux: [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/microsoft-edge",
        "/snap/bin/chromium",
      ],
    }[platform] || [];
  return [env.CHROME_PATH, ...candidates].find(p => p && exists(p)) || null;
}

// The DOM after scripts ran, from a throwaway profile so a running browser isn't touched.
export function renderPage(browser, url, { timeoutMs = 20000 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "seo-supervisor-render-"));
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    `--user-data-dir=${profile}`,
    "--virtual-time-budget=5000",
    "--dump-dom",
    url,
  ];
  return new Promise((ok, fail) =>
    execFile(browser, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {}
      if (err) {
        err.stderr = stderr;
        fail(err);
      } else ok(stdout);
    }),
  );
}

// Chrome's DOM dump writes characters out literally, so both sides are fully decoded before comparing.
const NAMED = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  middot: "·",
  bull: "•",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  aacute: "á",
  agrave: "à",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  ccedil: "ç",
  ouml: "ö",
  uuml: "ü",
  auml: "ä",
  szlig: "ß",
};
const decode = s =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16));
      } catch {
        return m;
      }
    })
    .replace(/&#(\d+);/g, (m, d) => {
      try {
        return String.fromCodePoint(Number(d));
      } catch {
        return m;
      }
    })
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m)
    .replace(/[\s ]+/g, " ")
    .trim();
const sameUrl = (a, b) => {
  try {
    return new URL(a, "https://x.invalid/").href === new URL(b, "https://x.invalid/").href;
  } catch {
    return a === b;
  }
};
const attrsOf = tag =>
  Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m => [
      m[1].toLowerCase(),
      m[2] ?? m[3] ?? m[4],
    ]),
  );
function read(html) {
  const tags = name => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map(m => attrsOf(m[0]));
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return {
    title: title ? decode(title[1]) : null,
    canonical: (c => (c == null ? null : decode(c)))(
      tags("link").find(l => (l.rel || "").toLowerCase().split(/\s+/).includes("canonical"))?.href,
    ),
    robots:
      tags("meta")
        .find(m => (m.name || "").toLowerCase() === "robots")
        ?.content?.toLowerCase()
        .replace(/\s+/g, "") ?? null,
    h1: h1 ? decode(h1[1].replace(/<[^>]+>/g, " ")) : null,
    jsonld: (html.match(/<script\b[^>]*application\/ld\+json/gi) || []).length,
    links: (html.match(/<a\b[^>]*\bhref\s*=/gi) || []).length,
  };
}

export function compareRendered(rawHtml, renderedHtml) {
  const a = read(rawHtml),
    b = read(renderedHtml),
    out = [];
  for (const field of ["title", "canonical", "robots", "h1"]) {
    const same =
      field === "canonical" && a.canonical && b.canonical
        ? sameUrl(a.canonical, b.canonical)
        : (a[field] ?? "") === (b[field] ?? "");
    if (!same) out.push({ field, raw: a[field], rendered: b[field] });
  }
  if (b.jsonld > a.jsonld) out.push({ field: "jsonld-count", raw: a.jsonld, rendered: b.jsonld });
  // At least 10 more, since a consent banner in a fresh profile adds a few.
  if (b.links > a.links * 1.5 && b.links - a.links >= 10)
    out.push({ field: "link-count", raw: a.links, rendered: b.links });
  return out;
}
