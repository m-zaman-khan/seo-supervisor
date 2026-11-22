// @ts-check
// robots.txt checks, and the AI crawler access the report shows. Parsing and matching live in lib/robots.mjs.
import { AI_BOTS, signalPlacement, aiRobots } from "./agents.mjs";

// A user-agent counts by its name up to the first character other than a letter, "_" or "-", so "GPTBot/1.1" is
// GPTBot, as in Google's open-source parser and RFC 9309. versioned: the lines that carried more, for a note.
// https://github.com/google/robotstxt
// https://www.rfc-editor.org/rfc/rfc9309#section-2.2.1
export function parseRobots(txt) {
  const groups = [];
  let cur = null;
  const sitemaps = [],
    versioned = [];
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase(),
      v = line.slice(i + 1).trim();
    if (k === "sitemap") {
      sitemaps.push(v);
      continue;
    }
    if (k === "user-agent") {
      if (!cur || cur.rules.length) groups.push((cur = { agents: [], rules: [] }));
      const name = v.startsWith("*") ? "*" : /^[A-Za-z_-]+/.exec(v)?.[0] || v;
      if (name !== v && name !== "*") versioned.push(v);
      cur.agents.push(name.toLowerCase());
      continue;
    }
    if ((k === "allow" || k === "disallow") && cur) cur.rules.push({ allow: k === "allow", path: v });
  }
  return { groups, sitemaps, versioned };
}
export const ruleRe = p =>
  new RegExp(
    "^" +
      p
        .replace(/[.+?^{}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\\\$$/, "$")
        .replace(/\$$/, "$"),
  );
export function allowedBy(group, path) {
  if (!group) return true;
  let best = null;
  for (const r of group.rules) {
    if (!r.path) continue;
    if (
      ruleRe(r.path).test(path) &&
      (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))
    )
      best = r;
  }
  return !best || best.allow;
}
// Every group naming the crawler, combined into one, as RFC 9309 2.2.1 requires.
export const groupFor = (robots, agent) => {
  const a = agent.toLowerCase(),
    gs = robots.groups.filter(g => g.agents.includes(a));
  return gs.length ? { agents: [a], rules: gs.flatMap(g => g.rules) } : null;
};

// Returns the parsed rules (null when unreadable), whether the server failed, and the `User-agent: *` group.
export function checkRobots(robotsRes, { add, evalRules, startOrigin: START_ORIGIN }) {
  const robots =
    robotsRes.status === 200 && robotsRes.body && !/<html/i.test(robotsRes.body) ? parseRobots(robotsRes.body) : null;
  // Google treats a 4xx other than 429 as no rules, and a 5xx, 429 or no answer as a server error that halts crawling.
  // After five redirects it treats the file as missing.
  // https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
  const robotsHops = robotsRes.error === "too many redirects" ? robotsRes.chain.map(c => c.url) : null;
  const robotsDown = !robotsHops && (robotsRes.status >= 500 || robotsRes.status === 429 || robotsRes.status === 0);
  evalRules("CRAWL-01", ...(robotsDown ? [] : ["MAP-01", "MAP-05", "MAP-06"]));
  const star = robots ? groupFor(robots, "*") : null;
  if (robotsDown)
    add(
      "robots-server-error",
      START_ORIGIN + "/robots.txt",
      robotsRes.status ? `status ${robotsRes.status}` : `no answer: ${robotsRes.error}`,
    );
  else if (robotsHops) {
    const again = robotsHops.findIndex((u, i) => robotsHops.indexOf(u) < i);
    add(
      "robots-missing",
      START_ORIGIN + "/robots.txt",
      `${again > 0 ? `a redirect loop: ${[...robotsHops.slice(0, again), robotsHops[again]].join(" → ")}` : `more than 5 redirects: ${robotsHops[0]} → … → ${robotsHops.at(-1)}`}. Google stops after 5 and reads that as no robots.txt`,
    );
  } else if (!robots) add("robots-missing", START_ORIGIN + "/robots.txt", `status ${robotsRes.status}`);
  else {
    if (star && !allowedBy(star, "/"))
      add("robots-blocks-all", START_ORIGIN + "/robots.txt", "User-agent: * is not allowed to crawl /");
    for (const p of ["/_next/static/x.js", "/assets/x.js", "/static/x.css", "/x.css", "/x.js"])
      if (star && !allowedBy(star, p) && allowedBy(star, "/"))
        add("robots-blocks-assets", START_ORIGIN + "/robots.txt", `blocks ${p.replace(/x\.(js|css)$/, "")}`);
    const AI = [
      "GPTBot",
      "OAI-SearchBot",
      "ChatGPT-User",
      "ClaudeBot",
      "Claude-SearchBot",
      "Claude-User",
      "anthropic-ai",
      "Claude-Web",
      "PerplexityBot",
      "Google-Extended",
      "CCBot",
      "Applebot-Extended",
      "Bytespider",
      "meta-externalagent",
    ];
    for (const bot of AI) {
      const g = groupFor(robots, bot);
      if (g && !allowedBy(g, "/")) add("ai-bots-blocked", START_ORIGIN + "/robots.txt", bot);
    }
    if (!robots.sitemaps.length) add("sitemap-not-in-robots", START_ORIGIN + "/robots.txt");
    // A line may start with the path it applies to: `Content-Signal: /blog/ search=yes`. https://contentsignals.org
    for (const m of robotsRes.body.matchAll(/^\s*content-signal\s*:\s*(?:\/\S*\s+)?(.*)$/gim))
      for (const pair of m[1]
        .split(",")
        .map(x => x.trim())
        .filter(Boolean)) {
        // The policy's three keys, plus the use= field Cloudflare is testing in its managed robots.txt.
        const [k, v] = pair.split("=").map(x => (x || "").trim().toLowerCase());
        if (!/^(?:(?:search|ai-input|ai-train)=(?:yes|no)|use=(?:immediate|reference|full))$/.test(`${k}=${v}`))
          add("content-signal-invalid", START_ORIGIN + "/robots.txt", pair);
      }
  }
  return { robots, robotsDown, star };
}

// A versioned user-agent still matches by its bare name, so this is a note, not a finding.
export function versionedNote(robots, notes) {
  if (robots?.versioned.length) {
    const v = robots.versioned[0],
      bare = /^[A-Za-z_-]+/.exec(v)[0];
    notes.push(
      `robots.txt names ${robots.versioned.map(x => `\`User-agent: ${x}\``).join(", ")} with more than the crawler's name. Google reads only the name, up to the first character that isn't a letter, "_" or "-", so ${v} counts as ${bare}. RFC 9309 allows only those characters, so other crawlers may not match it: write the bare name, such as \`User-agent: ${bare}\`.`,
    );
  }
}

// Each AI bot's access: its own group, else `User-agent: *`. Also flags Content-Signal lines crawlers won't read.
// https://www.rfc-editor.org/rfc/rfc9309#section-2.2.1
export function aiBotAccess({ robots, robotsRes, star }, { add, extra, startOrigin: START_ORIGIN }) {
  if (robots) {
    // Applebot falls back to Googlebot's group when it isn't named (https://support.apple.com/en-us/119829), and
    // YandexAdditional reads only its own group, never `*`.
    extra.aiBots = AI_BOTS.map(([bot, vendor, kind, mayIgnore, { alias, fallback } = {}]) => {
      const own = groupFor(robots, bot) || (alias ? groupFor(robots, alias) : null),
        via = !own && fallback ? groupFor(robots, fallback) : null,
        g = own || via || star;
      return {
        bot,
        vendor,
        kind,
        robots:
          !g || allowedBy(g, "/")
            ? "allowed"
            : own
              ? "blocked"
              : via
                ? `blocked-by-${fallback.toLowerCase()}`
                : "blocked-by-star",
        ...(mayIgnore ? { mayIgnore } : {}),
      };
    });
    // The shared AI-training opt-out (IETF draft-kelley-aipref-training-preference-signal) matches only its own group.
    const shared = groupFor(robots, "__usage_ai-training");
    extra.trainingOptOut = !shared
      ? "not-set"
      : !allowedBy(shared, "/")
        ? "blocked"
        : shared.rules.some(x => !x.allow && x.path)
          ? "partly"
          : "allowed";
    for (const d of signalPlacement(robotsRes.body, g => !allowedBy(g, "/")))
      add("content-signal-placement", START_ORIGIN + "/robots.txt", d);
  }
}

// AI crawler rules that contradict each other, aipref Content-Usage lines, and Cloudflare's managed block. Both of
// Cloudflare's markers set botPreferenceSync, the field older reports use.
// https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/
export function aiRobotRules({ robots, robotsRes }, { add, extra, startOrigin: START_ORIGIN }) {
  if (robots) {
    const ai = aiRobots(robotsRes.body, allowedBy);
    for (const c of ai.conflicts) add("ai-robots-conflict", START_ORIGIN + "/robots.txt", c);
    if (ai.usage.length) extra.contentUsage = ai.usage;
    if (/^\s*#\s*BEGIN Cloudflare Bot Preference Sync\b/im.test(robotsRes.body)) extra.botPreferenceSync = true;
  }
}
