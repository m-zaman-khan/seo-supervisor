// @ts-check
// robots.txt parsing and matching, shared by every script that reads one.

// A user-agent counts by its name up to the first character other than a letter, "_" or "-", so "GPTBot/1.1" is
// GPTBot, as in Google's open-source parser and RFC 9309. agents: those names, lowercased; names: the lines as written;
// versioned: the lines that carried more, for a note. Content-Signal and aipref Content-Usage lines (rules inside a
// group, draft-ietf-aipref-attach-05) go on their group's signals and usage, or on loose before the first User-agent
// line; line is 1-based.
// https://github.com/google/robotstxt
// https://www.rfc-editor.org/rfc/rfc9309#section-2.2.1
/** @param {string} txt */
export function parseRobots(txt) {
  /** @type {{ agents: string[], names: string[], rules: { allow: boolean, path: string }[], signals: { line: number, k: string, v: string }[], usage: { line: number, k: string, v: string }[] }[]} */
  const groups = [];
  const sitemaps = [],
    versioned = [],
    loose = [];
  let cur = null;
  String(txt || "")
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.replace(/#.*/, "").trim(),
        c = line.indexOf(":");
      if (c < 0) return;
      const k = line.slice(0, c).trim().toLowerCase(),
        v = line.slice(c + 1).trim();
      if (k === "sitemap") {
        if (v) sitemaps.push(v);
      } else if (k === "user-agent") {
        if (!cur || cur.rules.length) groups.push((cur = { agents: [], names: [], rules: [], signals: [], usage: [] }));
        const name = v.startsWith("*") ? "*" : /^[A-Za-z_-]+/.exec(v)?.[0] || v;
        if (name !== v && name !== "*") versioned.push(v);
        cur.agents.push(name.toLowerCase());
        cur.names.push(v);
      } else if (k === "content-signal" || k === "content-usage")
        (cur ? cur[k === "content-signal" ? "signals" : "usage"] : loose).push({ line: i + 1, k, v });
      else if ((k === "allow" || k === "disallow") && cur) cur.rules.push({ allow: k === "allow", path: v });
    });
  return { groups, sitemaps, versioned, loose };
}
// "*" matches anything, a "$" at the end anchors the path, and a "$" anywhere else is a plain character.
export const ruleRe = p =>
  new RegExp(
    "^" +
      p
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\\\$$/, "$"),
  );
// The longest rule matching the path wins, an allow on a tie; rules with no path are ignored. No group: allowed.
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
// Every group naming the crawler, combined into one, as RFC 9309 2.2.1 requires, or null.
export const groupFor = (robots, agent) => {
  const a = agent.toLowerCase(),
    gs = robots.groups.filter(g => g.agents.includes(a));
  return gs.length ? { agents: [a], rules: gs.flatMap(g => g.rules) } : null;
};
// The one group a crawler obeys: its own groups combined, else the `User-agent: *` groups. Google never merges
// agent-specific and global groups.
// https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt#order-of-precedence-for-user-agents
export const groupOf = (robots, agent) => groupFor(robots, agent) || groupFor(robots, "*");
