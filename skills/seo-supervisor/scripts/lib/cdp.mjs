// Chrome or Edge over the DevTools protocol, with no dependencies. --remote-debugging-pipe: fd 3 carries commands,
// fd 4 the replies, each JSON message ending in a NUL byte. Each launch gets a throwaway profile, removed on close;
// the browser is killed on any failure and when this process exits.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function launchChrome(browserPath, { headless = true, timeoutMs = 30000 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "seo-supervisor-cdp-"));
  const args = [
    headless && "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--hide-scrollbars",
    "--mute-audio",
    `--user-data-dir=${profile}`,
    "--remote-debugging-pipe",
    "about:blank",
  ].filter(Boolean);
  const proc = spawn(browserPath, args, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  const pending = new Map();
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
  process.once("exit", onExit); // the caller crashed or forgot close()
  proc.once("error", die);
  proc.once("exit", code =>
    die(
      new Error(`browser exited (${code})${stderr.trim() ? `: ${stderr.trim().split("\n").slice(-3).join(" ")}` : ""}`),
    ),
  );
  proc.stderr.on("data", d => {
    stderr = (stderr + d).slice(-2000);
  });
  proc.stdio[3].on("error", () => {}); // EPIPE once the browser is gone; die() reports it
  proc.stdio[4].on("data", d => {
    buf += d;
    for (let k; (k = buf.indexOf("\0")) >= 0; buf = buf.slice(k + 1)) {
      const msg = JSON.parse(buf.slice(0, k)),
        p = pending.get(msg.id);
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
      proc.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    });
  const close = async () => {
    if (!dead) await send("Browser.close").catch(() => {});
    if ((await Promise.race([exited.then(() => true), new Promise(ok => setTimeout(ok, 5000, false))])) === false) {
      kill();
      await exited;
    }
    process.off("exit", onExit);
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
    // A new tab on a flat session, its commands tagged with the session id over the same pipe.
    async newPage() {
      const { targetId } = await send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      return {
        sessionId,
        send: (method, params) => send(method, params, sessionId),
        close: () => send("Target.closeTarget", { targetId }),
      };
    },
  };
}
