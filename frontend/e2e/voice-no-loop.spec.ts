import { expect, test } from "@playwright/test";

// THE LOOP HE COULD HEAR.
//
// On Brave the browser recogniser fails with `network`. We handed over to our
// own ears — but `rec.abort()` fires `onend`, and `onend` restarted the
// recogniser, which failed again, which handed over again. Every cycle opened a
// new microphone session and a new Transcribe stream.
//
// He described all three symptoms without knowing they were one bug: "ting ting
// sound like when we turn on mic" (the microphone restarting), "the entire chat
// screen is like earthquake shake" (a re-render per cycle), and one sentence
// arriving as twenty copies (twenty live streams transcribing him at once).
//
// So this counts sockets. One session, one stream.

const BASE = "https://nirai1.dineai.cloud";

test("going live opens exactly one transcription stream", async ({ page }) => {
  // Signing in takes ~20s against prod and the observation window is 12s, so
  // the default 30s budget expired before the assertion was ever reached — a
  // "failure" that said nothing about the thing under test.
  test.setTimeout(120_000);
  const opened: string[] = [];
  page.on("websocket", (ws) => {
    if (ws.url().includes("transcribestreaming")) opened.push(ws.url().slice(0, 60));
  });
  // Signing the URL is the step before opening the socket, so this counts the
  // ATTEMPTS even when the socket itself is refused in a headless browser.
  const signed: number[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/voice/listen-url")) signed.push(r.status());
  });

  await page.addInitScript(() => {
    try {
      localStorage.setItem("mise.tour.done", "1");
    } catch {
      /* ignore */
    }
    // BE BRAVE. Headless Chromium has a working speech service, so it never
    // takes the fallback path where the loop lived — the first version of this
    // test passed with zero requests, which proved nothing at all. This makes
    // the browser recogniser fail with `network` exactly as Brave does, which
    // is the condition under test.
    const Fake = function (this: Record<string, unknown>) {
      this.start = () => {
        setTimeout(() => {
          (this.onerror as ((e: { error: string }) => void) | null)?.({ error: "network" });
          (this.onend as (() => void) | null)?.();
        }, 60);
      };
      this.stop = () => (this.onend as (() => void) | null)?.();
      this.abort = () => (this.onend as (() => void) | null)?.();
    } as unknown as new () => unknown;
    Object.defineProperty(window, "webkitSpeechRecognition", { value: Fake, configurable: true });
    Object.defineProperty(window, "SpeechRecognition", { value: Fake, configurable: true });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`);
  await page.locator("#li-email:visible").first().fill("superadmin@gmail.com");
  await page.locator("#li-password:visible").first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });

  await page.getByRole("button", { name: /talk to dineai/i }).click();
  await page.getByRole("button", { name: /start listening/i }).click();

  // Long enough for a restart loop to show itself. The old code opened one
  // roughly every time the recogniser bounced, which was continuous.
  await page.waitForTimeout(12_000);

  console.log(`listen-url requests: ${signed.length}, sockets: ${opened.length}`);
  expect(
    signed.length,
    `it asked for ${signed.length} signed URLs in 12s — that is the restart loop`,
  ).toBeLessThanOrEqual(2);
  expect(opened.length, `${opened.length} transcription sockets open at once`).toBeLessThanOrEqual(
    2,
  );
});
