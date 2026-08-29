import { expect, test } from "@playwright/test";

/**
 * The duplication he reported nine times — driven through the ear he uses.
 *
 * Every `heard=` in his CloudWatch has the same shape: the same sentence stuck
 * to itself with NO separator. "areare you there". "couldcould you please".
 * The Transcribe fold joins with a space and never produced that, which is how
 * I finally worked out it was coming from the OTHER path:
 *
 *     for (let i = 0; i < e.results.length; i += 1)
 *       text += e.results[i][0].transcript;
 *
 * That is `startLive`, the browser recogniser — the one Chrome uses, and the
 * one three previous fixes never touched.
 *
 * This drives THAT handler with a fake Chrome that emits results the way Chrome
 * really does: cumulative, indexed, interim entries firming up in place.
 */

const BASE = "https://nirai1.dineai.cloud";

function fakeChromeEar() {
  try {
    localStorage.setItem("mise.tour.done", "1");
  } catch {
    /* ignore */
  }
  type Alt = { transcript: string };
  type Res = { isFinal: boolean; 0: Alt; length: number };

  class FakeRec {
    lang = "";
    interimResults = false;
    continuous = false;
    onresult: ((e: { results: unknown; resultIndex: number }) => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    /** Chrome keeps every result and grows the live one in place. */
    private bank: Res[] = [];
    start() {
      (window as unknown as { __ear: FakeRec }).__ear = this;
    }
    stop() {
      this.onend?.();
    }
    abort() {
      this.onend?.();
    }
    /** Emit one more state of the stream, exactly as Chrome would. */
    emit(index: number, text: string, isFinal: boolean) {
      this.bank[index] = { isFinal, 0: { transcript: text }, length: 1 } as Res;
      const results = Object.assign([...this.bank], { length: this.bank.length });
      this.onresult?.({ results, resultIndex: index });
    }
  }
  const Ctor = FakeRec as unknown as new () => unknown;
  Object.defineProperty(window, "webkitSpeechRecognition", { value: Ctor, configurable: true });
  Object.defineProperty(window, "SpeechRecognition", { value: Ctor, configurable: true });

  // A microphone that exists but is never actually read by this path.
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
  });
}

test("a sentence that grows in Chrome's ear arrives once, not stuck to itself", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.addInitScript(fakeChromeEar);
  await page.setViewportSize({ width: 420, height: 900 });

  await page.goto(`${BASE}/login`);
  await page.locator("#li-email:visible").first().fill("superadmin@gmail.com");
  await page.locator("#li-password:visible").first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });

  await page.getByRole("button", { name: /talk to dineai/i }).click();
  await page.getByRole("button", { name: /new chat/i }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /start listening/i }).click();
  await page.waitForTimeout(1500);

  // Chrome's real behaviour: index 0 firms up and CLOSES, then index 1 carries
  // the rest of the same sentence. That is what produced "areare you there".
  await page.evaluate(() => {
    const ear = (window as unknown as { __ear?: { emit: (i: number, t: string, f: boolean) => void } })
      .__ear;
    if (!ear) throw new Error("the page never started the browser recogniser");
    ear.emit(0, "could", false);
    ear.emit(0, "could you", false);
    ear.emit(0, "could you please", true);
    ear.emit(1, "could you please add", false);
    ear.emit(1, "could you please add a rota", false);
  });
  await page.waitForTimeout(350);

  // Read the transcript WHILE it is still on screen. An earlier version waited
  // long enough for the silence timer to submit the turn and clear the line,
  // then reported "nothing was transcribed" — a real fix, failed by the clock.
  // Both places are checked, so whichever side of the submit we land on, the
  // words themselves are what gets asserted.
  const shown = await page.evaluate(() => {
    const panel = (document.querySelector(".mise-voice-card")?.textContent || "").trim();
    const quoted = panel.match(/[“”"]([^“”"]+)[“”"]/);
    const said = [...document.querySelectorAll(".mise-voice-said")]
      .map((b) => (b.textContent || "").trim())
      .filter(Boolean);
    return { live: quoted ? quoted[1] : "", said, panel: panel.slice(0, 240) };
  });
  console.log("live transcript:", JSON.stringify(shown.live));
  console.log("submitted turns:", JSON.stringify(shown.said));
  await page.screenshot({ path: "e2e/__screens__/chrome-ear.png" });

  const heard = [shown.live, ...shown.said].filter(Boolean);
  expect(heard.length, `nothing was transcribed — panel was ${shown.panel}`).toBeGreaterThan(0);

  for (const line of heard) {
    // The exact fault from his logs. It joins the END of one copy to the START
    // of the next, so a pattern built from a doubled first word cannot see it —
    // which is how an earlier version of this test passed while its own output
    // showed "could you pleasecould you please add a rota" on screen.
    expect(line, `the sentence came through doubled: ${JSON.stringify(line)}`).toBe(
      "could you please add a rota",
    );
  }
});
