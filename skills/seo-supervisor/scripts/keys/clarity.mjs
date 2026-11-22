// @ts-check
// Microsoft Clarity: the token's entry and what visitors did on each page.
import { Refused, setLine, PASTE, request, bare, hostOf, day, num } from "./http.mjs";

// Offered only when the site uses Clarity, like Matomo and PostHog, so it's never listed under Limits when unset.
// https://learn.microsoft.com/clarity/setup-and-installation/clarity-data-export-api
export const clarity = {
  name: "Microsoft Clarity",
  env: "CLARITY_API_TOKEN",
  endpointEnv: "CLARITY_ENDPOINT",
  endpoint: "https://www.clarity.ms/export-data/api/v1/project-live-insights",
  optional: true,
  adds: "what real visitors did on each page in the last 3 days: sessions, scroll depth, quick backs, rage clicks and dead clicks, from your Clarity",
  where: "clarity.microsoft.com → your project → Settings → Data Export",
  guide: [
    "Microsoft Clarity (free) adds what real visitors did on each page in the last 3 days, from your own Clarity: sessions, how far down they scrolled on average, and the share of sessions with quick backs (landing and going straight back), rage clicks (clicking the same spot again and again) and dead clicks (clicks that do nothing).",
    "Clarity's export covers only the last 1 to 3 days, so these are a recent snapshot, not a trend. The heat maps and recordings stay in Clarity's own dashboard.",
    "1. Sign in at https://clarity.microsoft.com and open this site's project. Only a project admin can make a token.",
    "2. Open Settings → Data Export → Generate new API token. Name it SEO-Supervisor (4 to 32 letters, digits, hyphens, underscores or periods, no spaces).",
    "3. Copy the token straight away: Clarity shows it only once. It's long, with two dots in it. It isn't the short project ID in Clarity's tracking code, which can't read data.",
    `4. In your own terminal run: ${setLine("clarity")}`,
    PASTE,
    "Clarity allows 10 requests a day per project, and each fetch uses one. A token reads one project, so for several sites use a client folder each (SEO_SUPERVISOR_CLIENT=<name>). If someone with access leaves the project, Microsoft asks you to replace the token.",
  ],
};

// ---------- Microsoft Clarity: what visitors did on each page ----------
// The token names the project, so nothing about the site is sent and its pages are matched here. The answer is a list
// of { metricName, information: [rows] }, at most 1,000 rows over the last 72 hours. Only Traffic's fields are
// documented; the other metric names come from Microsoft's Clarity MCP server 1.0.5. Undocumented fields are read only
// when present, a missing one is named in a note, never guessed, and names match ignoring case and spaces.
export const CLARITY_DAYS = 3;
const CLARITY_ROWS = 1000,
  PCT = "sessionsWithMetricPercentage";
/** @type {Record<string, [string, string, string]>} metricName → [output field, Clarity's field, plain name] */
const CLARITY_METRICS = {
  scrolldepth: ["scrollDepth", "averageScrollDepth", "average scroll depth"],
  quickbackclick: ["quickBacks", PCT, "quick backs"],
  rageclickcount: ["rageClicks", PCT, "rage clicks"],
  deadclickcount: ["deadClicks", PCT, "dead clicks"],
  excessivescroll: ["excessiveScroll", PCT, "excessive scrolling"],
};
const squash = s =>
  String(s ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();
const fieldOf = (row, name) => Object.keys(row).find(k => k.toLowerCase() === name.toLowerCase());
export async function fetchClarity(key, base, site, notes) {
  const body = await request(
    "clarity",
    clarity,
    `${base}?${new URLSearchParams({ numOfDays: String(CLARITY_DAYS), dimension1: "URL" })}`,
    { headers: { authorization: `Bearer ${key}` }, redirect: "manual" },
  ); // the token never follows a redirect
  const rowsOf = m => (Array.isArray(m?.information) ? m.information.filter(r => r && typeof r === "object") : []);
  const metric = name => (Array.isArray(body) ? body.find(m => squash(m?.metricName) === name) : null),
    traffic = metric("traffic");
  if (!traffic || !Array.isArray(traffic.information))
    throw new Refused(
      "Microsoft Clarity's answer isn't the list of metrics by page it used to be (it has no Traffic), so nothing was read. Clarity may have changed its export.",
    );
  // A row's page: its URL on this site (www or not, http or https), by path; tracking parameters and the like add up.
  const want = bare(new URL(site).hostname),
    urlOf = r => {
      const k = fieldOf(r, "url");
      return k && typeof r[k] === "string" && r[k] ? r[k] : null;
    };
  const pathOf = u => {
    try {
      const x = new URL(u, site);
      return bare(x.hostname) === want ? x.pathname : null;
    } catch {
      return null;
    }
  };
  const pages = {},
    weight = new Map(),
    others = new Set();
  for (const r of rowsOf(traffic)) {
    const u = urlOf(r),
      p = u && pathOf(u),
      n = Number(r[fieldOf(r, "totalSessionCount") ?? ""]);
    if (!u || !(n > 0)) continue;
    if (!p) {
      others.add(hostOf(u) || u);
      continue;
    }
    weight.set(u, n);
    const t = (pages[p] ||= { sessions: 0, botSessions: 0 });
    t.sessions += n;
    t.botSessions += Number(r[fieldOf(r, "totalBotSessionCount") ?? ""]) || 0;
  }
  // Averages and shares, weighted by each URL's sessions, for the pages Traffic has.
  const unread = []; // "dead clicks without sessionsWithMetricPercentage (it sent …)"
  for (const [name, [field, theirs, plain]] of Object.entries(CLARITY_METRICS)) {
    const rows = rowsOf(metric(name)),
      sums = {};
    if (!rows.length) continue;
    if (!rows.some(r => fieldOf(r, theirs))) {
      unread.push(
        `${plain} without ${theirs} (it sent ${
          [...new Set(rows.flatMap(Object.keys))]
            .filter(k => k.toLowerCase() !== "url")
            .slice(0, 5)
            .join(", ") || "no fields"
        })`,
      );
      continue;
    }
    for (const r of rows) {
      const u = urlOf(r),
        p = u && pathOf(u),
        v = Number(r[fieldOf(r, theirs) ?? ""]);
      if (!p || !pages[p] || !(v >= 0 && v <= 100)) continue;
      const w = weight.get(u) || 1,
        s = (sums[p] ||= [0, 0]);
      s[0] += v * w;
      s[1] += w;
    }
    for (const [p, [sum, w]] of Object.entries(sums)) pages[p][field] = Math.round((10 * sum) / w) / 10;
  }
  if (unread.length)
    notes.push(
      `Microsoft Clarity sent ${unread.join("; ")}, the field this version reads, so ${unread.length === 1 ? "that's" : "those are"} left out. Clarity may have changed its export.`,
    );
  if (rowsOf(traffic).length >= CLARITY_ROWS)
    notes.push(
      `Microsoft Clarity sends at most ${num(CLARITY_ROWS)} rows and can't page through more, so pages with fewer sessions may be missing.`,
    );
  if (!Object.keys(pages).length)
    notes.push(
      others.size
        ? `Microsoft Clarity has sessions only on other sites (${[...others].slice(0, 3).join(", ")}), none on ${want}: check that the token is for this site's Clarity project.`
        : `Microsoft Clarity recorded no sessions in the last ${CLARITY_DAYS} days. Check that Clarity's code is on the site and that the token is for this site's project.`,
    );
  return { days: CLARITY_DAYS, read: day(Date.now()), traffic: pages };
}
