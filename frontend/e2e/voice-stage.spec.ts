import { expect, test } from "@playwright/test";

/**
 * The stage, the wake word, and the panel that never closed.
 *
 * Driven through a fake Chrome recogniser, because the real one needs a human
 * and a microphone. Everything between the fake and the screen is the shipping
 * code.
 */

const BASE = "https://nirai1.dineai.cloud";

function fakeEar() {
  try { localStorage.setItem("mise.tour.done", "1"); } catch { /* */ }
  type Alt = { transcript: string };
  type Res = { isFinal: boolean; 0: Alt; length: number };
  class FakeRec {
    lang = ""; interimResults = false; continuous = false;
    onresult: ((e: { results: unknown; resultIndex: number }) => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    private bank: Res[] = [];
    start() { (window as unknown as { __ear: FakeRec }).__ear = this; }
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
    emit(index: number, text: string, isFinal: boolean) {
      this.bank[index] = { isFinal, 0: { transcript: text }, length: 1 } as Res;
      const results = Object.assign([...this.bank], { length: this.bank.length });
      this.onresult?.({ results, resultIndex: index });
    }
  }
  const C = FakeRec as unknown as new () => unknown;
  Object.defineProperty(window, "webkitSpeechRecognition", { value: C, configurable: true });
  Object.defineProperty(window, "SpeechRecognition", { value: C, configurable: true });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
  });
}

async function open(page: import("@playwright/test").Page) {
  await page.addInitScript(fakeEar);
  await page.goto(`${BASE}/login`);
  await page.locator('[data-testid="login-email"]:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.getByRole("button", { name: /talk to dineai/i }).click();
  await page.getByRole("button", { name: /new chat/i }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /start listening/i }).click();
  await page.waitForTimeout(1800);
}

test("the orb goes on stage while it is just listening", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page);

  const stage = await page.evaluate(() => {
    const el = document.querySelector(".mise-voice");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      staged: el.hasAttribute("data-staged"),
      top: Math.round(r.top),
      centreOffset: Math.round(Math.abs(r.left + r.width / 2 - window.innerWidth / 2)),
      conversationHidden: !document.querySelector(
        ".mise-voice-hide-on-stage > *",
      )
        ? true
        : getComputedStyle(
            document.querySelector(".mise-voice-hide-on-stage") as Element,
          ).display === "none",
    };
  });
  console.log("stage:", JSON.stringify(stage));
  await page.screenshot({ path: "e2e/__screens__/voice-stage.png" });

  expect(stage, "the voice panel is not on the page").not.toBeNull();
  expect(stage!.staged, "it did not go on stage while listening").toBe(true);
  // Top of the screen, horizontally centred.
  expect(stage!.top, `it sits at ${stage!.top}px, not near the top`).toBeLessThan(120);
  expect(
    stage!.centreOffset,
    `it is ${stage!.centreOffset}px off centre`,
  ).toBeLessThan(40);
});

test("the rings are drawn, and only while it is awake", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page);
  const rings = await page.evaluate(
    () => document.querySelectorAll(".mise-voice-rings i").length,
  );
  console.log("rings drawn:", rings);
  expect(rings, "no JARVIS rings").toBe(4);
});
