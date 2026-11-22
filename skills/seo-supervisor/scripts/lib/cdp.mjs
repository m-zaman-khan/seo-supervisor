// @ts-check
// Chrome or Edge over the DevTools protocol, with no dependencies. Each launch gets a throwaway profile, removed on
// close; the browser is killed on any failure and when this process exits or gets SIGINT or SIGTERM.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromeProxyArgs } from "./proxy.mjs";

// Chrome's sandbox won't start as root on Linux or in most containers, and a container's /dev/shm is often too small,
// so there both are turned off and the page's scripts run with fewer protections. Container hints: /.dockerenv,
// /run/.containerenv (Podman) and KUBERNETES_SERVICE_HOST (set in every pod).
// https://docs.podman.io/en/latest/markdown/podman-run.1.html
// https://kubernetes.io/docs/tasks/run-application/access-api-from-pod/
export function containerArgs({
  platform = process.platform,
  uid = process.getuid?.(),
  env = process.env,
  exists = existsSync,
} = {}) {
  const inContainer =
    uid === 0 || exists("/.dockerenv") || exists("/run/.containerenv") || !!env.KUBERNETES_SERVICE_HOST;
  return platform === "linux" && inContainer ? ["--no-sandbox", "--disable-dev-shm-usage"] : [];
}

// Chrome's own background traffic, off: without these, headless Chrome contacts Google unasked. Every Chrome this skill
// starts gets them (launchChrome, checks/render.mjs, og-card.mjs, checks/lighthouse.mjs). Names come from Chromium's
// chrome_switches.h, command_line_switches.h and BASE_FEATURE lines. What each feature reached for behind a refusing
// proxy (Chrome 157): OptimizationHints, Translate and MediaRouter (their services), NetworkTimeServiceQuerying
// (clients2.google.com/time), AutofillServerCommunication (content-autofill.googleapis.com, for a page's forms),
// SafeBrowsingHashPrefixRealTimeLookups (www.gstatic.com/ohttp_gateway), AimEnabled (www.google.com/async/folae) and
// PreconnectToSearch (www.google.com); SkipListAccountsWithoutGaiaCookies skips accounts.google.com/ListAccounts.
// Chrome reads only the last --disable-features, --enable-features and --host-resolver-rules, so a caller's own list
// must include these.
// update.googleapis.com resolves to ^NOTFOUND: Chrome 157 pings it on close after a page got real input, and no switch
// or feature stops that (newer Chromium skips it headless). The guard's proxy sends that host here too
// (startGuard in checks/render.mjs). No page loads anything from it.
export const CHROME_FLAGS = [
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-sync",
  "--disable-default-apps",
  "--no-pings",
  "--disable-domain-reliability",
  "--disable-features=OptimizationHints,Translate,MediaRouter,NetworkTimeServiceQuerying,AutofillServerCommunication,SafeBrowsingHashPrefixRealTimeLookups,AimEnabled,PreconnectToSearch",
  "--enable-features=SkipListAccountsWithoutGaiaCookies",
];

// args: extra Chrome flags, added after the standard ones (none by default).
export async function launchChrome(browserPath, { headless = true, timeoutMs = 30000, args: extra = [] } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "seo-supervisor-cdp-"));
  const args = [
    headless && "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--hide-scrollbars",
    "--mute-audio",
    ...CHROME_FLAGS,
    ...containerArgs(),
    ...chromeProxyArgs(),
    `--user-data-dir=${profile}`,
    "--remote-debugging-pipe",
    ...extra,
    "about:blank",
  ].filter(Boolean);
  const proc = spawn(browserPath, args, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  const pending = new Map(),
    listeners = new Set();
  let nextId = 0,
    buf = "",
    stderr = "",
    dead = null;
  const exited = new Promise(ok => {
    proc.once("exit", ok);
    proc.once("error", ok);
  });
  const kill = () => {
    try {
      proc.kill("SIGKILL");
    } catch {}
  };
  const die = err => {
    dead ||= err;
    for (const p of pending.values()) p.fail(dead);
    pending.clear();
  };
  const onExit = () => {
    kill();
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  };
  // Ctrl+C or a kill: close as usual, then let the signal end the process as it would have, unless the caller handles
  // it. A second Ctrl+C meanwhile exits at once, and the exit handler still cleans up.
  const onSignal = sig => {
    unhookSignals();
    close().then(() => {
      if (!process.listenerCount(sig)) process.kill(process.pid, sig);
    });
  };
  const unhookSignals = () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
  process.once("exit", onExit); // the caller crashed or forgot close()
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  proc.once("error", die);
  proc.once("exit", code =>
    die(
      new Error(`browser exited (${code})${stderr.trim() ? `: ${stderr.trim().split("\n").slice(-3).join(" ")}` : ""}`),
    ),
  );
  proc.stderr.on("data", d => {
    stderr = (stderr + d).slice(-2000);
  });
  // --remote-debugging-pipe: fd 3 carries commands, fd 4 the replies, each JSON message ending in a NUL byte.
  const toBrowser = /** @type {import("node:stream").Writable} */ (proc.stdio[3]),
    fromBrowser = /** @type {import("node:stream").Readable} */ (proc.stdio[4]);
  toBrowser.on("error", () => {}); // EPIPE once the browser is gone; die() reports it
  fromBrowser.setEncoding("utf8"); // a multi-byte character can straddle two reads
  fromBrowser.on("data", d => {
    buf += d;
    for (let k; (k = buf.indexOf("\0")) >= 0; buf = buf.slice(k + 1)) {
      const msg = JSON.parse(buf.slice(0, k)),
        p = pending.get(msg.id);
      if (msg.method) {
        for (const l of listeners) l(msg);
        continue;
      }
      if (!p) continue; // replies that already timed out
      pending.delete(msg.id);
      if (msg.error) p.fail(new Error(`${p.method}: ${msg.error.message}`));
      else p.ok(msg.result);
    }
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((ok, fail) => {
      if (dead) return fail(dead);
      const id = ++nextId,
        timer = setTimeout(() => {
          pending.delete(id);
          fail(new Error(`${method} timed out after ${timeoutMs / 1000} s`));
        }, timeoutMs);
      pending.set(id, {
        method,
        ok: v => {
          clearTimeout(timer);
          ok(v);
        },
        fail: e => {
          clearTimeout(timer);
          fail(e);
        },
      });
      toBrowser.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    });
  const close = async () => {
    if (!dead) await send("Browser.close").catch(() => {});
    let grace; // 5 s for the browser to exit by itself, then it's killed; cleared so a quick exit doesn't hold this process
    const gone = await Promise.race([
      exited.then(() => true),
      new Promise(ok => {
        grace = setTimeout(ok, 5000, false);
      }),
    ]);
    clearTimeout(grace);
    if (!gone) {
      kill();
      await exited;
    }
    process.off("exit", onExit);
    unhookSignals();
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {} // Windows keeps files locked for a moment
  };
  try {
    await send("Browser.getVersion");
  } catch (e) {
    kill();
    await close();
    throw e;
  }

  return {
    pid: proc.pid,
    profile,
    send,
    close,
    // A new tab on a flat session, its commands tagged with the session id over the same pipe. on(event, fn) gets the
    // tab's events until it closes.
    async newPage() {
      const { targetId } = await send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      const mine = new Set();
      return {
        sessionId,
        send: (method, params) => send(method, params, sessionId),
        on: (method, fn) => {
          const l = m => m.sessionId === sessionId && m.method === method && fn(m.params);
          listeners.add(l);
          mine.add(l);
        },
        close: () => {
          for (const l of mine) listeners.delete(l);
          return send("Target.closeTarget", { targetId });
        },
      };
    },
  };
}
