// @ts-check
// Agent readiness: what AI agents can use on a page, Bing's AI rules, AI crawler rules, and the AI bot list.
export const CHECKS = {
  "click-only-elements": [
    "AI-05",
    "low",
    n => `${n} page(s) have elements that only a mouse click works on`,
    "A `<div>`, `<span>` or table row with an `onclick` and no role is clickable with a mouse, but nothing tells a screen reader or an AI agent that browses the site for someone that it does anything: it isn't in the page's list of buttons and links, and the Tab key skips it. Agents act on what the accessibility tree calls a button or a link.",
    'Use a real `<button type="button">` for an action and an `<a href>` for a link to another page. If the element must stay a `<div>`, give it `role="button"`, `tabindex="0"` and a key handler for Enter and Space.',
  ],
  "content-signal-placement": [
    "MAP-06",
    "low",
    n => `robots.txt has ${n} Content-Signal line(s) or group(s) that crawlers won't read a signal from`,
    "A Content-Signal line applies to the user-agent group it sits in, as every example on contentsignals.org places it. One above the first `User-agent:` line belongs to no group. A crawler reads only the group that names it (or the `*` group when none does), so a group without its own Content-Signal line gives its crawlers no signal.",
    "Put a Content-Signal line in each group that lets crawlers in, right under its `User-agent:` lines, for example `User-agent: *` then `Content-Signal: search=yes, ai-train=no` then `Allow: /`. A group that blocks its crawlers with `Disallow: /` needs none.",
  ],
  // WAF custom rules can't skip Bot Fight Mode, but an IP Access rule matches before it, and Super Bot Fight Mode
  // allows Skip rules. Perplexity warns it can still challenge their bots.
  // https://developers.cloudflare.com/bots/get-started/bot-fight-mode/
  // https://docs.perplexity.ai/guides/bots
  "ai-bot-refused": [
    "MAP-06",
    "needs-decision",
    n => `${n} page(s) turn away requests that claim to be an AI search crawler`,
    "Asked with the user agent of OAI-SearchBot, Claude-SearchBot or PerplexityBot, these pages answered with an error or a bot challenge, while the same request as a visitor got the page. A firewall, CDN bot setting or security plugin usually does this, and robots.txt doesn't show it, so the site can be left out of ChatGPT, Claude or Perplexity answers without anyone deciding that. A firewall that checks the vendor's IP addresses is right to refuse this test, which doesn't come from them, so the test can't tell the two apart.",
    "Decide whether these crawlers should reach the site, and record it in the profile (MAP-06). To let them in, allow the vendors' published IP ranges (openai.com/searchbot.json, claude.com/crawling/bots.json, perplexity.ai/perplexitybot.json) or the CDN's verified-bots list in the firewall rules, not the user agent alone. Then run log-scan.mjs with --verify-ips on the server logs to see what the real crawlers get. When the evidence names Cloudflare's Bot Fight Mode: custom firewall rules can't skip it, so let the vendors' IP ranges in with an IP Access rule, which Cloudflare checks first, or use Super Bot Fight Mode, which allows Skip rules.",
  ],
  // needs-decision, not low: either line may be a deliberate exception (one vendor licensed to train), which the
  // crawl can't tell.
  "ai-robots-conflict": [
    "MAP-06",
    "needs-decision",
    n => `robots.txt has ${n} AI crawler rule(s) that contradict each other`,
    "Some robots.txt lines for AI crawlers say opposite things: a vendor's AI search crawler let in while its fetcher for pages a person asks about is kept out (or the reverse), a Content-Signal line that says the opposite of its group's Allow and Disallow lines, or the shared AI-training opt-out set while a training crawler's own group lets it in. Each crawler follows the group that names it, so the site may not get the policy the owner meant. Blocking training crawlers while letting AI search in is a valid policy and isn't flagged.",
    "Decide what each AI crawler should do, record it in the profile (MAP-06) and make the lines agree: give a vendor's search crawler and its fetcher the same rule unless they should differ, keep each Content-Signal line in step with its group's Allow and Disallow lines, and with the shared training opt-out set, remove the Allow lines for training crawlers that shouldn't train on the site.",
  ],
  // Bing's new AI directives and its noarchive cut-over dates; Amazon reads noarchive as a training opt-out.
  // https://blogs.bing.com/search/2026/10/your-content-your-choice-clearer-preferences-for-training-and-grounding/
  // https://developer.amazon.com/amazonbot
  "ai-legacy-noarchive": [
    "AI-03",
    "needs-decision",
    n => `${n} page(s) still use noarchive or nocache, which Bing stops reading as AI controls on 1 Mar 2027`,
    "Bing reads noarchive and nocache as AI controls today: noarchive keeps a page out of Copilot's answers and out of training. That ends soon. Bing honours its new `ai-grounding` and `ai-training` directives from 1 Feb 2027, and from 1 Mar 2027 noarchive and nocache no longer control training or grounding, so a page kept out of Copilot today goes back in unless it gets the new directive. Bing search itself isn't affected either way. Amazon reads noarchive as \"don't use this page to train AI models\".",
    'Decide what these pages should allow. To keep a page out of AI answers and training, add `<meta name="bingbot" content="ai-grounding:disallow, ai-training:disallow">` (or the same in an `X-Robots-Tag: bingbot:` header); `ai-grounding:disallowextended` keeps it in Microsoft\'s own Copilot but out of grounding services Microsoft sells to other companies. If noarchive was never meant to keep the page out of AI answers, remove it. From 15 Dec 2026, sites that use noarchive or nocache can set a temporary preference in Bing Webmaster Tools, which expires on 30 Sep 2027.',
  ],
  "ai-preference-invalid": [
    "AI-03",
    "low",
    n => `${n} page(s) give Bing an ai-grounding or ai-training value it doesn't list`,
    "Bing lists `allow`, `disallow` and `disallowextended` for ai-grounding, and `allow` and `disallow` for ai-training. A value outside those isn't one Bing documents, so the page may not get the setting the owner meant.",
    "Use one of Bing's values: `ai-grounding:disallow` (or `disallowextended`, or `allow`) and `ai-training:disallow` (or `allow`).",
  ],
  // Links with no name are LINK-05's link-no-text, so they aren't counted here.
  "controls-no-name": [
    "AI-05",
    "low",
    n => `${n} page(s) have form fields or buttons with no name`,
    "A form field needs a name that tells people what to type, and a button one that says what it does: a label, an `aria-label`, a title or, for a button, its text. Screen readers read these names out, and AI agents that browse the site for someone use the same names to fill in forms and press buttons. Without one, a search box or an icon-only button is a guess for both.",
    'Give each field a `<label for>` that points at its `id` (or wrap the field in its `<label>`), and each icon-only button an `aria-label`, for example `<button aria-label="Open menu">`. A visible label works better than placeholder text, which disappears as people type.',
  ],
};

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const attrs = tag => {
  const out = {},
    re = /([^\s=\/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  const inner = tag.replace(/^<[\w-]+/, "").replace(/\/?>$/, "");
  for (let m; (m = re.exec(inner));)
    out[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? "").replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENT[e]);
  return out;
};
const filled = v => typeof v === "string" && v.trim() !== "";
const named = a => ["aria-label", "aria-labelledby", "title"].some(k => filled(a[k]));
const unseen = a => /^(none|presentation)$/i.test(a.role || "");
// Hidden from everyone, along with everything inside it.
const gone = a =>
  "hidden" in a ||
  a["aria-hidden"]?.trim().toLowerCase() === "true" ||
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(a.style || "");
// A signup form's spam trap: a text field the Tab key skips, inside a box moved far off screen.
const offScreen = a => /(?:^|;)\s*(?:left|top)\s*:\s*-\d{3,}px/i.test(a.style || "");
const trap = t => {
  const a = attrs(t);
  return a.tabindex?.trim() === "-1" && TEXTLIKE.test((a.type || "text").trim().toLowerCase()) ? " " : t;
};
const VOID = /^(area|br|col|embed|hr|img|input|source|track|wbr)$/i;
const swap = (html, pick, what) => {
  const open = /<([a-z][\w-]*)\b[^>]*>/gi;
  let out = "",
    from = 0;
  for (let m; (m = open.exec(html));) {
    if (!pick(attrs(m[0]))) continue;
    let end = open.lastIndex;
    if (!VOID.test(m[1]) && !m[0].endsWith("/>")) {
      const tag = new RegExp(`<(/?)${m[1]}(?=[\\s/>])[^>]*>`, "gi");
      tag.lastIndex = end;
      for (let d = 1, t; (t = tag.exec(html));)
        if (!(d += t[1] ? -1 : 1)) {
          end = tag.lastIndex;
          break;
        }
    }
    out += html.slice(from, m.index) + what(html.slice(m.index, end));
    from = open.lastIndex = end;
  }
  return out + html.slice(from);
};
// A control as the evidence shows it: tag, type and the first identifying attribute.
const describe = (tag, a) => {
  const k = ["name", "id", "class", "src"].find(x => filled(a[x]));
  return `<${tag}${a.type ? ` type="${a.type}"` : ""}${k ? ` ${k}="${a[k].replace(/[`"]/g, "").slice(0, 40)}"` : ""}>`;
};
// The first object literal in s without its nested objects, so a tool's name can't come from its input schema or
// from code after the call. Braces inside strings throw the count off; tokenize the script if that matters.
const topLevel = s => {
  let d = 0,
    out = "";
  for (const c of s) {
    if (c === "{") d++;
    if (d === 1) out += c;
    if (c === "}" && --d === 0) break;
  }
  return out;
};
// Inputs a placeholder can name (HTML-AAM 4.1.1); other fields need a label, aria or title (4.1.7).
// https://www.w3.org/TR/html-aam-1.0/
const TEXTLIKE = /^(text|password|number|search|tel|email|url)$/;

export function agentFeatures(html) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(m => !/\ssrc\s*=/i.test(" " + m[1]))
    .map(m => m[2])
    .join("\n");
  // Only what renders; a textarea's contents are text, not markup.
  const doc = html
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi, " ")
    .replace(/(<textarea\b[^>]*>)[\s\S]*?<\/textarea>/gi, "$1</textarea>");
  const labelFor = new Set([...doc.matchAll(/<label\b[^>]*>/gi)].map(m => attrs(m[0]).for).filter(filled));
  // Hidden elements and spam-trap fields are out of visitors' reach, so they're dropped.
  const shown = swap(
    swap(doc, gone, () => " "),
    offScreen,
    el => el.replace(/<input\b[^>]*>/gi, trap),
  );
  // A field inside a <label> is named by it, so only fields outside labels are checked one by one.
  const wrapped =
    (shown.match(/<label\b[\s\S]*?<\/label>/gi) || []).join(" ").match(/<(input|select|textarea)\b/gi)?.length || 0;
  const loose = shown.replace(/<label\b[\s\S]*?<\/label>/gi, " ");
  const unnamedFields = [],
    unnamedButtons = [];
  let controls = wrapped;
  for (const m of loose.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
    const tag = m[1].toLowerCase(),
      a = attrs(m[0]),
      type = (a.type || "").trim().toLowerCase();
    if (unseen(a) || (tag === "input" && type === "hidden")) continue;
    controls++;
    if (named(a)) continue;
    // Submit and reset have a default name unless value is set empty; an image button needs alt (HTML-AAM 4.1.2-3).
    if (tag === "input" && /^(submit|reset)$/.test(type)) {
      if ("value" in a && !filled(a.value)) unnamedButtons.push(describe(tag, a));
      continue;
    }
    if (tag === "input" && type === "button") {
      if (!filled(a.value)) unnamedButtons.push(describe(tag, a));
      continue;
    }
    if (tag === "input" && type === "image") {
      if (!filled(a.alt) && !filled(a.value)) unnamedButtons.push(describe(tag, a));
      continue;
    }
    const placeholder = tag === "textarea" || (tag === "input" && TEXTLIKE.test(type || "text"));
    if (!(filled(a.id) && labelFor.has(a.id)) && !(placeholder && filled(a.placeholder)))
      unnamedFields.push(describe(tag, a));
  }
  // A button is named by its text (an SVG <title> counts), an alt or label inside it, or its own aria-label or title.
  for (const m of shown.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const a = attrs("<button " + m[1] + ">");
    if (unseen(a)) continue;
    controls++;
    const text = m[2]
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .trim();
    if (!named(a) && !text && !/\s(alt|aria-label|aria-labelledby|title)\s*=\s*["']?\s*[^\s"'>]/i.test(m[2]))
      unnamedButtons.push(describe("button", a));
  }
  // WebMCP tools: forms with toolname and tooldescription, then registerTool() calls in inline scripts (external
  // scripts aren't fetched). navigator.modelContext is the older name for document.modelContext.
  // https://webmachinelearning.github.io/webmcp/
  // https://developer.chrome.com/docs/ai/webmcp/declarative-api
  const tools = [...doc.matchAll(/<form\b[^>]*>/gi)]
    .map(m => attrs(m[0]))
    .filter(a => filled(a.toolname) && filled(a.tooldescription))
    .map(a => a.toolname.trim());
  if (/\bmodelContext\b/.test(scripts))
    for (const call of scripts.split(/\bregisterTool\s*\(/).slice(1)) {
      const own = /^\s*\{/.test(call) && /["']?\bname["']?\s*:\s*(["'`])([^"'`\n]{1,100})\1/.exec(topLevel(call));
      tools.push(own ? own[2] : "a tool set up by a script");
    }
  // Click-only: an onclick on a non-interactive tag with no role. A landmark counts as its tag or its ARIA role.
  const clickOnly = [...shown.matchAll(/<([a-z][\w-]*)\b[^>]*>/gi)]
    .map(m => /** @type {[string, Record<string, string>]} */ ([m[1].toLowerCase(), attrs(m[0])]))
    .filter(([tag, a]) => "onclick" in a && !("role" in a) && !INTERACTIVE.test(tag))
    .map(([tag, a]) => describe(tag, a));
  const landmarksMissing = Object.entries(LANDMARKS)
    .filter(([tag, role]) => !new RegExp(`<${tag}(?=[\\s>/])|\\srole\\s*=\\s*["']?${role}\\b`, "i").test(doc))
    .map(([tag]) => tag);
  return { unnamedFields, unnamedButtons, webmcpTools: [...new Set(tools)], controls, clickOnly, landmarksMissing };
}
const INTERACTIVE = /^(a|area|button|input|select|textarea|summary|label|option|details)$/;
const LANDMARKS = { main: "main", nav: "navigation", header: "banner", footer: "contentinfo" };

// The AI crawlers and fetchers in the robots table, as [token, vendor, kind, mayIgnore, { alias, fallback }]. kind:
// search, training, user (fetches a page a person asked for) or other; mayIgnore: the vendor says robots.txt may not
// apply; alias: a second accepted name; fallback: the group it follows when unnamed. Rows follow the vendors' pages
// below or are tokens the crawl already checks. Cohere runs no crawler, and Claude-Agent is left out since its page
// doesn't say how robots.txt applies.
// https://developers.openai.com/api/docs/bots
// https://docs.perplexity.ai/guides/bots
// https://support.claude.com/en/articles/8896518
// https://support.claude.com/en/articles/18234133
// https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers
// https://developers.google.com/search/docs/crawling-indexing/google-user-triggered-fetchers
// https://docs.mistral.ai/robots
// https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot
// https://developer.amazon.com/amazonbot
// https://yandex.com/support/webmaster/en/yandex-ai
// https://developers.facebook.com/docs/sharing/webmasters/web-crawlers
// https://support.apple.com/en-us/119829
// https://docs.cohere.com/docs/cohere-web-crawlers
/** @type {[string, string, string, boolean?, { alias?: string, fallback?: string }?][]} */
export const AI_BOTS = [
  ["OAI-SearchBot", "OpenAI", "search"],
  ["Claude-SearchBot", "Anthropic", "search"],
  ["PerplexityBot", "Perplexity", "search"],
  ["MistralAI-Index", "Mistral", "search"],
  ["DuckAssistBot", "DuckDuckGo", "search"],
  ["Amzn-SearchBot", "Amazon", "search"],
  ["YandexAdditionalBot", "Yandex", "search", false, { alias: "YandexAdditional" }],
  ["Applebot", "Apple", "search", false, { fallback: "Googlebot" }],
  ["GPTBot", "OpenAI", "training"],
  ["ClaudeBot", "Anthropic", "training"],
  ["Google-Extended", "Google", "training"],
  ["Applebot-Extended", "Apple", "training"],
  ["CCBot", "Common Crawl", "training"],
  ["Bytespider", "ByteDance", "training"],
  ["meta-externalagent", "Meta", "training"],
  ["MistralAI-Training", "Mistral", "training"],
  ["Amazonbot", "Amazon", "training"],
  ["ChatGPT-User", "OpenAI", "user", true],
  ["Claude-User", "Anthropic", "user"],
  ["Perplexity-User", "Perplexity", "user", true],
  ["Google-Agent", "Google", "user", true],
  ["Google-GeminiNotebook", "Google", "user", true],
  ["MistralAI-User", "Mistral", "user"],
  ["Amzn-User", "Amazon", "user", true],
  ["Meta-ExternalFetcher", "Meta", "user", true],
  ["OAI-AdsBot", "OpenAI", "other"],
  ["Google-CloudVertexBot", "Google", "other"],
];

// Bing's AI rules from robots meta contents and X-Robots-Tag lines. A "<crawler>:" prefix holds for the rules after
// it; VALUED names take a value after the colon, so they aren't prefixes. legacy holds noarchive and nocache, which
// Bing reads as AI controls until 1 Mar 2027.
// https://blogs.bing.com/search/2026/10/your-content-your-choice-clearer-preferences-for-training-and-grounding/
export const VALUED = /^(max-snippet|max-image-preview|max-video-preview|unavailable_after|ai-grounding|ai-training)$/;
export const BING_PREFS = {
  "ai-grounding": ["allow", "disallow", "disallowextended"],
  "ai-training": ["allow", "disallow"],
};
/** @param {string[]} metas @param {string[]} headerLines */
export function bingAiRules(metas, headerLines) {
  const legacy = [],
    prefs = [];
  const read = (s, where) => {
    let agent = null;
    for (let t of String(s || "")
      .toLowerCase()
      .split(",")) {
      const m = /^\s*([a-z][\w-]*)\s*:\s*(.*)$/.exec(t);
      if (m && !VALUED.test(m[1])) [, agent, t] = m;
      t = t.trim().replace(/\s*:\s*/, ":");
      if (!t || (agent && agent !== "bingbot")) continue;
      if (t === "noarchive" || t === "nocache") legacy.push({ rule: t, where });
      const p = /^(ai-grounding|ai-training):(.*)$/.exec(t);
      if (p) prefs.push({ name: p[1], value: p[2] });
    }
  };
  metas.forEach(s => read(s, "meta"));
  headerLines.forEach(s => read(s, "header"));
  return { legacy, prefs };
}

// Content-Signal lines crawlers won't read: one above the first User-agent line and, once any group has a signal,
// each group without one that still lets crawlers in. blocksAll gets a group as { rules: [{ allow, path }] }.
// https://contentsignals.org
export function signalPlacement(txt, blocksAll) {
  const { groups, loose } = robotsGroups(txt);
  const out = loose
    .filter(l => l.k === "content-signal")
    .map(l => `line ${l.line}: Content-Signal comes before any User-agent line, so it belongs to no group`);
  // A crawler reads every group naming it as one, and Cloudflare's managed block often sits in front of the site's
  // own `User-agent: *` group, so groups are merged per crawler first.
  // https://www.rfc-editor.org/rfc/rfc9309#section-2.2.1
  const byAgent = new Map();
  for (const g of groups)
    for (const a of g.agents) {
      const k = agentKey(a),
        m = byAgent.get(k) || byAgent.set(k, { agents: [a], rules: [], signal: false }).get(k);
      m.rules.push(...g.rules);
      m.signal ||= g.signals.length > 0;
    }
  const unsignalled = a => {
      const m = byAgent.get(agentKey(a));
      return !m.signal && !blocksAll(m);
    },
    told = new Set();
  if (groups.some(g => g.signals.length))
    for (const g of groups) {
      const names = g.agents.filter(a => unsignalled(a) && !told.has(agentKey(a)));
      names.forEach(a => told.add(agentKey(a)));
      if (names.length)
        out.push(`the User-agent: ${names.join(", ")} group has no Content-Signal line, though other groups do`);
    }
  return out;
}

// The crawler name parseRobots matches on: the leading letters, "_" and "-", lowercased.
const agentKey = a => (a.startsWith("*") ? "*" : (/^[A-Za-z_-]+/.exec(a)?.[0] || a).toLowerCase());
// robots.txt groups as parseRobots forms them, with the lines it skips: Content-Signal and aipref Content-Usage lines
// (rules inside a group, draft-ietf-aipref-attach-05) go on their group's signals and usage, or on loose before the
// first User-agent line; line is 1-based.
/** @param {string} txt */
function robotsGroups(txt) {
  /** @type {{ agents: string[], rules: { allow: boolean, path: string }[], signals: { line: number, k: string, v: string }[], usage: { line: number, k: string, v: string }[] }[]} */
  const groups = [];
  const loose = [];
  let cur = null;
  String(txt || "")
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.replace(/#.*/, "").trim(),
        c = line.indexOf(":");
      if (c < 0) return;
      const k = line.slice(0, c).trim().toLowerCase(),
        v = line.slice(c + 1).trim();
      if (k === "user-agent") {
        if (!cur || cur.rules.length) groups.push((cur = { agents: [], rules: [], signals: [], usage: [] }));
        cur.agents.push(v);
      } else if (k === "content-signal" || k === "content-usage")
        (cur ? cur[k === "content-signal" ? "signals" : "usage"] : loose).push({ line: i + 1, k, v });
      else if ((k === "allow" || k === "disallow") && cur) cur.rules.push({ allow: k === "allow", path: v });
    });
  return { groups, loose };
}

// AI crawler rules in one robots.txt that contradict each other, as sentences, and aipref Content-Usage lines as
// written: the aipref drafts aren't final, so those are shown, not judged. Groups naming the same crawler read as one.
// Blocking training while letting search in is a policy, not a contradiction, and is never flagged.
// https://datatracker.ietf.org/doc/draft-ietf-aipref-attach/
// https://datatracker.ietf.org/doc/draft-ietf-aipref-vocab/
/** @param {string} txt @param {(group: { rules: { allow: boolean, path: string }[] }, path: string) => boolean} allowed */
export function aiRobots(txt, allowed) {
  const { groups, loose } = robotsGroups(txt),
    out = [];
  const merged = key => {
    const gs = groups.filter(g => g.agents.some(a => agentKey(a) === key));
    return gs.length ? { rules: gs.flatMap(g => g.rules) } : null;
  };
  const list = a => (a.length > 1 ? `${a.slice(0, -1).join(", ")} and ${a.at(-1)}` : a[0]);
  // 1. A vendor's search crawler against its user fetchers.
  const star = merged("*"),
    status = bot => {
      const own = merged(bot.toLowerCase()),
        g = own || star;
      return !g || allowed(g, "/") ? "" : own ? "its own group" : "the `User-agent: *` group";
    };
  for (const [s, vendor] of AI_BOTS.filter(b => b[2] === "search"))
    for (const [u] of AI_BOTS.filter(b => b[1] === vendor && b[2] === "user")) {
      const [bs, bu] = [status(s), status(u)],
        S = `${s}, ${vendor}'s AI search crawler,`,
        U = `${u}, which fetches pages a person asks ${vendor}'s assistant for,`;
      if (!bs !== !bu)
        out.push(
          bu ? `${S} is allowed, but ${U} is blocked by ${bu}.` : `${U} is allowed, but ${S} is blocked by ${bs}.`,
        );
    }
  // 2. Content-Signal lines against their group, per set of crawlers sharing the same groups: a yes where Disallow
  // keeps them out, a no to the one use a search-only or training-only group exists for, or two lines disagreeing.
  // In a training-only group only ai-train counts; a copied search=yes says nothing about those crawlers.
  const shared = merged("__usage_ai-training"),
    optOut = !shared
      ? ""
      : !allowed(shared, "/")
        ? "blocked"
        : shared.rules.some(x => !x.allow && x.path)
          ? ""
          : "allowed";
  const kindOf = key =>
    AI_BOTS.find(([n, , , , { alias } = {}]) => n.toLowerCase() === key || alias?.toLowerCase() === key)?.[2];
  const sets = new Map();
  for (const key of new Set(groups.flatMap(g => g.agents.map(agentKey)))) {
    if (key === "__usage_ai-training") continue;
    const idx = groups.flatMap((g, i) => (g.agents.some(a => agentKey(a) === key) ? [i] : [])),
      id = idx.join();
    const set =
      sets.get(id) ||
      sets
        .set(id, {
          names: [],
          kinds: new Set(),
          rules: idx.flatMap(i => groups[i].rules),
          signals: idx.flatMap(i => groups[i].signals),
        })
        .get(id);
    set.names.push(groups[idx[0]].agents.find(a => agentKey(a) === key).replace(/`/g, ""));
    set.kinds.add(kindOf(key));
  }
  for (const { names, kinds, rules, signals } of sets.values()) {
    const g = { rules },
      label = `\`User-agent: ${names.join(", ")}\``,
      kind = kinds.size === 1 ? [...kinds][0] : undefined,
      seen = new Map();
    for (const { v } of signals) {
      const m = /^(\/\S*)\s+(.*)$/.exec(v),
        path = m ? m[1] : "/",
        at = path === "/" ? "" : ` for ${path}`,
        open = allowed(g, path);
      const pairs = Object.fromEntries(
        (m ? m[2] : v)
          .split(",")
          .map(p => p.split("=").map(x => x.trim().toLowerCase()))
          .filter(([k, x]) => /^(search|ai-input|ai-train)$/.test(k) && /^(yes|no)$/.test(x)),
      );
      const yes = Object.keys(pairs).filter(k => pairs[k] === "yes" && (kind !== "training" || k === "ai-train"));
      if (!open && yes.length)
        out.push(
          `The ${label} group's Content-Signal line says ${yes.map(k => `${k}=yes`).join(", ")}${at}, but its Disallow lines keep those crawlers out of ${at ? path : "the whole site"}.`,
        );
      const own = { search: "search", training: "ai-train" }[kind];
      if (open && own && pairs[own] === "no")
        out.push(
          `The ${label} group lets its crawlers in${at}, but its Content-Signal line says ${own}=no${at}, though these are AI ${kind} crawlers.`,
        );
      for (const [k, x] of Object.entries(pairs)) {
        const was = seen.get(path + " " + k);
        if (was === undefined) seen.set(path + " " + k, x);
        else if (was !== x && was !== "told") {
          out.push(`The ${label} group says ${k}=${was} in one Content-Signal line and ${k}=${x} in another${at}.`);
          seen.set(path + " " + k, "told");
        }
      }
      if (open && !at && optOut && pairs["ai-train"] === (optOut === "blocked" ? "yes" : "no"))
        out.push(
          `The shared AI-training opt-out (\`User-agent: __usage_ai-training\`) ${optOut === "blocked" ? "refuses" : "allows"} training for the whole site, but the Content-Signal line in the ${label} group says ai-train=${pairs["ai-train"]}.`,
        );
    }
  }
  // 3. The shared opt-out against training crawlers their own group lets in: the draft lets specific rules win
  // (section 4.5), and Anthropic follows a group that names ClaudeBot.
  // https://datatracker.ietf.org/doc/draft-kelley-aipref-training-preference-signal/
  // https://support.claude.com/en/articles/8896518
  const open =
    optOut === "blocked"
      ? AI_BOTS.filter(
          b => b[2] === "training" && merged(b[0].toLowerCase()) && allowed(merged(b[0].toLowerCase()), "/"),
        ).map(b => b[0])
      : [];
  if (open.length)
    out.push(
      `The shared AI-training opt-out (\`User-agent: __usage_ai-training\`) refuses training for the whole site, but ${list(open)} ${open.length > 1 ? "have their own groups that let them" : "has its own group that lets it"} in. A crawler's own group can win over the shared one: Anthropic says it follows rules that name ClaudeBot first.`,
    );
  const usage = [
    ...loose.filter(l => l.k === "content-usage").map(l => ({ agents: null, rule: l.v })),
    ...groups.flatMap(g => g.usage.map(l => ({ agents: g.agents.join(", "), rule: l.v }))),
  ];
  return {
    conflicts: out,
    usage: usage
      .filter(u => u.rule)
      .slice(0, 20)
      .map(u => ({ agents: u.agents?.slice(0, 200) ?? null, rule: u.rule.slice(0, 200) })),
  };
}

// An RFC 9727 API catalog (a linkset), an A2A Agent Card (A2A 1.0.0 section 8.2), and OAuth metadata, whose required
// members are `resource` (RFC 9728) and `issuer` (RFC 8414).
// https://www.rfc-editor.org/rfc/rfc9727
// https://www.rfc-editor.org/rfc/rfc9728
// https://www.rfc-editor.org/rfc/rfc8414
/** @type {[string, (j: any) => boolean][]} */
const AGENT_FILES = [
  ["/.well-known/api-catalog", j => Array.isArray(j?.linkset)],
  ["/.well-known/agent-card.json", j => filled(j?.name)],
  ["/.well-known/oauth-protected-resource", j => filled(j?.resource)],
  ["/.well-known/oauth-authorization-server", j => filled(j?.issuer)],
];
// Only /.well-known/ paths on the origin are asked for. A file counts only when it parses as what it should be, so a
// soft 404 doesn't, and each is capped at 1 MB unpacked against huge files and gzip bombs.
export async function agentFiles(fetchFn, origin) {
  const read = async path => {
    try {
      const r = await fetchFn(origin + path);
      if (r.status !== 200) {
        await r.body?.cancel();
        return null;
      }
      return JSON.parse(await r.text());
    } catch {
      return null;
    }
  };
  const [ucp, ...files] = await Promise.all(["/.well-known/ucp", ...AGENT_FILES.map(([p]) => p)].map(read));
  // A UCP business profile is a JSON object with a `ucp` member. https://ucp.dev/latest/specification/overview
  const profile = ucp && typeof ucp.ucp === "object" && ucp.ucp;
  return {
    ucp: profile ? (filled(profile.version) ? profile.version : "unknown") : null,
    wellKnown: AGENT_FILES.filter(([, ok], i) => ok(files[i])).map(([p]) => p),
  };
}
