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
  "ai-bot-refused": [
    "MAP-06",
    "needs-decision",
    n => `${n} page(s) turn away requests that claim to be an AI search crawler`,
    "Asked with the user agent of OAI-SearchBot, Claude-SearchBot or PerplexityBot, these pages answered with an error or a bot challenge, while the same request as a visitor got the page. A firewall, CDN bot setting or security plugin usually does this, and robots.txt doesn't show it, so the site can be left out of ChatGPT, Claude or Perplexity answers without anyone deciding that. A firewall that checks the vendor's IP addresses is right to refuse this test, which doesn't come from them, so the test can't tell the two apart.",
    "Decide whether these crawlers should reach the site, and record it in the profile (MAP-06). To let them in, allow the vendors' published IP ranges (openai.com/searchbot.json, claude.com/crawling/bots.json, perplexity.ai/perplexitybot.json) or the CDN's verified-bots list in the firewall rules, not the user agent alone. Then run log-scan.mjs with --verify-ips on the server logs to see what the real crawlers get.",
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

// The AI crawlers and fetchers in the robots table, as [token, vendor, kind, mayIgnore]. kind: search, training, user
// (fetches a page a person asked for) or other; mayIgnore: the vendor says robots.txt may not apply. Rows follow the
// vendors' pages below or are tokens the crawl already checks. Cohere runs no crawler, so it isn't listed.
// https://developers.openai.com/api/docs/bots
// https://docs.perplexity.ai/guides/bots
// https://support.claude.com/en/articles/8896518
// https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers
// https://developers.google.com/search/docs/crawling-indexing/google-user-triggered-fetchers
// https://docs.cohere.com/docs/cohere-web-crawlers
export const AI_BOTS = [
  ["OAI-SearchBot", "OpenAI", "search"],
  ["Claude-SearchBot", "Anthropic", "search"],
  ["PerplexityBot", "Perplexity", "search"],
  ["GPTBot", "OpenAI", "training"],
  ["ClaudeBot", "Anthropic", "training"],
  ["Google-Extended", "Google", "training"],
  ["Applebot-Extended", "Apple", "training"],
  ["CCBot", "Common Crawl", "training"],
  ["Bytespider", "ByteDance", "training"],
  ["meta-externalagent", "Meta", "training"],
  ["ChatGPT-User", "OpenAI", "user", true],
  ["Claude-User", "Anthropic", "user"],
  ["Perplexity-User", "Perplexity", "user", true],
  ["Google-Agent", "Google", "user", true],
  ["Google-GeminiNotebook", "Google", "user", true],
  ["OAI-AdsBot", "OpenAI", "other"],
  ["Google-CloudVertexBot", "Google", "other"],
];

// Content-Signal lines crawlers won't read: one above the first User-agent line and, once any group has a signal,
// each group without one that still lets crawlers in. blocksAll gets a group as { rules: [{ allow, path }] }.
// https://contentsignals.org
export function signalPlacement(txt, blocksAll) {
  const out = [],
    groups = [];
  let cur = null;
  txt.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*/, "").trim(),
      c = line.indexOf(":");
    if (c < 0) return;
    const k = line.slice(0, c).trim().toLowerCase(),
      v = line.slice(c + 1).trim();
    if (k === "user-agent") {
      if (!cur || cur.rules.length) groups.push((cur = { agents: [], rules: [], signal: false }));
      cur.agents.push(v);
    } else if (k === "content-signal") {
      if (cur) cur.signal = true;
      else out.push(`line ${i + 1}: Content-Signal comes before any User-agent line, so it belongs to no group`);
    } else if ((k === "allow" || k === "disallow") && cur) cur.rules.push({ allow: k === "allow", path: v });
  });
  // A crawler reads every group naming it as one, and Cloudflare's managed block often sits in front of the site's
  // own `User-agent: *` group, so groups are merged per crawler first.
  // https://www.rfc-editor.org/rfc/rfc9309#section-2.2.1
  const byAgent = new Map();
  for (const g of groups)
    for (const a of g.agents) {
      const k = a.toLowerCase(),
        m = byAgent.get(k) || byAgent.set(k, { agents: [a], rules: [], signal: false }).get(k);
      m.rules.push(...g.rules);
      m.signal ||= g.signal;
    }
  const unsignalled = a => {
      const m = byAgent.get(a.toLowerCase());
      return !m.signal && !blocksAll(m);
    },
    told = new Set();
  if (groups.some(g => g.signal))
    for (const g of groups) {
      const names = g.agents.filter(a => unsignalled(a) && !told.has(a.toLowerCase()));
      names.forEach(a => told.add(a.toLowerCase()));
      if (names.length)
        out.push(`the User-agent: ${names.join(", ")} group has no Content-Signal line, though other groups do`);
    }
  return out;
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
