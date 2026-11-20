// Agent readiness: what AI agents can use on a page, and the agent files a site publishes. Links with no name are
// LINK-05's link-no-text, so they aren't counted here.

export const CHECKS = {
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
const unseen = a =>
  "hidden" in a || a["aria-hidden"]?.trim().toLowerCase() === "true" || /^(none|presentation)$/i.test(a.role || "");
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
  // A field inside a <label> is named by it, so only fields outside labels are checked one by one.
  const wrapped =
    (doc.match(/<label\b[\s\S]*?<\/label>/gi) || []).join(" ").match(/<(input|select|textarea)\b/gi)?.length || 0;
  const loose = doc.replace(/<label\b[\s\S]*?<\/label>/gi, " ");
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
  for (const m of doc.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
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
  return { unnamedFields, unnamedButtons, webmcpTools: [...new Set(tools)], controls };
}

// An RFC 9727 API catalog (a linkset) and an A2A Agent Card (A2A 1.0.0 section 8.2), plus a UCP business profile, a
// JSON object with a `ucp` member. Only /.well-known/ paths on the origin are asked for, and a file counts only when
// it parses as what it should be, so a soft 404 doesn't.
// https://www.rfc-editor.org/rfc/rfc9727
// https://ucp.dev/latest/specification/overview
const AGENT_FILES = [
  ["/.well-known/api-catalog", j => Array.isArray(j?.linkset)],
  ["/.well-known/agent-card.json", j => filled(j?.name)],
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
