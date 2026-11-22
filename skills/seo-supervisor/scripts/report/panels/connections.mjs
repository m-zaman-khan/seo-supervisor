// @ts-check
// Panels from connected services: their reports, the change check and the new searches.
import { esc, noteMd, num, obj, plural, isCount, isText } from "../format.mjs";
import { isoDates } from "../traffic.mjs";

export function connectionPanels({ raw }) {
  const bing = obj(raw.bing),
    matomo = obj(raw.matomo),
    posthog = obj(raw.posthog);
  // Third-party text (registrars, video titles, referrers, paths) is escaped by the callers.
  const connLines = () => {
    const n = x => Number(x) || 0,
      fin = Number.isFinite,
      arr = x => (Array.isArray(x) ? x.filter(obj) : []),
      isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const top = (map, k, max = 10, label = s => s) =>
      Object.entries(obj(map) || {})
        .map(([name, v]) => /** @type {[string, number]} */ ([name, n(v?.[k])]))
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, max)
        .map(([name, v]) => `${label(name)} ${num(v)}`)
        .join(" · ");
    const when = x => (isoDates(x) ? ` (${isoDates(x)})` : "");
    const ages = arr(raw.domainAge).filter(d => typeof d.domain === "string" && isDay(d.registered));
    const moz = arr(raw.moz).filter(m => typeof m.domain === "string" && fin(m.domainAuthority));
    const yt = obj(raw.youtube),
      ch = obj(yt?.channel),
      st = obj(raw.siteTotals),
      ad = obj(raw.analyticsDetail),
      ai = obj(ad?.aiAssistant);
    const sister = obj(bing?.sister),
      others = Array.isArray(sister?.onlySister) ? sister.onlySister.filter(h => typeof h === "string" && h) : [];
    const sisterHost = (() => {
      try {
        return new URL(sister.site).hostname;
      } catch {
        return "";
      }
    })();
    const report = (x, k, what, on) => {
      const r = obj(x),
        pages = Object.keys(obj(r?.pages) || {}).length;
      return (
        r &&
        n(r[k]) > 0 &&
        `${what}: ${plural(n(r[k]), k.slice(0, -1))} ${on} ${plural(pages, "page")}${pages ? ` (top: ${top(r.pages, k, 3)})` : ""}`
      );
    };
    return [
      ages.length &&
        `Domain age (RDAP): ${ages.map(d => `${d.domain} registered ${d.registered}${typeof d.registrar === "string" && d.registrar ? ` (${d.registrar})` : ""}`).join(" · ")}`,
      moz.length &&
        `Moz: ${moz.map(m => [`${m.domain} Domain Authority ${m.domainAuthority}`, fin(m.spamScore) && `Spam Score ${m.spamScore}`, fin(m.linkingDomains) && plural(m.linkingDomains, "linking domain")].filter(Boolean).join(", ")).join(" · ")}`,
      ch &&
        typeof ch.title === "string" &&
        `YouTube channel ${ch.title}: ${[fin(ch.subscribers) && plural(ch.subscribers, "subscriber"), fin(ch.videos) && plural(ch.videos, "video"), fin(ch.views) && plural(ch.views, "view")].filter(Boolean).join(" · ")}`,
      ...arr(yt?.topics)
        .filter(t => typeof t.topic === "string" && arr(t.videos).length)
        .map(t => {
          const v = arr(t.videos);
          return `Top YouTube videos for “${t.topic}”: ${ch ? `${v.filter(x => x.own === true).length} of ${v.length} from your channel · ` : ""}first: ${v[0].title}${v[0].channel ? ` (${v[0].channel})` : ""}`;
        }),
      st &&
        n(st.clicks) > 0 &&
        `Search Console totals for the whole property: ${plural(n(st.clicks), "click")} · ${plural(n(st.impressions), "impression")}. ${st.complete === false ? `The queries listed cover ${Math.round((100 * n(st.queryClicks)) / n(st.clicks))}% of the clicks; Google doesn't list rare queries.` : st.complete ? "The queries listed cover every click." : ""}`.trim(),
      ad &&
        n(ad.sessions) > 0 &&
        `Google Analytics organic: ${plural(n(ad.sessions), "session")}${n(ad.users) ? ` from ${plural(n(ad.users), "user")}` : ""}${top(ad.byDevice, "sessions") ? ` · ${top(ad.byDevice, "sessions")}` : ""}${raw.trafficPeriod ? ` (${String(raw.trafficPeriod).toLowerCase()})` : ""}`,
      ad &&
        top(ad.byCountry, "sessions") &&
        `Google Analytics organic sessions by country: ${top(ad.byCountry, "sessions")}`,
      ai &&
        n(ai.sessions) > 0 &&
        `Google Analytics AI Assistant channel: ${plural(n(ai.sessions), "session")}${top(ai.bySource, "sessions") ? ` (${top(ai.bySource, "sessions")})` : ""}`,
      top(matomo?.byChannel, "visits") && `Matomo visits by channel: ${top(matomo.byChannel, "visits")}${when(matomo)}`,
      top(matomo?.byEngine, "visits") &&
        `Matomo search visits by search engine: ${top(matomo.byEngine, "visits")}${when(matomo)}`,
      top(posthog?.byReferrer, "visits") &&
        `PostHog visits by referrer: ${top(posthog.byReferrer, "visits", 10, k => (k === "$direct" ? "direct" : k))}${when(posthog)}`,
      posthog?.referrersCaptured === false &&
        "PostHog: no visit in this period has a referrer, so it can't tell visits from search apart. Its zero visits from search may be wrong.",
      report(raw.aiReports?.google, "impressions", "Google AI Overviews and AI Mode", "on"),
      report(raw.aiReports?.bing, "citations", "Bing AI answers", "of"),
      others.length &&
        sisterHost &&
        `Bing: ${plural(others.length, "site")} ${others.length === 1 ? "links" : "link"} to ${sisterHost} but not to this site: ${others.slice(0, 10).join(", ")}${others.length > 10 ? ` and ${others.length - 10} more` : ""}`,
    ].filter(Boolean);
  };
  const connectionsHtml = () => {
    const l = connLines();
    return l.length
      ? `\n    <details class="how conn"><summary>From your connections</summary>${l.map(t => `\n    <p class="quiet">${esc(t)}</p>`).join("")}</details>`
      : "";
  };
  const connectionsMd = () => {
    const l = connLines();
    return l.length ? ["## From your connections", "", ...l.flatMap(t => [noteMd(t), ""])] : [];
  };

  // changeCheck, from change-check.mjs: one clicks line, never offered as a cause. Numbers are validated; the callers
  // escape text.
  const changeLine = () => {
    const c = obj(raw.changeCheck),
      m = obj(c?.clicks),
      g = obj(c?.groups),
      int = Number.isInteger;
    const ranged = m && [m.percent, m.low, m.high].every(int);
    if (
      !c ||
      !/^\d{4}-\d{2}-\d{2}$/.test(c.changeDate) ||
      !["likely up", "likely down", "inconclusive"].includes(m?.verdict) ||
      (!ranged && m.verdict !== "inconclusive")
    )
      return "";
    const signed = p => `${p > 0 ? "+" : p < 0 ? "−" : ""}${num(Math.abs(p))}%`,
      changed = obj(g?.changed)?.pages,
      control = obj(g?.control)?.pages;
    const when = new Date(c.changeDate + "T00:00:00Z").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    const what = ranged
      ? `${m.verdict}, about ${signed(m.percent)} compared with ${isCount(control) ? plural(control, "similar unchanged page") : "similar unchanged pages"} (likely range ${signed(m.low)} to ${signed(m.high)}${m.verdict === "inconclusive" ? ", which includes no change" : ""})`
      : `inconclusive${isText(m.reason) ? `, ${m.reason}` : ""}`;
    return `Change check, ${isCount(changed) ? plural(changed, "page") : "the pages"} changed on ${when}${isCount(c.days) ? `, ${c.days} days before and after` : ""}: Google Search clicks ${what}. This shows what happened to the numbers, not why. Information only.`;
  };
  const changeCheckHtml = () => {
    const l = changeLine();
    return l ? `\n    <p class="quiet">${esc(l)}</p>` : "";
  };
  const changeCheckMd = () => {
    const l = changeLine();
    return l ? ["## Change check", "", noteMd(l), ""] : [];
  };
  // newQueries: searches with no row in the previous period, the first 10 as given (most impressions first). Search
  // text is third-party, escaped where shown.
  const newSearchLine = () => {
    const q = (Array.isArray(raw.newQueries) ? raw.newQueries : [])
      .filter(x => obj(x) && typeof x.query === "string" && x.query && Number.isFinite(x.impressions))
      .slice(0, 10);
    return q.length
      ? `New searches this period, with no impressions in the period before: ${q.map(x => `${x.query} (${num(x.impressions)} impressions)`).join(" · ")}. Google hides searches very few people make, so a few of these may have shown the site before. Information only.`
      : "";
  };
  const newSearchesHtml = () => {
    const l = newSearchLine();
    return l ? `\n    <p class="quiet">${esc(l)}</p>` : "";
  };
  const newSearchesMd = () => {
    const l = newSearchLine();
    return l ? ["## New searches", "", noteMd(l), ""] : [];
  };
  return { connectionsHtml, connectionsMd, changeCheckHtml, changeCheckMd, newSearchesHtml, newSearchesMd };
}
