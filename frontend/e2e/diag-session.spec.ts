import { test } from "@playwright/test";
const BASE = "https://nirai1.dineai.cloud";
test("when does the session drop", async ({ page }) => {
  test.setTimeout(300_000);
  page.on("response", (r) => {
    if (r.status() === 401 || r.status() === 403) console.log("AUTH FAIL:", r.status(), r.url().slice(0, 90));
  });
  await page.addInitScript(() => { try { localStorage.setItem("mise.tour.done","1"); } catch {} });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/login`);
  await page.locator("#li-email:visible").first().fill("superadmin@gmail.com");
  await page.locator("#li-password:visible").first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });

  const tok = async () => page.evaluate(() => {
    const keys = Object.keys(localStorage);
    const k = keys.find((x) => /token|auth|jwt|mise/i.test(x) && (localStorage.getItem(x) || "").length > 40);
    const v = k ? localStorage.getItem(k) || "" : "";
    let exp = "";
    try {
      const p = JSON.parse(atob(v.split(".")[1] || ""));
      exp = p.exp ? new Date(p.exp * 1000).toISOString() : "";
    } catch { /* not a jwt */ }
    return { keys: keys.slice(0, 8), tokenKey: k || "(none)", len: v.length, exp };
  });
  console.log("after login:", JSON.stringify(await tok()));

  for (const p of ["/inventory", "/purchasing", "/vendors", "/sales"]) {
    await page.goto(`${BASE}${p}`);
    await page.waitForTimeout(2500);
    const where = await page.evaluate(() => location.pathname);
    const t = await tok();
    console.log(`${p} -> ${where} | tokenLen=${t.len} exp=${t.exp}`);
    if (where.includes("login")) break;
  }
});
