// The lettering for the carvings and the coin, as masks (white on black), drawn
// by Chromium so Tamil is shaped properly. Fonts: Noto Serif Tamil, Cinzel (OFL).
const { chromium } = require("../../frontend/node_modules/@playwright/test");
const fs = require("fs");
const A = process.argv[2]; // a folder with fonts/nst700.ttf and fonts/cinzel700.ttf; the masks are written there
const b64 = (f) => fs.readFileSync(A + "/fonts/" + f).toString("base64");
(async () => {
  const b = await chromium.launch({ channel: "chromium" });
  const p = await b.newPage();
  await p.setContent(`<style>
    @font-face{font-family:T;src:url(data:font/ttf;base64,${b64("nst700.ttf")})}
    @font-face{font-family:C;src:url(data:font/ttf;base64,${b64("cinzel700.ttf")})}
  </style><p style="font-family:T">கேடில்</p><p style="font-family:C">A1</p>`);
  await p.evaluate(() => document.fonts.ready);
  const save = async (name, fn, arg) => {
    const url = await p.evaluate(fn, arg);
    fs.writeFileSync(A + "/" + name, Buffer.from(url.split(",")[1], "base64"));
    console.log(name);
  };
  // lines of Tamil, centred in a box, each fitted to the same size
  const lines = ({ w, h, rows, size, gap }) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "alphabetic";
    let px = size;
    g.font = `700 ${px}px T`;
    const widest = Math.max(...rows.map((r) => g.measureText(r).width));
    if (widest > w * 0.94) px *= (w * 0.94) / widest;
    g.font = `700 ${px}px T`;
    const step = gap ?? h / rows.length;
    const top = (h - step * rows.length) / 2;
    rows.forEach((r, i) => {
      const m = g.measureText(r);
      g.fillText(r, w / 2, top + step * (i + 0.5) + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
    });
    return c.toDataURL("image/png");
  };
  await save("kural_l.png", lines, { w: 1500, h: 1134, rows: ["கேடில்", "விழுச்செல்வம்", "கல்வி", "யொருவற்கு"], size: 218 });
  await save("kural_r.png", lines, { w: 1500, h: 1134, rows: ["மாடல்ல", "மற்றை", "யவை", "குறள் ௪௦௦"], size: 218 });
  await save("kural_b1.png", lines, { w: 3400, h: 290, rows: ["கேடில் விழுச்செல்வம் கல்வி யொருவற்கு"], size: 178 });
  await save("kural_b2.png", lines, { w: 3400, h: 290, rows: ["மாடல்ல மற்றை யவை"], size: 178 });
  // words on a circle: caps standing outward on top, inward at the bottom
  const coin = ({ n, parts }) => {
    const c = document.createElement("canvas");
    c.width = c.height = n;
    const g = c.getContext("2d");
    g.fillStyle = "#000"; g.fillRect(0, 0, n, n);
    g.fillStyle = "#fff"; g.textBaseline = "alphabetic";
    const R = n / 2;
    for (const q of parts) {
      const px = q.cap * R / 0.7;
      g.font = `700 ${px}px ${q.font ?? "C"}`;
      if (q.flat !== undefined) {
        g.textAlign = "center";
        const ls = (q.space ?? 0) * px;
        const chars = [...q.text];
        let total = -ls;
        const w = chars.map((ch) => { const m = g.measureText(ch).width; total += m + ls; return m; });
        let x = R - total / 2;
        g.textAlign = "left";
        const whole = (q.font ?? "C") !== "C";
        if (whole) { g.textAlign = "center"; g.fillText(q.text, R, R + q.flat * R); continue; }
        chars.forEach((ch, i) => { g.fillText(ch, x, R + q.flat * R); x += w[i] + ls; });
        continue;
      }
      const base = q.r * R;
      const clusters = (q.font ?? "C") === "C" ? [...q.text] : [...new Intl.Segmenter("ta", { granularity: "grapheme" }).segment(q.text)].map((s) => s.segment);
      const ls = (q.space ?? 0.06) * px;
      const w = clusters.map((ch) => g.measureText(ch).width + ls);
      // measured on the middle of the letters, where they are spaced by eye
      const mid = q.top ? base + q.cap * R * 0.5 : base - q.cap * R * 0.5;
      const total = w.reduce((a, v) => a + v, 0) / mid;
      let a = -total / 2;
      g.textAlign = "center";
      clusters.forEach((ch, i) => {
        const at = a + w[i] / mid / 2;
        a += w[i] / mid;
        g.save();
        g.translate(R, R);
        if (q.top) { g.rotate(at); g.translate(0, -base); }
        else { g.rotate(-at); g.translate(0, base); }
        g.fillText(ch, 0, 0);
        g.restore();
      });
    }
    return c.toDataURL("image/png");
  };
  await save("coin_a_text.png", coin, { n: 4096, parts: [
    { text: "ANNA UNIVERSITY", top: true, r: 0.745, cap: 0.095, space: 0.16 },
    { text: "GOLD MEDALIST · 2023", top: false, r: 0.842, cap: 0.095, space: 0.12 },
    { text: "1", flat: 0.115, cap: 0.4 },
    { text: "GRAM", flat: 0.25, cap: 0.085, space: 0.2 },
    { text: "FINE GOLD", flat: 0.355, cap: 0.052, space: 0.22 },
  ] });
  await save("coin_b_text.png", coin, { n: 4096, parts: [
    { text: "PANDIAN SAMBATH", top: true, r: 0.745, cap: 0.095, space: 0.14 },
    { text: "17TH UNIVERSITY RANK", top: false, r: 0.842, cap: 0.095, space: 0.1 },
    { text: "கேடில் விழுச்செல்வம் கல்வி", top: true, r: 0.555, cap: 0.066, space: 0.03, font: "T" },
  ] });
  await b.close();
})();
