// The verse in the award room's stone (106.3, 106.4), as masks (white on black), drawn by
// Chromium so Tamil is shaped properly: Thirukkural 400, its first line for the left panel and
// its second for the right, each again in English; both on one band for a tall screen; and the
// smallest of letters under the right one: the whole couplet, and what it says.
// Fonts: Noto Serif Tamil, Cinzel (OFL).   node verse.cjs FOLDER   (FOLDER/fonts/nst700.ttf, cinzel700.ttf)
const { chromium } = require("../../frontend/node_modules/@playwright/test");
const fs = require("fs");
const A = process.argv[2];
const b64 = (f) => fs.readFileSync(A + "/fonts/" + f).toString("base64");
(async () => {
  const b = await chromium.launch({ channel: "chromium" });
  const p = await b.newPage();
  await p.setContent(`<style>
    @font-face{font-family:T;src:url(data:font/ttf;base64,${b64("nst700.ttf")})}
    @font-face{font-family:C;src:url(data:font/ttf;base64,${b64("cinzel700.ttf")})}
  </style><p style="font-family:T">கேடில்</p><p style="font-family:C">A1</p>`);
  await p.evaluate(() => document.fonts.ready);
  const save = async (name, arg) => {
    const url = await p.evaluate((o) => {
      const c = document.createElement("canvas");
      c.width = o.w;
      c.height = o.h;
      const g = c.getContext("2d");
      g.fillStyle = "#000";
      g.fillRect(0, 0, o.w, o.h);
      g.fillStyle = "#fff";
      g.textAlign = "center";
      g.textBaseline = "alphabetic";
      for (const r of o.rows) {
        // y: the line's middle, size: its letters' height, both as shares of the box's height;
        // fit: as wide as this share of the box at the most.
        let px = r.size * o.h;
        const font = () => `700 ${px}px ${r.font}`;
        g.font = font();
        g.letterSpacing = `${(r.space ?? 0) * px}px`;
        const wide = g.measureText(r.text).width;
        if (wide > o.w * (r.fit ?? 0.96)) px *= (o.w * (r.fit ?? 0.96)) / wide;
        g.font = font();
        g.letterSpacing = `${(r.space ?? 0) * px}px`;
        const m = g.measureText(r.text);
        g.fillText(r.text, o.w / 2, r.y * o.h + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
      }
      return c.toDataURL("image/png");
    }, arg);
    fs.writeFileSync(A + "/" + name, Buffer.from(url.split(",")[1], "base64"));
    console.log(name);
  };
  const ta = (text, y, size, more) => ({ text, y, size, font: "T", ...more });
  const en = (text, y, size, more) => ({ text, y, size, font: "C", space: 0.03, ...more });
  const W = 2560, H = 1920;
  await save("v_l_ta.png", { w: W, h: H, rows: [ta("கேடில்", 0.12, 0.175), ta("விழுச்செல்வம்", 0.36, 0.175), ta("கல்வி", 0.59, 0.175), ta("யொருவற்கு", 0.855, 0.175)] });
  await save("v_r_ta.png", { w: W, h: H, rows: [ta("மாடல்ல", 0.13, 0.19), ta("மற்றை", 0.36, 0.19), ta("யவை", 0.58, 0.19), ta("குறள் ௪௦௦", 0.76, 0.082)] });
  await save("v_l_en.png", { w: W, h: H, rows: [en("LEARNING", 0.14, 0.19), en("IS THE WEALTH", 0.37, 0.19), en("THAT NEVER", 0.6, 0.19), en("PERISHES", 0.83, 0.19)] });
  await save("v_r_en.png", { w: W, h: H, rows: [en("NOTHING", 0.15, 0.19), en("ELSE IS", 0.37, 0.19), en("WEALTH", 0.59, 0.19), en("KURAL 400", 0.76, 0.074)] });
  await save("v_b_ta.png", { w: 6144, h: 832, rows: [ta("கேடில் விழுச்செல்வம் கல்வி யொருவற்கு", 0.27, 0.3), ta("மாடல்ல மற்றை யவை", 0.74, 0.3)] });
  await save("v_b_en.png", { w: 6144, h: 832, rows: [en("LEARNING IS THE WEALTH THAT NEVER PERISHES", 0.28, 0.24), en("NOTHING ELSE IS WEALTH", 0.74, 0.24)] });
  // (The smallest: no one sees them who does not look.)
  await save("v_tiny.png", {
    w: 2048,
    h: 420,
    rows: [
      ta("கேடில் விழுச்செல்வம் கல்வி யொருவற்கு", 0.14, 0.15),
      ta("மாடல்ல மற்றை யவை", 0.37, 0.15),
      en("Learning is the one wealth that is never lost;", 0.62, 0.13, { space: 0.01 }),
      en("the other things are no wealth at all.", 0.84, 0.13, { space: 0.01 }),
    ],
  });
  await b.close();
})();
