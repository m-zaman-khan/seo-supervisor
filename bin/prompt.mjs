// Dependency-free keyboard prompts. They read keypresses from any stream, so tests can drive them with a PassThrough.
import { emitKeypressEvents } from "node:readline";

// The legacy Windows console can't draw these glyphs; Windows Terminal sets WT_SESSION.
const plainGlyphs = process.platform === "win32" && !process.env.WT_SESSION && !process.env.TERM_PROGRAM;
const G = plainGlyphs
  ? { ptr: ">", on: "(*)", off: "( )", yes: "[x]", no: "[ ]" }
  : { ptr: "❯", on: "●", off: "○", yes: "◉", no: "◯" };

function ask({ input, output, render, onKey }) {
  const paint = (code, s) => (output.isTTY && !process.env.NO_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
  return new Promise((resolve, reject) => {
    emitKeypressEvents(input);
    const raw = Boolean(input.isTTY && input.setRawMode);
    if (raw) input.setRawMode(true);
    input.resume();
    let lines = 0;
    const draw = note => {
      const text = render(paint) + (note ? `\n${paint(33, note)}` : "");
      if (lines) output.write(`\x1b[${lines}F\x1b[J`);
      output.write(text + "\n");
      lines = text.split("\n").length;
    };
    const finish = (settle, value) => {
      input.off("keypress", onPress);
      if (raw) input.setRawMode(false);
      input.pause();
      output.write("\x1b[?25h");
      settle(value);
    };
    const onPress = (str, key = {}) => {
      if (key.ctrl && key.name === "c")
        return finish(reject, Object.assign(new Error("Cancelled"), { code: "CANCELLED" }));
      const r = onKey(str, key) || {};
      draw(r.note);
      if ("value" in r) finish(resolve, r.value);
    };
    output.write("\x1b[?25l");
    draw();
    input.on("keypress", onPress);
  });
}

/** One choice. items: [{ value, label, hint? }]. Resolves to the chosen value. */
export function select({ message, items, initial = 0, input = process.stdin, output = process.stdout }) {
  let i = initial;
  return ask({
    input,
    output,
    render: paint =>
      [
        `${paint(36, "?")} ${paint(1, message)}`,
        ...items.map(
          (it, n) =>
            `${n === i ? paint(36, G.ptr) : " "} ${n === i ? paint(36, G.on) : G.off} ${it.label}${it.hint ? `  ${paint(2, it.hint)}` : ""}`,
        ),
      ].join("\n"),
    onKey: (s, k) => {
      if (k.name === "up" || k.name === "k") i = (i - 1 + items.length) % items.length;
      else if (k.name === "down" || k.name === "j") i = (i + 1) % items.length;
      else if (k.name === "return") return { value: items[i].value };
    },
  });
}

/** A checklist: space toggles, a toggles all, enter confirms at least one. Resolves to the values in list order. */
export function multiSelect({ message, items, selected = [], input = process.stdin, output = process.stdout }) {
  let i = 0;
  const on = new Set(selected);
  return ask({
    input,
    output,
    render: paint =>
      [
        `${paint(36, "?")} ${paint(1, message)} ${paint(2, "(space to select, a for all, enter to confirm)")}`,
        ...items.map(
          (it, n) =>
            `${n === i ? paint(36, G.ptr) : " "} ${on.has(it.value) ? paint(32, G.yes) : G.no} ${it.label}${it.hint ? `  ${paint(2, it.hint)}` : ""}`,
        ),
      ].join("\n"),
    onKey: (s, k) => {
      if (k.name === "up" || k.name === "k") i = (i - 1 + items.length) % items.length;
      else if (k.name === "down" || k.name === "j") i = (i + 1) % items.length;
      else if (k.name === "space") on.has(items[i].value) ? on.delete(items[i].value) : on.add(items[i].value);
      else if (k.name === "a") {
        const all = on.size === items.length;
        on.clear();
        if (!all) items.forEach(it => on.add(it.value));
      } else if (k.name === "return") {
        if (!on.size) return { note: "Select at least one with space." };
        return { value: items.filter(it => on.has(it.value)).map(it => it.value) };
      }
    },
  });
}
