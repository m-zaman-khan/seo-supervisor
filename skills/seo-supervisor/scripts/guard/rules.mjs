// @ts-check
// The guard's rules: what an agent is about to do, checked against the actions that need a yes first. Adapters turn
// their payloads into { kind: "bash", command } (Bash or PowerShell), { kind: "edit", file, before, after } (whole
// texts; a new file's before is ""), { kind: "delete", file } (removed or moved) or { kind: "prompt", text }.
// No network access; the disk is read only to look inside a folder about to be deleted.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hideSecrets } from "../lib/redact.mjs";
import { allowedBy, groupFor, groupOf, parseRobots } from "../lib/robots.mjs";
import { modeOf } from "./mode.mjs";

const ALLOW = Object.freeze({ decision: "allow" });
const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));

/** @param {any} action @param {{ mode?: string, settings?: any, cwd?: string }} [opts] @returns {{ decision: "allow"|"ask"|"deny", reason?: string, rule?: string }} */
export function checkAction(action, { mode = "ask", settings = {}, cwd = process.cwd() } = {}) {
  if (mode === "off" || !action || typeof action !== "object") return ALLOW;
  const hit =
    action.kind === "bash"
      ? bashHit(String(action.command ?? ""), settings || {}, cwd)
      : action.kind === "edit"
        ? editHit(action, cwd)
        : action.kind === "delete"
          ? deleteHit(String(action.file ?? ""), cwd)
          : action.kind === "prompt"
            ? promptHit(String(action.text ?? ""))
            : null;
  if (!hit) return ALLOW;
  // A key is refused in every mode but off: pausing to ask would leave it in the conversation either way.
  return { decision: hit.rule === "key" || mode === "block" ? "deny" : "ask", reason: hit.reason, rule: hit.rule };
}

// ---------- files ----------
const posix = f => String(f || "").replace(/\\/g, "/");
// The path as the project sees it: relative to the working folder when it's inside it, so a parent folder named
// "pages" never makes every file a page.
const rel = (f, cwd) => {
  const p = isAbsolute(f) ? relative(cwd, f) : f;
  return posix(p.startsWith("..") || isAbsolute(p) ? f : p);
};
const nameOf = f => posix(f).split("/").pop().toLowerCase();

export const isRobotsFile = f => /^robots\.(txt|[cm]?[jt]sx?)$/.test(nameOf(f));
// Framework config files that can hold redirects, rewrites, a base path or robots settings (a hand-picked list).
export const isFrameworkConfig = f =>
  /^((next|astro|nuxt|svelte|remix|vite|docusaurus|gridsome|vue)\.config|gatsby-(node|config))\.[cm]?[jt]s$/.test(
    nameOf(f),
  );
const JSON_REDIRECTS = new Set(["vercel.json", "firebase.json", "staticwebapp.config.json"]);
const LINE_REDIRECTS = new Set([
  "_redirects",
  ".htaccess",
  "netlify.toml",
  "web.config",
  "caddyfile",
  "nginx.conf",
  "routes.rb",
  "urls.py",
]);
// Next.js 16 renamed middleware to proxy; both are read line by line.
// https://nextjs.org/docs/app/api-reference/file-conventions/proxy
const isMiddleware = f => /^(middleware|proxy)\.[cm]?[jt]s$/.test(nameOf(f));
export const isRedirectFile = f => {
  const n = nameOf(f);
  return (
    JSON_REDIRECTS.has(n) || LINE_REDIRECTS.has(n) || n.endsWith(".conf") || isFrameworkConfig(f) || isMiddleware(f)
  );
};
const BUILT = /(^|\/)(node_modules|\.git|\.next|\.nuxt|\.svelte-kit|\.astro|dist|build|out|coverage|vendor)\//;
const PAGE_EXT =
  "(?:[cm]?[jt]sx?|mdx?|markdown|vue|svelte|astro|html?|php|erb|liquid|njk|hbs|ejs|twig|pug|jinja|j2|cshtml|tmpl)";
// Page and route files (a hand-picked list): Next.js app/…/page and route; pages/ or routes/ folders minus pages/api/
// and _app-style files; Markdown in a content folder; any .html file.
const PAGE_RES = [
  new RegExp(`(^|/)app/(.+/)?(page|route)\\.${PAGE_EXT}$`),
  new RegExp(`(^|/)(pages|routes)/(?!api/)(.+/)?[^_/][^/]*\\.${PAGE_EXT}$`),
  /(^|\/)(content|_posts|posts|blog|articles|docs)\/.+\.(mdx?|markdown|html?)$/,
  /\.html?$/,
];
export const isPageFile = (f, cwd = process.cwd()) => {
  const p = rel(f, cwd);
  return !BUILT.test(p) && PAGE_RES.some(re => re.test(p));
};
const isSitemapFile = f => /^sitemap[\w.-]*\.(xml|[cm]?[jt]s)$/.test(nameOf(f));

// ---------- edits ----------
// The unchanged start and end are skipped and the middle counted as a multiset, so a moved line is neither added nor
// removed.
function lineDiff(before, after) {
  const a = before.split("\n"),
    b = after.split("\n");
  let s = 0,
    e = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const left = new Map(),
    added = [];
  for (const l of a.slice(s, a.length - e)) left.set(l, (left.get(l) || 0) + 1);
  for (const l of b.slice(s, b.length - e)) {
    const n = left.get(l);
    if (n) left.set(l, n - 1);
    else added.push(l);
  }
  return { added, removed: [...left].flatMap(([l, n]) => Array(n).fill(l)) };
}
const count = (re, s) => (s.match(re) || []).length;

// noindex as search engines read it, never the word in prose: a robots or crawler meta tag saying noindex or none; an
// X-Robots-Tag header (_headers, Apache, nginx, next.config, setHeader); a robots value or metadata object
// (`robots: { index: false }`, front matter `robots: noindex`); a noindex prop or key set to true. Header and robots
// values are cut at their quote or line end before the word is tested, so a long line can't backtrack, and the word
// must stand as a directive ("Robots: none of them" isn't one). A meta tag ends at > or the next <, so it's read once.
const META = /<meta\b[^<>]*>/gi,
  META_ROBOTS = /\bname\s*=\s*\{?\s*["'`]?(?:robots|googlebot|googlebot-news|bingbot)\b/i,
  META_NOINDEX = /\bcontent\s*=\s*\{?\s*["'`][^"'`]*\b(?:noindex|none)\b/i;
const VALUES = [
  /x-robots-tag["'`]?\]?(?:\s*[:=]|\s*,(?:\s*value\s*:)?|\s)\s*["'`]?([^"'`\n]*)/gi,
  /\brobots["']?\s*[:=]\s*["'`]?([^"'`\n{]*)/gi,
];
const NOINDEX_WORD = /\b(?:noindex|none)\s*(?:[,;)}\]]|$|\s+(?:nofollow|follow|noarchive|nosnippet)\b)/i;
const NOINDEX = [/\brobots\s*:\s*\{[^}]*?\bindex\s*:\s*false\b/gi, /\bnoindex\s*[:=]\s*(?:\{\s*)?true\b/gi];
const noindexCount = s =>
  (s.match(META) || []).filter(t => META_ROBOTS.test(t) && META_NOINDEX.test(t)).length +
  NOINDEX.reduce((n, re) => n + count(re, s), 0) +
  VALUES.reduce((n, re) => n + [...s.matchAll(re)].filter(m => NOINDEX_WORD.test(m[1])).length, 0);

// A canonical in the forms sites set it: <link rel="canonical">, a Link header, Next.js alternates.canonical or
// { canonical }, front matter canonical/canonical_url/canonicalURL, a head library's { rel: 'canonical' }. Each is
// compared without spacing, from the < { or line start before it to the > } or line end after (500 characters at most
// each way), so an edit elsewhere on a one-line page doesn't count. Only the first 200 are read, to stay fast.
const CANONICAL =
  /rel\s*=\s*\{?\s*["'`]?canonical\b|\bcanonical(?:_?url|URL)?["'`]?\s*[:=]|["'`]canonical["'`]\s*[:,]|\{\s*canonical\s*[,}]|,\s*canonical\s*\}/gi;
const canonicals = s =>
  [...s.matchAll(CANONICAL)].slice(0, 200).map(m => {
    const from = Math.max(0, m.index - 500),
      head = s.slice(from, m.index),
      z = m.index + m[0].length,
      tail = s.slice(z, z + 500).search(/[>}\n]/);
    return s
      .slice(
        from + Math.max(head.lastIndexOf("<"), head.lastIndexOf("{"), head.lastIndexOf("\n")) + 1,
        tail < 0 ? z + 500 : z + tail + 1,
      )
      .replace(/\s+/g, "");
  });

// Redirect and URL rules: in JSON and JS configs, the whole block after one of these keys (Next.js redirects(), Astro
// redirects, Nuxt routeRules, Gatsby createRedirect, base path, trailing slash); in line-based server files, the lines
// that name a redirect or rewrite.
const SECTION_KEYS = /\b(redirects|rewrites|routeRules|createRedirect|trailingSlash|cleanUrls|basePath|i18n)\b/g,
  SCALAR = new Set(["trailingSlash", "cleanUrls", "basePath"]);
function sections(text) {
  const out = [];
  let seen = 0; // a key inside a block already taken is part of it, so the text is read once
  for (const m of text.matchAll(SECTION_KEYS)) {
    if (m.index < seen) continue;
    const i = m.index + m[0].length,
      nl = text.indexOf("\n", i),
      at = SCALAR.has(m[1]) ? -1 : text.slice(i, i + 200).search(/[{[]/);
    if (at < 0) {
      out.push(m[0] + text.slice(i, nl < 0 ? undefined : nl).replace(/\s+/g, ""));
      continue;
    } // a value on its line
    let depth = 0,
      j = i + at; // plain bracket counting: a bracket inside a string can end a block early
    for (; j < text.length && j - i < 20000; j++) {
      const c = text[j];
      if (c === "{" || c === "[") depth++;
      else if ((c === "}" || c === "]") && --depth === 0) break;
    }
    out.push(m[0] + text.slice(i, j + 1).replace(/\s+/g, ""));
    seen = j;
  }
  return out.join("\n");
}
const REDIRECT_LINE = /redirect|rewrite|\breturn\s+30[1278]\b|\bredir\b|^\s*(?:from|to|status|force)\s*=/i;

let bots;
const aiBots = () =>
  (bots ||= JSON.parse(readFileSync(join(SCRIPTS, "data", "ai-bots.json"), "utf8")).map(b => b.name));
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const botsIn = lines =>
  aiBots().filter(n => lines.some(l => new RegExp(`(?<![\\w-])${esc(n)}(?![\\w-])`, "i").test(l)));
const list = a => (a.length > 3 ? `${a.slice(0, 3).join(", ")} and ${a.length - 3} more` : a.join(", "));

const GOOGLE_DROP = "Every page would drop out of Google.";
function robotsHit(file, before, after, added, removed) {
  const name = basename(posix(file)),
    changed = [...added, ...removed];
  if (nameOf(file) === "robots.txt") {
    const b = parseRobots(before),
      a = parseRobots(after),
      blocked = (r, ua) => !allowedBy(groupOf(r, ua), "/");
    if (blocked(a, "*") && !blocked(b, "*"))
      return {
        rule: "robots",
        reason: `This makes ${name} block every crawler from the whole site (Disallow: /). ${GOOGLE_DROP}`,
      };
    if (blocked(a, "googlebot") && !blocked(b, "googlebot"))
      return { rule: "robots", reason: `This makes ${name} block Googlebot from the whole site. ${GOOGLE_DROP}` };
    if (b.sitemaps.some(s => !a.sitemaps.includes(s)))
      return {
        rule: "robots",
        reason: `This removes a Sitemap line from ${name}, so search engines lose the list of pages it points them to.`,
      };
    const ai = aiBots().filter(n => JSON.stringify(groupFor(b, n)) !== JSON.stringify(groupFor(a, n)));
    if (ai.length)
      return {
        rule: "ai-policy",
        reason: `This changes what AI crawlers may read (${list(ai)}). It decides whether AI search tools and assistants can see and cite the site.`,
      };
    const rules = added.map(l => l.trim()).filter(l => /^(dis)?allow\s*:/i.test(l));
    return {
      rule: "robots",
      reason: `This edits ${name}, which tells search engines what they may crawl${rules.length ? `. It adds: ${list(rules)}` : ""}. A wrong line can hide pages from Google.`,
    };
  }
  const ai = botsIn(changed);
  if (ai.length)
    return {
      rule: "ai-policy",
      reason: `This changes the robots rules for AI crawlers (${list(ai)}) in ${name}. It decides whether AI search tools and assistants can see and cite the site.`,
    };
  if (added.some(l => /disallow\s*:\s*\[?\s*["'`]\/["'`]/i.test(l)))
    return {
      rule: "robots",
      reason: `This adds disallow: "/" to the robots rules in ${name}. If it applies to all crawlers, ${GOOGLE_DROP.toLowerCase()}`,
    };
  if (removed.some(l => /sitemap/i.test(l)) && count(/sitemap/gi, after) < count(/sitemap/gi, before))
    return {
      rule: "robots",
      reason: `This removes the sitemap from the robots rules in ${name}, so search engines lose the list of pages it points them to.`,
    };
  return {
    rule: "robots",
    reason: `This changes the code that builds robots.txt (${name}), which tells search engines what they may crawl. A wrong rule can hide pages from Google.`,
  };
}

// seo-audit/settings.json, in any folder, holds the guard's mode and the user's yes for outside checks. An edit asks
// when the guard ends up lower (off < ask < block; missing or unknown is ask), outside checks turn on, or approved
// gains a check. Text that isn't JSON counts as {}, as the guard reads it.
const isGuardSettings = f => /(^|\/)seo-audit\/settings\.json$/i.test(posix(f));
const LEVEL = { off: 0, ask: 1, block: 2 };
const parsed = t => {
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
};
const OWNER_ONLY =
  "Only the owner should change this: the file holds the guard's mode and their yes for outside checks.";
function settingsHit(file, before, after, cwd) {
  const b = parsed(before),
    a = parsed(after),
    was = modeOf(b.guard),
    now = modeOf(a.guard),
    added = approvedIn(a).filter(n => !approvedIn(b).includes(n));
  const what =
    LEVEL[now] < LEVEL[was]
      ? `sets the guard from ${was} to ${now}`
      : outsideOn(a) && !outsideOn(b)
        ? "turns outside checks on"
        : added.length
          ? `adds ${list(added)} to the outside checks the owner approved`
          : "";
  return what ? { rule: "settings", reason: `This ${what} in ${rel(file, cwd)}. ${OWNER_ONLY}` } : null;
}
// From the shell, where the new text can't be seen: a > redirect to it; tee, Set-Content, Out-File, Add-Content,
// New-Item or sed -i on it; or a copy or move onto it.
const WRITERS = new Set(["tee", "set-content", "sc", "add-content", "ac", "out-file", "new-item", "ni"]),
  COPY = new Set(["cp", "copy", "copy-item", "cpi"]);
function settingsWrite(words, cmd) {
  if (
    words.some(
      (w, i) =>
        isGuardSettings(w.slice(w.lastIndexOf(">") + 1)) && (w.includes(">") || /^\d*>>?$/.test(words[i - 1] ?? "")),
    )
  )
    return true;
  if (WRITERS.has(cmd) || (cmd === "sed" && words.some(w => /^(-i|--in-place)/.test(w))))
    return words.slice(1).some(isGuardSettings);
  if (COPY.has(cmd) || MOVE.has(cmd)) {
    const p = positional(words.slice(1));
    return isGuardSettings(p.dest ?? p.out.at(-1) ?? "");
  }
  return false;
}

function editHit(action, cwd) {
  if (typeof action.file !== "string" || !action.file) return null;
  const file = action.file,
    before = String(action.before ?? "").replace(/\r\n/g, "\n"),
    after = String(action.after ?? "").replace(/\r\n/g, "\n");
  if (before === after) return null;
  if (isGuardSettings(file)) return settingsHit(file, before, after, cwd);
  // Only robots, config and redirect files need the line diff; a page's edit is read whole.
  const name = basename(posix(file)),
    n = nameOf(file),
    config = isFrameworkConfig(file),
    diff = isRobotsFile(file) || isRedirectFile(file) ? lineDiff(before, after) : null;
  const { added = [], removed = [] } = diff || {},
    changed = [...added, ...removed];
  if (isRobotsFile(file)) return robotsHit(file, before, after, added, removed);
  if (noindexCount(after) > noindexCount(before))
    return {
      rule: "noindex",
      reason: `This adds a noindex rule to ${name}. Every page that uses it would drop out of Google's results.`,
    };
  if (config && changed.some(l => /(?<!x-)\brobots\b/i.test(l))) return robotsHit(file, before, after, added, removed);
  const redirects =
    n === "_redirects"
      ? changed.some(l => l.trim())
      : JSON_REDIRECTS.has(n) || config
        ? sections(before) !== sections(after)
        : isRedirectFile(file) && changed.some(l => REDIRECT_LINE.test(l));
  if (redirects)
    return {
      rule: "redirects",
      reason: `This changes the redirect or URL rules in ${name}. Addresses that people and Google already know could stop working or point somewhere new.`,
    };
  if (before.trim() && !after.trim() && isPageFile(file, cwd))
    return {
      rule: "page-remove",
      reason: `This empties ${name}, which removes that page. Anyone following a link or a Google result to it would get a missing page.`,
    };
  const was = /canonical/i.test(before) ? canonicals(before) : [],
    now = was.length ? canonicals(after) : [];
  if (was.some(c => !now.includes(c)))
    return {
      rule: "canonical",
      reason: `This ${now.length < was.length ? "removes" : "changes"} the canonical in ${name}. Google could then treat another address as the main one, or pick one itself.`,
    };
  return null;
}

// ---------- deletes ----------
// A folder holds a page if any file in it, up to 2,000 entries, is one (dependency and build folders skipped).
function folderHasPage(dir, cwd) {
  const stack = [dir];
  let seen = 0;
  while (stack.length && seen < 2000) {
    const d = stack.pop();
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      seen++;
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (!/^(node_modules|\.git|dist|build|out|\.next)$/.test(e.name)) stack.push(p);
      } else if (isPageFile(p, cwd)) return true;
    }
  }
  return false;
}
function deleteHit(file, cwd) {
  if (!file) return null;
  const name = basename(posix(file));
  if (isGuardSettings(file)) {
    let s = {};
    try {
      s = parsed(readFileSync(resolve(cwd, file), "utf8"));
    } catch {}
    return modeOf(s.guard) === "block"
      ? {
          rule: "settings",
          reason: `This removes ${rel(resolve(cwd, file), cwd)}, which sets the guard to block, so the guard would go back to asking. ${OWNER_ONLY}`,
        }
      : null;
  }
  if (isRobotsFile(file))
    return { rule: "robots", reason: `This removes ${name}, and with it every crawl rule and its Sitemap line.` };
  if (isRedirectFile(file) && !isFrameworkConfig(file))
    return {
      rule: "redirects",
      reason: `This removes ${name} and the redirects in it. Old addresses would stop forwarding to the new ones.`,
    };
  const full = resolve(cwd, file);
  let folder = false;
  try {
    folder = existsSync(full) && statSync(full).isDirectory();
  } catch {}
  if (folder ? folderHasPage(full, cwd) : isPageFile(full, cwd))
    return {
      rule: "page-remove",
      reason: `This removes or moves ${posix(rel(full, cwd))}, so that page leaves its address. Anyone following a link or a Google result to it would get a missing page, unless a 301 redirect sends them on.`,
    };
  return null;
}

// ---------- shell commands ----------
// Splits on unquoted && || ; | & and newlines, then into words with quotes removed. Backslashes stay, since Windows
// paths use them. $( ) (in double quotes too) and ( ) subshells are read as subcommands, a $( ) leaving "$(…)" in its
// word. A backtick span is read as a command but also left in place, since PowerShell's backtick is an escape.
// PIPED maps a subcommand after a single | to the one whose output it reads.
const closing = (s, i) => {
  let d = 0,
    q = "";
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (q) {
      if (c === q) q = "";
    } else if (c === '"' || c === "'") q = c;
    else if (c === "(") d++;
    else if (c === ")" && --d === 0) return j;
  }
  return s.length;
};
function subcommands(cmd, depth = 0) {
  const out = [];
  let words = [],
    cur = "",
    q = "",
    has = false;
  const word = () => {
    if (has) words.push(cur);
    cur = "";
    has = false;
  };
  const end = () => {
    word();
    if (words.length) out.push(words);
    words = [];
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === "(" && q !== "'" && depth < 8 && (cur.endsWith("$") || (!q && !has))) {
      const j = closing(cmd, i);
      out.push(...subcommands(cmd.slice(i + 1, j), depth + 1));
      if (has) cur += "(…)";
      i = j;
      continue;
    }
    if (q) {
      if (c === q) q = "";
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      has = true;
    } else if (c === "&" || c === "|" || c === ";" || c === "\n") {
      end();
      if (cmd[i + 1] === c) i++;
    } else if (/\s/.test(c)) word();
    else {
      cur += c;
      has = true;
    }
  }
  end();
  return out;
}
const WRAPPERS = new Set([
  "sudo",
  "time",
  "nice",
  "nohup",
  "env",
  "command",
  "builtin",
  "exec",
  "npx",
  "bunx",
  "noglob",
  "xargs",
]);
// A rename (Rename-Item and its aliases rni and ren, cmd's rename) moves a page off its address like mv does.
const DELETE = new Set(["rm", "del", "erase", "rmdir", "rd", "remove-item", "ri", "unlink"]),
  MOVE = new Set(["mv", "move", "move-item", "mi", "rename-item", "rni", "ren", "rename"]);
const NAMED = /^-(path|literalpath|lp|destination|dest|newname|include|exclude|filter)$/i;
// Non-option words; a PowerShell -Destination or -NewName value, and mv's -t or --target-directory, come back as dest.
function positional(args) {
  const out = [];
  let dest = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-t" || a === "--target-directory") dest = args[++i];
    else if (a.startsWith("--target-directory=")) dest = a.slice(19);
    else if (NAMED.test(a)) {
      const v = args[++i];
      if (/^-(dest|newname)/i.test(a)) dest = v;
      else if (/^-(path|literalpath|lp)$/i.test(a) && v) out.push(v);
    } else if (!a.startsWith("-")) out.push(a);
  }
  return { out, dest };
}
const yes = a => a.some(x => x === "--yes" || x.startsWith("--yes="));
const outsideOn = s => s?.outsideChecks === true || s?.outsideChecks?.on === true;
// The approved checks, by the names SKILL.md stores in outsideChecks.approved. A legacy "outsideChecks": true means
// the first list only.
const FIRST_LIST = ["speed", "render", "lighthouse", "intent", "brand", "updates"];
const approvedIn = s =>
  s?.outsideChecks === true
    ? FIRST_LIST
    : Array.isArray(s?.outsideChecks?.approved)
      ? s.outsideChecks.approved.map(String)
      : [];
/** A flag's value: --name value, --name=value, or "" when it's last; undefined when it isn't there. */
const flagValue = (a, f) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] === f) return a[i + 1] ?? "";
    if (a[i].startsWith(`${f}=`)) return a[i].slice(f.length + 1);
  }
  return undefined;
};
const hostOf = u => {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};
// The crawler's flags that reach past the site being crawled, each with the check name SKILL.md asks a separate yes
// for. --outside itself needs outsideChecks.on; --check-live only contacts the site's own --site-origin. A flag=value
// entry needs that value.
const CRAWL_OUTSIDE = [
  [
    "outbound-links",
    "--outbound-links",
    "This visits up to 100 other websites the pages link to, to find broken links. Those sites see the visits.",
  ],
  [
    "hreflang-other-sites",
    "--hreflang-other-sites",
    "This visits up to 20 language versions of the pages on other websites, to see whether they link back.",
  ],
  [
    "ai-bot-probe",
    "--ai-bot-probe",
    "This asks up to 3 pages again pretending to be AI search crawlers. A strict firewall may block this computer for a while.",
  ],
  ["desktop", "--desktop", "This sends the sample pages to Google PageSpeed again, for desktop."],
  [
    "render-all",
    "--render=all",
    "This renders every indexable page (up to 200) in a headless browser, where each page's own scripts run, analytics included.",
  ],
  [
    "lighthouse",
    "--lighthouse",
    "This runs Lighthouse on the site's pages, where each page's own scripts run, analytics included.",
  ],
];
const hasFlag = (a, f) => {
  const [k, v] = f.split("="),
    x = flagValue(a, k);
  return v ? x === v : x !== undefined;
};
function crawlHit(args, settings) {
  if (args.includes("--outside") && !outsideOn(settings))
    return {
      rule: "outside",
      reason:
        "This turns on outside checks: page addresses go to Google PageSpeed, and a headless browser runs the site's own scripts. seo-audit/settings.json doesn't record the owner's yes for them yet.",
    };
  const ok = approvedIn(settings),
    off = CRAWL_OUTSIDE.find(([name, flag]) => hasFlag(args, flag) && !ok.includes(name));
  if (off)
    return {
      rule: "outside",
      reason: `${off[2]} It needs its own yes: seo-audit/settings.json's outsideChecks.approved doesn't list "${off[0]}" yet.`,
    };
  // A page picked to render needs its own yes each time when it's on another site. The test-only endpoints would
  // receive the PageSpeed key.
  const page = flagValue(args, "--render-page");
  if (
    page !== undefined &&
    ![hostOf(flagValue(args, "--url")), hostOf(flagValue(args, "--site-origin"))].includes(hostOf(page))
  )
    return {
      rule: "outside",
      reason: `This renders ${page || "a page"} in a headless browser. It isn't on the site being crawled, so that other site sees the visit and its own scripts run.`,
    };
  const at = ["--psi-endpoint", "--crux-endpoint"].find(f => flagValue(args, f) !== undefined);
  if (at)
    return {
      rule: "outside",
      reason: `This sends the speed requests, with the PageSpeed key, to ${flagValue(args, at) || "another address"} instead of Google.`,
    };
  return null;
}
// What each script does once given --yes, worded for the prompt that asks.
const OUTSIDE = {
  google: a =>
    a[0] === "submit-sitemap" &&
    yes(a) &&
    "This submits the sitemap to Google Search Console, a change in the owner's Google account.",
  "connect-keys": a =>
    yes(a) &&
    ({
      "submit-bing": "This asks Bing to crawl these addresses, through the owner's Bing Webmaster Tools account.",
      fetch:
        "This sends the site's address and domain names to every connected service that has a key (Bing, Moz and the others).",
      test: "This sends the saved token to Matomo or PostHog to test it.",
    }[a[0]] ||
      "This contacts a connected service with the owner's key."),
  indexnow: a =>
    yes(a) &&
    "This sends the listed addresses to IndexNow, which passes them on to Bing, Yandex and other search engines.",
  issues: a =>
    yes(a) &&
    "This files GitHub issues in the repository with the owner's own gh login. Everyone who can see the repository sees them.",
  "ai-answers": a =>
    yes(a) &&
    "This asks Perplexity or OpenAI the owner's questions with the owner's keys, and each question costs money.",
  "geo-grid": a =>
    yes(a) &&
    "This sends the business's search phrases and map points to Google Places with the owner's key. It can cost money.",
  rdap: a => yes(a) && "This sends the domain names to IANA and to each domain's registry.",
  osm: a => yes(a) && "This sends the business's address to OpenStreetMap, and asks for similar businesses nearby.",
  commoncrawl: a => yes(a) && "This downloads data about links to the site from Common Crawl.",
  backlinks: a => yes(a) && "This visits up to 100 pages on other people's websites. Those sites see the visits.",
  "google-updates": a => yes(a) && "This reads Google's public Search Status Dashboard over the internet.",
  images: a =>
    yes(a) &&
    (a.includes("--label-ai")
      ? "This writes an AI-generated label into these image files."
      : "This writes smaller copies of the site's images into the project. The originals are kept."),
  "log-scan": a => {
    const i = a.indexOf("--verify-ips");
    return (
      i >= 0 &&
      !(a[i + 1] && !a[i + 1].startsWith("-")) &&
      "This downloads the crawler companies' public lists of addresses, and asks this computer's DNS server about addresses that claim to be YandexBot."
    );
  },
  "schema-check": a =>
    a.includes("--allow-remote") && "This lets the structured data check download pages from other websites.",
};
const KEY_HINT = key => `node "${join(SCRIPTS, "connect-keys.mjs")}" set ${key}`;
// Where --yes could hide in an argument: $X, ${X}, $(…), cmd's %X% (not a %-escape like %E2%) and PowerShell's @splat.
const VARIABLE = /\$[\w{(]|%(?![0-9a-f]{2})[a-z_]\w*%|^@\w+$/i;
const SHELL = /^(bash|sh|zsh|dash|ksh)$/;
// The command string another shell is handed: bash -c "…" (or -lc), powershell -Command "…" (any short form), cmd /c ….
function shellString(cmd, words) {
  const at = SHELL.test(cmd)
    ? words.findIndex((w, i) => i > 0 && /^-[a-z]*c[a-z]*$/i.test(w))
    : /^(powershell|pwsh)$/.test(cmd)
      ? words.findIndex(w => /^[-/]c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(w))
      : cmd === "cmd"
        ? words.findIndex(w => /^\/[ck]$/i.test(w))
        : -1;
  return at < 1 ? null : SHELL.test(cmd) ? (words[at + 1] ?? "") : words.slice(at + 1).join(" ");
}

function bashHit(command, settings, cwd, dir = cwd, depth = 0) {
  for (let words of subcommands(command)) {
    // Wrappers that run the rest: sudo, env and the like; timeout with its options and duration; stdbuf with its modes.
    for (let w; (w = words[0]?.toLowerCase()) !== undefined;) {
      if (w === "timeout" || w === "stdbuf") {
        words = words.slice(1);
        while (words[0]?.startsWith("-")) words = words.slice(/^-[skioe]$/.test(words[0]) ? 2 : 1);
        if (w === "timeout") words = words.slice(1);
      } else if (/^\w+=/.test(w) || WRAPPERS.has(w) || w.startsWith("-")) words = words.slice(1);
      else break;
    }
    if (!words.length) continue;
    const cmd = nameOf(words[0]).replace(/\.exe$/, "");
    const inner = shellString(cmd, words);
    if (inner !== null) {
      const hit = depth < 4 && bashHit(inner, settings, cwd, dir, depth + 1);
      if (hit) return hit;
      continue;
    }
    if (settingsWrite(words, cmd))
      return {
        rule: "settings",
        reason: `This writes seo-audit/settings.json from the shell, where the guard can't see what changes. ${OWNER_ONLY}`,
      };
    // A cd earlier in the same command moves where the later paths start.
    if (/^(cd|chdir|pushd|set-location|sl)$/.test(cmd)) {
      const to = positional(words.slice(1)).out.find(w => !/^\/d$/i.test(w));
      if (to && !/^[~$%]/.test(to)) dir = resolve(dir, to);
      continue;
    }
    // The skill's scripts by file name, run by node, bun or deno or directly. The bin's subcommands (seo-supervisor
    // issues, npx seo-supervisor@1.2.0 issues, node bin/seo-supervisor.mjs issues) run the script of that name.
    let script = null,
      args = [];
    const isScript = w => /^[\w-]+\.mjs$/.test(nameOf(w));
    const at = /^(node|bun|deno)$/.test(cmd)
      ? words.findIndex((w, i) => i > 0 && isScript(w))
      : isScript(words[0])
        ? 0
        : -1;
    if (at >= 0) {
      script = nameOf(words[at]).slice(0, -4);
      args = words.slice(at + 1);
    }
    if (/^seo-supervisor@[\w.^~-]+$/.test(cmd) || cmd === "seo-supervisor") {
      script = "seo-supervisor";
      args = words.slice(1);
    }
    if (script === "seo-supervisor" && /^[a-z][\w-]*$/.test(args[0] ?? "")) {
      script = args[0];
      args = args.slice(1);
    }
    if (script) {
      // connect-keys set <service> <key>, or a key piped into it: the words after set, minus --flag values.
      const setWords =
        script === "connect-keys" && args[0] === "set"
          ? args
              .slice(1)
              .filter(
                (a, i, all) => !a.startsWith("--") && !(all[i - 1]?.startsWith("--") && !all[i - 1].includes("=")),
              )
          : null;
      if (setWords && (setWords.length >= 2 || keyPiece(command)))
        return {
          rule: "key",
          reason: `The key would be on the command line, where it stays in the shell's history and this conversation. In your own terminal, run ${KEY_HINT(setWords[0] || "<service>")} instead: it asks for the key and hides it as you type.`,
        };
      const crawl = script === "seo-crawl" && crawlHit(args, settings);
      if (crawl) return crawl;
      const why = Object.hasOwn(OUTSIDE, script) && OUTSIDE[script](args);
      if (why) return { rule: "outside", reason: why };
      const v = (Object.hasOwn(OUTSIDE, script) || script === "seo-crawl") && args.find(a => VARIABLE.test(a));
      if (v)
        return {
          rule: "outside",
          reason: `One of the script's arguments is a variable (${v}), which could hold --yes or a flag that contacts an outside service. Write the arguments out in full, so the guard can see what it does.`,
        };
      continue;
    }
    // Removing or moving files: rm, git rm, del, Remove-Item; mv, git mv, Move-Item (the last word is where it goes).
    let paths = [],
      base = dir;
    if (DELETE.has(cmd)) paths = positional(words.slice(1)).out;
    else if (MOVE.has(cmd)) {
      const p = positional(words.slice(1));
      paths = p.dest ? p.out : p.out.slice(0, -1);
    } else if (cmd === "git") {
      let i = 1;
      while (i < words.length && words[i].startsWith("-")) {
        if (words[i] === "-C") base = resolve(base, words[i + 1] ?? "");
        i += /^-[Cc]$/.test(words[i]) ? 2 : 1;
      }
      const p = positional(words.slice(i + 1));
      if (words[i] === "rm") paths = p.out;
      else if (words[i] === "mv") paths = p.out.slice(0, -1);
    }
    for (const f of paths) {
      const hit = deleteHit(resolve(base, f), cwd);
      if (hit) return hit;
    }
  }
  return null;
}

// ---------- prompts ----------
// redact.mjs's token patterns, tried on each piece between spaces, quotes, brackets and = ? & # ; @, so a key is found
// inside other text while the patterns that need those characters never fire: "a Bearer token" or ?key=blue in a
// message isn't a key. Its sk- pattern skips a key right after / or a letter, so /blog/sk-guide-… isn't one either.
/** @type {[RegExp, string][]} */
const SERVICE_BY_PREFIX = [
  [/^sk-ant-/, ""],
  [/^sk-/, "openai"],
  [/^pplx-/, "perplexity"],
  [/^phx_/, "posthog"],
  [/^AIza/, "googleplaces"],
];
const keyPiece = text => text.split(/[\s"'`()<>{}[\],=?&#;@|]+/).find(p => p.length > 15 && hideSecrets(p) !== p);
function promptHit(text) {
  const piece = keyPiece(text);
  if (!piece) return null;
  const found =
    piece.match(/(?:sk-|pplx-|phx_|AIza|gh[pousr]_|github_pat_|xox|ya29|GOCSPX|eyJ|AKIA|ASIA|[sr]k_)[\w-]{0,4}/)?.[0] ||
    piece.slice(0, 4);
  const service = SERVICE_BY_PREFIX.find(([re]) => re.test(piece.replace(/^.*?(?=sk-|pplx-|phx_|AIza)/, "")))?.[1];
  return {
    rule: "key",
    reason: `Your message looks like it holds an API key (it starts "${found}…"), so the SEO Supervisor guard stopped it before the AI saw it. Keys in chat stay in the conversation's history. To save a key for SEO Supervisor, run ${KEY_HINT(service || "<service>")} in your own terminal: it asks for the key and hides it as you type. Then send your message again without the key. The message may still be in this computer's prompt history, so if that matters, replace the key.`,
  };
}

// ---------- the Stop note's test ----------
// Lines that carry SEO (a hand-picked list): titles, meta and link tags, robots, canonicals, hreflang, structured data,
// sitemaps, Open Graph and the frameworks' head and metadata APIs.
const SEO_LINE =
  /<title|<meta\b|<link\b[^>]*\brel=|canonical|robots|hreflang|noindex|ld\+json|sitemap|og:|twitter:|generateMetadata|\bmetadata\s*[:=]|<Head\b|useHead|useSeoMeta|<h1\b/i;
/** True when the action touches what search engines read, for the review reminder. @param {any} action */
export function seoSensitive(action, cwd = process.cwd()) {
  if (!action || typeof action.file !== "string" || !action.file) return false;
  if (isRobotsFile(action.file) || isSitemapFile(action.file) || isRedirectFile(action.file)) return true;
  if (action.kind === "delete") return !!deleteHit(action.file, cwd);
  if (action.kind !== "edit") return false;
  const { added, removed } = lineDiff(String(action.before ?? ""), String(action.after ?? ""));
  return (
    [...added, ...removed].some(l => SEO_LINE.test(l)) ||
    (!!String(action.before ?? "").trim() && !String(action.after ?? "").trim() && isPageFile(action.file, cwd))
  );
}
