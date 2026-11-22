// @ts-check
// The AI panels on the Search & AI tab: agent support, AI crawler access and the AI answer check.
import { cellMd, esc, inl, noteCode, noteMd, notePath, num, obj, plural, isCount } from "../format.mjs";

export function aiPanels({ raw }) {
  // AI agents (WebMCP tools, UCP, agent files), from the crawler.
  const AGENT_FILE = {
    "/.well-known/api-catalog": "API catalog (RFC 9727)",
    "/.well-known/agent-card.json": "A2A agent card",
    "/.well-known/oauth-protected-resource": "OAuth protected resource (RFC 9728)",
    "/.well-known/oauth-authorization-server": "OAuth authorization server (RFC 8414)",
  };
  const agentRows = (() => {
    const a = obj(raw.agents),
      strs = x => (Array.isArray(x) ? x.filter(s => typeof s === "string" && s) : []);
    if (!a) return [];
    return [
      ...(Array.isArray(a.pages) ? a.pages.filter(p => obj(p) && strs(p.tools).length) : []).map(p => [
        notePath(p.url),
        `WebMCP tools: ${strs(p.tools).join(", ")}`,
      ]),
      typeof a.ucp === "string" && a.ucp && ["/.well-known/ucp", `UCP shop profile, version ${a.ucp}`],
      ...strs(a.wellKnown).map(f => [f, AGENT_FILE[f] || "agent file"]),
    ].filter(Boolean);
  })();
  const AGENTS_INTRO =
    "What the site offers AI agents, listed for information: none of it is a finding or changes the score. WebMCP is a Chrome experiment that lets a page offer tools to AI agents, and its API is still changing; only inline scripts and forms were read. UCP is the open standard behind checkout in Google's AI Mode and Gemini.";
  const agentsHtml = () =>
    agentRows.length
      ? `\n    <details class="how agents"><summary>AI agents</summary><p>${esc(AGENTS_INTRO)}</p><ul class="lim">${agentRows.map(([where, what]) => `<li><b><code>${esc(where)}</code></b><span>${esc(what)}</span></li>`).join("")}</ul></details>`
      : "";
  const agentsMd = () =>
    agentRows.length
      ? [
          "## AI agents",
          "",
          AGENTS_INTRO,
          "",
          ...agentRows.map(([where, what]) => `- ${noteCode(where)} ${noteMd(what)}`),
          "",
        ]
      : [];

  const AI_KIND = { search: "AI search", training: "Training", user: "Fetches for a user", other: "Other" };
  const AI_STATUS = {
    allowed: "Allowed",
    blocked: "Blocked",
    "blocked-by-star": "Blocked by `User-agent: *`",
    "blocked-by-googlebot": "Blocked by the Googlebot group (Apple follows it when Applebot isn't named)",
  };
  // The shared AI-training opt-out; an unknown value shows nothing.
  const TRAINING = {
    "not-set": "not in robots.txt. A `User-agent: *` group doesn't cover it",
    blocked: "set: it refuses AI training for the whole site",
    partly: "set for some paths only",
    allowed: "set, and it allows AI training",
  };
  const trainingLine = () =>
    Object.hasOwn(TRAINING, raw.trainingOptOut)
      ? `Shared AI-training opt-out (\`User-agent: __usage_ai-training\`, an IETF draft): ${TRAINING[raw.trainingOptOut]}. Anthropic honours it since 30 Oct 2026, and Bing from 1 Feb 2027; Google plans to in 2027.`
      : "";
  const aiBots = (Array.isArray(raw.aiBots) ? raw.aiBots : []).filter(
    b => obj(b) && typeof b.bot === "string" && Object.hasOwn(AI_STATUS, b.robots),
  );
  const noLandmarks = (l =>
    l && [l.checked, l.count].every(isCount) && Array.isArray(l.pages)
      ? { ...l, pages: l.pages.filter(p => obj(p) && typeof p.url === "string" && Array.isArray(p.missing)) }
      : null)(obj(raw.landmarks));
  const agentic = (Array.isArray(raw.lighthouse) ? raw.lighthouse : [])
    .filter(
      x => obj(x) && typeof x.url === "string" && obj(x.agentic) && [x.agentic.passed, x.agentic.total].every(isCount),
    )
    .map(x => ({
      path: notePath(x.url),
      passed: x.agentic.passed,
      total: x.agentic.total,
      failed: (Array.isArray(x.agentic.failed) ? x.agentic.failed : []).filter(
        f => obj(f) && typeof f.title === "string",
      ),
    }));
  const AI_INTRO =
    "Information only: none of this changes the score. The table shows whether robots.txt lets each AI crawler in, by its own group or, when it has none, by the User-agent: * group. Fetchers for a user get a page a person asked for, and some vendors say robots.txt may not apply to them.";
  const AGENTIC_INTRO =
    "Lighthouse's Agentic browsing checks (experimental; Lighthouse 13.3 or later with Chrome 150 or later): whether AI agents can read and use the page. There's no 0–100 score, only the checks passed.";
  const aiBotStatus = b => AI_STATUS[b.robots] + (b.mayIgnore ? " (may ignore robots.txt)" : "");
  const landmarkLine = () =>
    `${num(noLandmarks.count)} of ${num(noLandmarks.checked)} pages lack one or more landmarks (main, nav, header, footer), which screen readers and AI agents use to find their way around a page (AI-05).`;
  const agenticRow = a =>
    `${num(a.passed)} of ${num(a.total)} checks passed${a.failed.length ? `; failing: ${a.failed.map(f => f.title).join("; ")}` : ""}`;
  const aiCrawlersOn = () => aiBots.length || noLandmarks || agentic.length || trainingLine() || aiExtrasOn();
  const aiCrawlersHtml = () =>
    aiCrawlersOn()
      ? `\n    <details class="how aibots"><summary>AI crawlers and agents</summary>` +
        (aiBots.length
          ? `<p>${esc(AI_INTRO)}</p><div class="tablewrap"><table><thead><tr><th scope="col">Crawler</th><th scope="col">Vendor</th><th scope="col">Kind</th><th scope="col">robots.txt</th></tr></thead><tbody>${aiBots.map(b => `<tr><td><code>${esc(b.bot)}</code></td><td>${esc(b.vendor)}</td><td>${esc(AI_KIND[b.kind] || b.kind)}</td><td>${inl(aiBotStatus(b))}</td></tr>`).join("")}</tbody></table></div>`
          : "") +
        (trainingLine() ? `<p>${inl(trainingLine())}</p>` : "") +
        aiExtrasHtml(aiBots) +
        (noLandmarks
          ? `<p>${esc(landmarkLine())}</p><ul class="lim">${noLandmarks.pages.map(p => `<li><b><code>${esc(notePath(p.url))}</code></b><span>no ${esc(p.missing.join(", "))}</span></li>`).join("")}</ul>`
          : "") +
        (agentic.length
          ? `<p>${esc(AGENTIC_INTRO)}</p><ul class="lim">${agentic.map(a => `<li><b><code>${esc(a.path)}</code></b><span>${esc(agenticRow(a))}</span></li>`).join("")}</ul>`
          : "") +
        `</details>`
      : "";
  const aiCrawlersMd = () =>
    aiCrawlersOn()
      ? [
          "## AI crawlers and agents",
          "",
          ...(aiBots.length
            ? [
                AI_INTRO,
                "",
                "| Crawler | Vendor | Kind | robots.txt |",
                "| --- | --- | --- | --- |",
                ...aiBots.map(
                  b =>
                    `| ${cellMd(noteMd(b.bot))} | ${cellMd(noteMd(b.vendor))} | ${cellMd(noteMd(AI_KIND[b.kind] || b.kind))} | ${cellMd(aiBotStatus(b))} |`,
                ),
                "",
              ]
            : []),
          ...(trainingLine() ? [trainingLine(), ""] : []),
          ...aiExtrasMd(aiBots),
          ...(noLandmarks
            ? [
                landmarkLine(),
                "",
                ...noLandmarks.pages.map(p => `- ${noteCode(notePath(p.url))} no ${noteMd(p.missing.join(", "))}`),
                "",
              ]
            : []),
          ...(agentic.length
            ? [AGENTIC_INTRO, "", ...agentic.map(a => `- ${noteCode(a.path)} ${noteMd(agenticRow(a))}`), ""]
            : []),
        ]
      : [];
  // Shown inside the "AI crawlers and agents" panel. Brave falls back to Googlebot's rules, and aiBotPaid lists pages
  // that answered the AI probe with a 402, as Cloudflare's pay per crawl does. Crawled text is escaped.
  // https://search.brave.com/help/brave-search-crawler
  const contentUsage = (Array.isArray(raw.contentUsage) ? raw.contentUsage : [])
    .filter(u => obj(u) && typeof u.rule === "string")
    .slice(0, 20);
  const paidPages = (Array.isArray(raw.aiBotPaid) ? raw.aiBotPaid : [])
    .filter(p => obj(p) && typeof p.url === "string" && typeof p.bot === "string")
    .slice(0, 20);
  const botSync = raw.botPreferenceSync === true;
  const BRAVE_LINE =
    "Brave Search's crawler has no user agent of its own, so robots.txt can't name it, and it won't crawl a page Googlebot can't. Brave says robots.txt doesn't keep a page out of its results: a `noindex` robots meta tag does.";
  // Cloudflare marks its block either way.
  // https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/
  // https://blog.cloudflare.com/bot-preference-sync/
  const SYNC_LINE =
    "This robots.txt has a block that Cloudflare adds, marked `# BEGIN Cloudflare Managed content` or `# BEGIN Cloudflare Bot Preference Sync`. Cloudflare's managed robots.txt and its Bot Preference Sync (announced 21 Aug 2026) write the AI crawler choices made in Cloudflare's dashboard into the live robots.txt, in front of the site's own lines. So the robots.txt the site serves can differ from the one in the code: change those crawlers in Cloudflare's dashboard, as editing the file in the code won't change that block.";
  const USAGE_INTRO =
    "Content-Usage lines in robots.txt, shown as written. They come from the IETF's AI preferences drafts (August and September 2026), which aren't final, so the crawl doesn't judge them.";
  const PAID_INTRO =
    "Asked as an AI search crawler, these pages answered 402 Payment Required: the site asks crawlers to pay for the page. Cloudflare's pay per crawl answers this way, with the price in a crawler-price header. That's paid access, not a refusal, so it isn't a finding.";
  const paidRow = p => `${p.bot}${typeof p.price === "string" ? ` · crawler-price: ${p.price}` : ""}`;
  const aiExtrasOn = () => contentUsage.length || paidPages.length || botSync;
  const aiExtrasHtml = bots =>
    (bots.length ? `<p>${inl(BRAVE_LINE)}</p>` : "") +
    (botSync ? `<p>${inl(SYNC_LINE)}</p>` : "") +
    (contentUsage.length
      ? `<p>${esc(USAGE_INTRO)}</p><ul class="lim">${contentUsage.map(u => `<li><b>${typeof u.agents === "string" ? `<code>User-agent: ${esc(u.agents)}</code>` : "No group (above the first User-agent line)"}</b><span><code>Content-Usage: ${esc(u.rule)}</code></span></li>`).join("")}</ul>`
      : "") +
    (paidPages.length
      ? `<p>${esc(PAID_INTRO)}</p><ul class="lim">${paidPages.map(p => `<li><b><code>${esc(notePath(p.url))}</code></b><span>${esc(paidRow(p))}</span></li>`).join("")}</ul>`
      : "");
  const aiExtrasMd = bots => [
    ...(bots.length ? [BRAVE_LINE, ""] : []),
    ...(botSync ? [SYNC_LINE, ""] : []),
    ...(contentUsage.length
      ? [
          USAGE_INTRO,
          "",
          ...contentUsage.map(
            u =>
              `- ${typeof u.agents === "string" ? noteCode(`User-agent: ${u.agents}`) : "No group (above the first User-agent line)"}: ${noteCode(`Content-Usage: ${u.rule}`)}`,
          ),
          "",
        ]
      : []),
    ...(paidPages.length
      ? [PAID_INTRO, "", ...paidPages.map(p => `- ${noteCode(notePath(p.url))} ${noteMd(paidRow(p))}`), ""]
      : []),
  ];
  // aiAnswers comes from ai-answers.json: per engine, how many sampled answers cited the site and each rival. It's a
  // count from a small sample, so never a score or a finding. Questions, rivals, pages and errors are user or provider
  // text, so they're escaped.
  const answers = (a => {
    const cnt = x => (Number.isInteger(x) && x >= 0 ? x : null),
      strs = x => (Array.isArray(x) ? x.filter(s => typeof s === "string") : []);
    const counts = m => Object.entries(obj(m) || {}).filter(([, v]) => cnt(v) !== null);
    const engines = Object.values(obj(a?.engines) || {})
      .map(obj)
      .filter(
        e =>
          e &&
          typeof e.name === "string" &&
          cnt(e.answers) !== null &&
          cnt(e.cited) !== null &&
          (e.answers > 0 || typeof e.error === "string"),
      );
    return engines.length
      ? {
          date: /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : "an unknown date",
          questions: strs(a.questions).length,
          repeat: cnt(a.repeat) || 1,
          engines: engines.map(e => ({
            ...e,
            rivals: counts(e.rivals),
            pages: counts(e.pages),
            never: strs(e.neverCited),
          })),
        }
      : null;
  })(obj(raw.aiAnswers));
  const ANSWERS_INTRO =
    "Whether AI answer engines cited your site when they answered the questions you chose, asked through each provider's API with your own keys. These answers can differ from what people see in the ChatGPT or Perplexity apps, which add personal settings and location, and answers change from day to day. So this is a sample to compare over time, not a ranking. Information only: it doesn't change the score.";
  const engineName = e => `${e.name}${typeof e.model === "string" ? ` (${e.model})` : ""}`;
  const answersHead = e =>
    `your site was cited in ${e.cited} of ${plural(e.answers, "answer")} (a sample: ${plural(answers.questions, "question")}, asked ${answers.repeat === 1 ? "once" : `${answers.repeat} times`} each, on ${answers.date}).`;
  const answersStop = e =>
    typeof e.error === "string" ? `${e.name} stopped after ${plural(e.answers, "answer")}: ${e.error}` : "";
  const citedIn = n => `cited in ${plural(n, "answer")}`;
  const answersLists = e =>
    [
      ["Rivals", e.rivals.map(([d, n]) => [d, `cited in ${n} of ${plural(e.answers, "answer")}`])],
      ["Your pages cited", e.pages.map(([p, n]) => [p, citedIn(n)])],
      ["Questions whose answers never cited your site", e.never.map(q => [q, ""])],
    ].filter(([, rows]) => rows.length);
  const aiAnswersHtml = () =>
    answers
      ? `\n    <details class="how aianswers"><summary>AI answer check</summary><p>${esc(ANSWERS_INTRO)}</p>${answers.engines
          .map(
            e =>
              `<p><b>${esc(engineName(e))}</b>: ${esc(answersHead(e))}${answersStop(e) ? ` ${esc(answersStop(e))}` : ""}</p>${answersLists(
                e,
              )
                .map(
                  ([t, rows]) =>
                    `<p>${esc(t)}:</p><ul class="lim">${rows.map(([k, v]) => `<li><b>${t === "Your pages cited" ? `<code>${esc(k)}</code>` : esc(k)}</b>${v ? `<span>${esc(v)}</span>` : ""}</li>`).join("")}</ul>`,
                )
                .join("")}`,
          )
          .join("")}</details>`
      : "";
  const aiAnswersMd = () =>
    answers
      ? [
          "## AI answer check",
          "",
          noteMd(ANSWERS_INTRO),
          "",
          ...answers.engines.flatMap(e => [
            `### ${noteMd(e.name)}`,
            "",
            noteMd(`${engineName(e)}: ${answersHead(e)}`),
            "",
            ...(answersStop(e) ? [noteMd(answersStop(e)), ""] : []),
            ...answersLists(e).flatMap(([t, rows]) => [
              `${t}:`,
              "",
              ...rows.map(
                ([k, v]) => `- ${t === "Your pages cited" ? noteCode(k) : noteMd(k)}${v ? ` ${noteMd(v)}` : ""}`,
              ),
              "",
            ]),
          ]),
        ]
      : [];
  return { agentsHtml, agentsMd, aiCrawlersHtml, aiCrawlersMd, aiAnswersHtml, aiAnswersMd };
}
