import { test } from "@playwright/test";
const BASE = "https://nirai1.dineai.cloud";
test("why the expense did not save", async ({ page }) => {
  test.setTimeout(180_000);
  page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE ERROR:", m.text().slice(0, 160)); });
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message.slice(0, 160)));
  page.on("response", async (r) => {
    if (r.url().includes("/api/expenses") && r.request().method() === "POST") {
      console.log("POST /expenses ->", r.status(), (await r.text().catch(() => "")).slice(0, 200));
    }
  });
  await page.addInitScript(() => { try { localStorage.setItem("mise.tour.done","1"); } catch {} });
  await page.goto(`${BASE}/login`);
  await page.locator("#li-email:visible").first().fill("superadmin@gmail.com");
  await page.locator("#li-password:visible").first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.goto(`${BASE}/expenses`);
  await page.waitForTimeout(5000);

  const state = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll("input")].map((i) => ({
      ph: i.placeholder, label: i.getAttribute("aria-label") || "", type: i.type,
      visible: (i as HTMLElement).offsetParent !== null,
    }));
    const btns = [...document.querySelectorAll("button")]
      .filter((b) => (b as HTMLElement).offsetParent !== null)
      .map((b) => ({ t: (b.textContent || "").trim().slice(0, 24), disabled: (b as HTMLButtonElement).disabled }));
    return { inputs: inputs.filter((i) => i.visible).slice(0, 8), btns: btns.slice(0, 14) };
  });
  console.log("VISIBLE INPUTS:", JSON.stringify(state.inputs));
  console.log("VISIBLE BUTTONS:", JSON.stringify(state.btns));

  await page.locator("input[placeholder='0.00']").first().fill("2.34");
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /add expense/i.test(x.textContent || ""));
    return { found: !!b, disabled: b ? (b as HTMLButtonElement).disabled : null };
  });
  console.log("save button:", JSON.stringify(after));
  const save = page.getByRole("button", { name: /^add expense$/i }).first();
  await save.click();
  await page.waitForTimeout(4000);
  const err = await page.evaluate(() => {
    const el = [...document.querySelectorAll("p,span,div")].find((e) =>
      /could not|error|failed|required/i.test(e.textContent || "") && e.children.length === 0);
    return el ? (el.textContent || "").slice(0, 160) : "(no visible error)";
  });
  console.log("page says:", err);
});
