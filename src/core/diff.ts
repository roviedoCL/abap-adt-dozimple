/**
 * Diff de líneas (Myers, O((N+M)·D)) y formato unificado. Sin dependencias.
 * Si hay más de maxD cambios devuelve undefined: un objeto reescrito entero no
 * se muestra como diff, se dice.
 */
export type OpKind = " " | "-" | "+";
export interface DiffOp {
  op: OpKind;
  text: string;
  /** Línea (1-based) en el texto antiguo / nuevo. */
  a?: number;
  b?: number;
}

function myers(a: string[], b: string[], maxD: number): Array<[OpKind, number, number]> | undefined {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((_, j) => ["+", -1, j]);
  if (m === 0) return a.map((_, i) => ["-", i, -1]);
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] = v en [-(d+1), d+1] al empezar la iteración d (memoria O(D²)).
  const trace: Int32Array[] = [];
  let done = false;
  for (let d = 0; d <= Math.min(max, maxD) && !done; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        done = true;
        break;
      }
    }
  }
  if (!done) return undefined;

  const out: Array<[OpKind, number, number]> = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const snap = trace[d];
    const at = (k: number) => snap[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      out.push([" ", x - 1, y - 1]);
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) out.push(["+", -1, prevY]);
      else out.push(["-", prevX, -1]);
    }
    x = prevX;
    y = prevY;
  }
  return out.reverse();
}

export function diffLines(oldText: string, newText: string, maxD = 2500): DiffOp[] | undefined {
  const a = oldText.replace(/\r\n/g, "\n").split("\n");
  const b = newText.replace(/\r\n/g, "\n").split("\n");
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const mid = myers(a.slice(pre, a.length - suf), b.slice(pre, b.length - suf), maxD);
  if (!mid) return undefined;
  const ops: DiffOp[] = [];
  for (let i = 0; i < pre; i++) ops.push({ op: " ", text: a[i], a: i + 1, b: i + 1 });
  for (const [op, i, j] of mid) {
    if (op === " ") ops.push({ op, text: a[pre + i], a: pre + i + 1, b: pre + j + 1 });
    else if (op === "-") ops.push({ op, text: a[pre + i], a: pre + i + 1 });
    else ops.push({ op, text: b[pre + j], b: pre + j + 1 });
  }
  for (let i = suf; i > 0; i--) ops.push({ op: " ", text: a[a.length - i], a: a.length - i + 1, b: b.length - i + 1 });
  return ops;
}

export interface UnifiedDiff {
  text: string;
  added: number;
  removed: number;
  hunks: number;
}

/** Formato unificado con `context` líneas alrededor de cada cambio. */
export function unified(ops: DiffOp[], context = 3): UnifiedDiff {
  const changed = ops.map((o, i) => (o.op !== " " ? i : -1)).filter((i) => i >= 0);
  const added = ops.filter((o) => o.op === "+").length;
  const removed = ops.filter((o) => o.op === "-").length;
  if (!changed.length) return { text: "", added: 0, removed: 0, hunks: 0 };

  const ranges: Array<[number, number]> = [];
  for (const i of changed) {
    const from = Math.max(0, i - context);
    const to = Math.min(ops.length - 1, i + context);
    const last = ranges[ranges.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else ranges.push([from, to]);
  }
  const out: string[] = [];
  for (const [from, to] of ranges) {
    const slice = ops.slice(from, to + 1);
    const aStart = slice.find((o) => o.a !== undefined)?.a ?? 0;
    const bStart = slice.find((o) => o.b !== undefined)?.b ?? 0;
    const aLen = slice.filter((o) => o.op !== "+").length;
    const bLen = slice.filter((o) => o.op !== "-").length;
    out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
    for (const o of slice) out.push(o.op + o.text);
  }
  return { text: out.join("\n"), added, removed, hunks: ranges.length };
}
