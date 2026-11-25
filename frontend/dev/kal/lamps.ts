// A row of small clay lamps. Once lit, lit for the visit: by the hand that passes, or one after
// another when their scene wakes.

import type { Row } from "./stone";

export class Lamps {
  row: Row;
  private due: number[];
  private born: number[];
  constructor(public n: number) {
    this.row = { x: 0, y: 0, step: 1, n, lit: new Float32Array(n), size: 26 };
    this.due = new Array(n).fill(Infinity);
    this.born = new Array(n).fill(Infinity);
  }
  place(x: number, y: number, step: number, size: number) {
    Object.assign(this.row, { x, y, step, size });
  }
  /** One after another, from the lamp nearest `from` (0–1 along the row). */
  wake(t: number, from: number, gap = 0.14) {
    const order = [...this.due.keys()].sort((a, b) => Math.abs(a / (this.n - 1 || 1) - from) - Math.abs(b / (this.n - 1 || 1) - from));
    order.forEach((i, k) => {
      this.due[i] = Math.min(this.due[i], t + k * gap);
    });
  }
  all() {
    this.due.fill(0);
    this.born.fill(-10);
    this.row.lit.fill(1);
  }
  get awake() {
    return this.born.every((b) => b < Infinity);
  }
  /** True while one is catching. */
  tick(t: number, hx: number, hy: number): boolean {
    const r = this.row;
    let busy = false;
    for (let i = 0; i < this.n; i++) {
      if (this.born[i] === Infinity && (t >= this.due[i] || (Math.abs(r.y - hy) < 90 && Math.abs(r.x + i * r.step - hx) < 46))) this.born[i] = t;
      const a = t - this.born[i];
      if (a < 0 || a === -Infinity) continue;
      if (a < 0.9) {
        // It overshoots as it catches, and settles.
        const u = Math.min(1, a / 0.16);
        r.lit[i] = u * (1 + 0.35 * Math.exp(-a * 5));
        busy = true;
      } else r.lit[i] = 1;
    }
    return busy;
  }
}
