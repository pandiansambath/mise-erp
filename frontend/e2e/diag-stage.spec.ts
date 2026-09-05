import { test } from "@playwright/test";
const BASE = "https://nirai1.dineai.cloud";
test("why off centre", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    try { localStorage.setItem("mise.tour.done","1"); } catch {}
    const C = function(this: Record<string, unknown>) {
      this.start = () => {}; this.stop = () => {}; this.abort = () => {};
    } as unknown as new () => unknown;
    Object.defineProperty(window,"webkitSpeechRecognition",{value:C,configurable:true});
    Object.defineProperty(navigator,"mediaDevices",{configurable:true,
      value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
  });
  await page.goto(`${BASE}/login`);
  await page.locator('[data-testid="login-email"]:visible, #li-email:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible, #li-password:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.getByRole("button", { name: /talk to dineai/i }).click();
  await page.getByRole("button", { name: /new chat/i }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /start listening/i }).click();
  await page.waitForTimeout(2000);
  const d = await page.evaluate(() => {
    const el = document.querySelector(".mise-voice") as HTMLElement;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      inlineStyle: el.getAttribute("style"),
      left: cs.left, top: cs.top, width: cs.width, transform: cs.transform,
      rectLeft: Math.round(r.left), rectWidth: Math.round(r.width),
      viewport: window.innerWidth,
      staged: el.hasAttribute("data-staged"),
    };
  });
  console.log(JSON.stringify(d, null, 1));
});
