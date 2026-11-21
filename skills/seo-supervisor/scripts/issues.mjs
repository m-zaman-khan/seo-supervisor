#!/usr/bin/env node
// @ts-check
// Files audit findings as GitHub issues through the gh CLI.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { findingsOf } from "./lib/score.mjs";
import { redact } from "./lib/redact.mjs";

const SEV_LABEL = {
  blocker: "Blocker",
  high: "High",
  "needs-decision": "Needs a decision",
  medium: "Medium",
  low: "Low",
};
const REPO = /^[\w.][\w.-]*(\/[\w.][\w.-]*){1,2}$/;
// @name in a finding's text (often quoted from a crawled page) would notify that GitHub user: a zero-width space after
// the @ stops it. An email address (a letter right before the @) is left as it is.
const noPing = s => String(s ?? "").replace(/(^|[^\w])@(?=\w)/g, "$1@​");
const code = s => "`" + String(s).replace(/[`\r\n]/g, " ") + "`";
// gh's own error text, with any secret masked (lib/redact.mjs knows GitHub's token prefixes too).
const tidy = s =>
  redact(
    String(s || "no message")
      .trim()
      .split("\n")
      .slice(-3)
      .join(" "),
  )
    .replace(/\b(gh[pousr]_|github_pat_)\w+/g, "$1[hidden]")
    .slice(0, 300);

/** One finding as an issue: its own title, what, why, fix and up to 10 evidence lines, then the marker. */
export function issueOf(f, site) {
  let host = "";
  try {
    host = new URL(site).host;
  } catch {}
  const ev = (Array.isArray(f.evidence) ? f.evidence : []).filter(e => e && (e.url || e.file)),
    total = Math.max(Number(f.count) || 0, ev.length),
    shown = Math.min(10, ev.length);
  const marker = `<!-- seo-supervisor:${host ? host + ":" : ""}${f.id} -->`;
  const body = [
    f.what && `**What's wrong.** ${noPing(f.what)}`,
    f.why && `**Why it matters.** ${noPing(f.why)}`,
    f.fix && `**How to fix.** ${noPing(f.fix)}`,
    shown &&
      [
        `**Evidence**${shown < total ? ` (${shown} of ${total.toLocaleString("en-US")} cases)` : ""}:`,
        ...ev
          .slice(0, 10)
          .map(
            e =>
              `- ${[e.url && code(e.url), e.file && code(e.file + (e.line ? ":" + e.line : ""))].filter(Boolean).join(" ")}${e.detail ? ` ${noPing(String(e.detail).replace(/\s+/g, " "))}` : ""}`,
          ),
      ].join("\n"),
    `${SEV_LABEL[f.severity] || "Low"}${f.rule ? ` · Rule ${f.rule}` : ""} · Finding ${f.id} from SEO Supervisor's audit${host ? ` of ${host}` : ""}.`,
    marker,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { id: f.id, title: noPing(String(f.title || f.id).replace(/\s+/g, " ")).slice(0, 256), body, marker };
}

/** The findings to file: the ids asked for, or every open one except those marked won't fix (wontFix: how many). */
export function pickFindings(findings, ids) {
  if (!ids) return { picked: findings.filter(f => !["fixed", "wont-fix"].includes(f.status)), unknown: [] };
  return {
    picked: findings.filter(f => ids.includes(f.id)),
    unknown: ids.filter(id => !findings.some(f => f.id === id)),
  };
}

// Never through a shell, so nothing in a title or body is read as a command. gh keeps its own login, so no token is
// read, stored or printed here.
const gh = (args, input) =>
  new Promise(done => {
    const p = spawn("gh", args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "",
      stderr = "";
    p.stdout.on("data", c => {
      stdout += c;
    });
    p.stderr.on("data", c => {
      stderr += c;
    });
    p.on("error", e =>
      done({
        code: 1,
        stdout,
        stderr:
          /** @type {any} */ (e).code === "ENOENT"
            ? "the GitHub CLI (gh) isn't installed or isn't on PATH: see cli.github.com"
            : e.message,
      }),
    );
    p.on("close", c => done({ code: c ?? 1, stdout, stderr }));
    p.stdin.on("error", () => {});
    p.stdin.end(input ?? "");
  });

/** Prints the dry run, or with yes files each issue not filed before. run(args, stdin) is gh; tests pass their own.
 * @param {{ id: string, title: string, body: string, marker: string }[]} list
 * @param {{ yes?: boolean, repo?: string | null, run?: (args: string[], input?: string) => Promise<{ code: number, stdout: string, stderr: string }>, log?: (line: string) => void }} [options] */
export async function fileIssues(list, { yes = false, repo = null, run = gh, log = console.log } = {}) {
  if (repo != null && !REPO.test(repo))
    throw new Error(`issues: --repo takes owner/name (or host/owner/name), not "${repo}".`);
  const where = repo ? [`--repo=${repo}`] : [],
    at = repo || "the current folder's GitHub repository",
    n = `${list.length} issue${list.length === 1 ? "" : "s"}`;
  if (!yes) {
    log(
      `Dry run: ${n} would be filed in ${at}. Nothing was sent. Run again with --yes to file them with your own gh login; findings already filed are skipped.`,
    );
    for (const i of list) log(`\n--- ${i.id}: ${i.title}\n\n${i.body}`);
    return { created: 0, skipped: 0, failed: 0 };
  }
  // A finding whose marker is in one of the newest 1,000 issues, open or closed, was filed before.
  // https://cli.github.com/manual/gh_issue_list
  const listed = await run([
    "issue",
    "list",
    "--state",
    "all",
    "--limit",
    "1000",
    "--json",
    "number,url,body",
    ...where,
  ]);
  let existing = null;
  try {
    existing = listed.code === 0 ? JSON.parse(listed.stdout) : null;
  } catch {}
  if (!Array.isArray(existing)) {
    log(
      `gh couldn't list the issues in ${at}, so none were filed: ${tidy(listed.stderr)}. Check gh auth status and --repo.`,
    );
    return { created: 0, skipped: 0, failed: list.length };
  }
  const r = { created: 0, skipped: 0, failed: 0 };
  for (const [k, i] of list.entries()) {
    const old = existing.find(x => typeof x?.body === "string" && x.body.includes(i.marker));
    if (old) {
      r.skipped++;
      log(`${i.id}: already filed as #${old.number} (${old.url}), skipped.`);
      continue;
    }
    // --body-file - reads the body from standard input. https://cli.github.com/manual/gh_issue_create
    const made = await run(["issue", "create", `--title=${i.title}`, "--body-file", "-", ...where], i.body);
    if (made.code !== 0) {
      r.failed = list.length - k;
      log(`${i.id}: gh couldn't create the issue, so it and the ones after it weren't filed: ${tidy(made.stderr)}`);
      break;
    }
    r.created++;
    log(`${i.id}: filed ${made.stdout.trim()}`);
  }
  log(`Filed ${r.created}, skipped ${r.skipped} already filed${r.failed ? `, ${r.failed} not filed` : ""}.`);
  return r;
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2),
    opt = k => {
      const i = argv.indexOf(k);
      return i >= 0 ? argv[i + 1] : null;
    };
  const file = opt("--audit") || "seo-audit/seo-audit.json",
    ids =
      opt("--ids")
        ?.split(",")
        .map(s => s.trim())
        .filter(Boolean) || null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")),
      loaded = findingsOf(raw, dirname(resolve(file)));
    for (const w of loaded.warnings) console.error("Settings warning: " + w);
    const { picked, unknown } = pickFindings(loaded.findings, ids);
    if (unknown.length)
      console.error(
        `No finding with the ID ${unknown.join(", ")} in ${file} (or its check is turned off in settings.json).`,
      );
    const site = raw.site?.url || raw.siteOrigin || "";
    if (!picked.length) console.log("No findings to file.");
    else {
      const r = await fileIssues(
        picked.map(f => issueOf(f, site)),
        { yes: argv.includes("--yes"), repo: opt("--repo") },
      );
      if (r.failed) process.exitCode = 1;
    }
  } catch (e) {
    console.error(
      e.code === "ENOENT" ? `issues: ${file} doesn't exist. Pass --audit with the audit's JSON file.` : e.message,
    );
    process.exitCode = 2;
  }
}
