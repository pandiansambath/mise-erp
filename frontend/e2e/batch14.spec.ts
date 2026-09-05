// His 2026-08-14 batch, proved on the live site rather than trusted from notes.
//
//   "that button... its not even visible bro"
//   "the text colors are so light that i cant even read thr text clearly"
//   "in vendor section only we need to do this things... having this pack size
//    in inventory need to be paused"
import { test, expect, type Page } from "@playwright/test";

const EMAIL = "superadmin@gmail.com";
const PASSWORD = "superadmin@123";

// There are two [data-testid="login-email"] nodes in the DOM (mobile + desktop shells); filling
// the hidden one waits forever on "element is not enabled".
async function login(page: Page) {
  await page.goto("/login");
  await page.locator('[data-testid="login-email"]:visible').first().fill(EMAIL);
  await page.locator('[data-testid="login-password"]:visible').first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
  await page.reload();
  await page.waitForTimeout(2000);
}

test("1 · the condensed button row is visible, not clipped", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto("/purchasing");
  await page.getByTestId("category-tile").first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(800);

  const rail = page.locator(".mise-bench-rail").first();
  const btn = page.getByRole("button", { name: /New order/i }).first();
  await expect(btn).toBeVisible();
  const before = await btn.boundingBox();

  await page.mouse.move(700, 600);
  for (let i = 0; i < 14; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(800);

  const condensed = await rail.getAttribute("data-condensed");
  const after = await btn.boundingBox();
  const railBox = await rail.boundingBox();
  console.log("condensed:", condensed);
  console.log("button before:", JSON.stringify(before));
  console.log("button after :", JSON.stringify(after));
  console.log("rail box     :", JSON.stringify(railBox));

  expect(condensed, "the rail should condense on scroll").toBe("true");
  // Bug 1: the row is lifted by a transform, and paint containment cut off
  // whatever crossed the rail's top edge.
  expect(after!.y, "clipped above the rail").toBeGreaterThanOrEqual(railBox!.y - 1);
  expect(after!.y + after!.height, "hanging out below the rail").toBeLessThanOrEqual(
    railBox!.y + railBox!.height + 1,
  );
  // Bug 2 — the one he actually saw. The row collapses to 0fr and a stretched
  // child gets squashed into it: the button measured 15px against 36 expanded.
  // It must stay close to full size, only gently scaled.
  expect(after!.height, "squashed — this is the 'not even visible' bug").toBeGreaterThan(30);
  console.log(`shrunk to ${(after!.height / before!.height).toFixed(2)} of full height`);

  // And it should read as sitting ON the title's line.
  const offset = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /new order/i.test(x.textContent ?? ""))!
      .getBoundingClientRect();
    const t = document.querySelector(".mise-bench-title")!.getBoundingClientRect();
    return Math.abs((b.top + b.bottom) / 2 - (t.top + t.bottom) / 2);
  });
  console.log(`off the title's centre line by ${offset.toFixed(1)}px`);
  expect(offset, "not on the title's line").toBeLessThan(12);
});

test("2 · the reading tones exist and go dark on the light theme", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto("/purchasing");
  await page.getByTestId("category-tile").first().waitFor({ timeout: 90_000 });

  const tones = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      mode: document.documentElement.getAttribute("data-mode"),
      info: cs.getPropertyValue("--tone-info").trim(),
      good: cs.getPropertyValue("--tone-good").trim(),
      warn: cs.getPropertyValue("--tone-warn").trim(),
    };
  });
  console.log("tones:", JSON.stringify(tones));
  expect(tones.info, "--tone-info must be defined").not.toBe("");
  expect(tones.good).not.toBe("");
  expect(tones.warn).not.toBe("");

  // The point of the change: on light, these must be DARK ink, not pale.
  const light = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.setAttribute("data-mode", "light");
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const v = {
      info: cs.getPropertyValue("--tone-info").trim(),
      good: cs.getPropertyValue("--tone-good").trim(),
    };
    probe.remove();
    return v;
  });
  console.log("light tones:", JSON.stringify(light));
  expect(light.info.toLowerCase()).toBe("#0369a1");
  expect(light.good.toLowerCase()).toBe("#047857");
});

test("3 · a new inventory item does not ask for pack size", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto("/inventory");
  await page.waitForTimeout(3000);

  const add = page.getByRole("button", { name: /Add an item|New item|Add item/i }).first();
  await add.click();
  await page.waitForTimeout(1200);

  const body = await page.locator("body").innerText();
  const paused = /How it is bought comes later/i.test(body);
  console.log("shows the pause note:", paused);
  expect(body, "the new-item form should point at Vendors, not ask here").toMatch(
    /How it is bought comes later/i,
  );
});
