import { expect, test } from "@playwright/test";

/**
 * The whole voice pipeline, without a microphone.
 *
 * Every previous test here checked one layer: the fold in isolation, the socket
 * count, the framing bytes. He kept reporting duplication anyway, and each time
 * I fixed a different layer and was wrong. The gap was that nothing exercised
 * the REAL path — browser speech refused, our own ears used, transcripts folded,
 * a turn submitted — end to end.
 *
 * So this fakes the two things a headless browser cannot provide: the
 * microphone, and Transcribe. Everything between them is the shipping code.
 */

const BASE = "https://nirai1.dineai.cloud";

/** Runs in the page, before anything else loads. */
function installFakes() {
  try {
    localStorage.setItem("mise.tour.done", "1");
  } catch {
    /* ignore */
  }

  // 1. BE BRAVE: the browser recogniser exists and always fails with `network`,
  //    which is what pushes us onto our own ears — the path where the bugs are.
  const FakeRec = function (this: Record<string, unknown>) {
    this.start = () => {
      setTimeout(() => {
        (this.onerror as ((e: { error: string }) => void) | null)?.({ error: "network" });
        (this.onend as (() => void) | null)?.();
      }, 40);
    };
    this.stop = () => (this.onend as (() => void) | null)?.();
    this.abort = () => (this.onend as (() => void) | null)?.();
  } as unknown as new () => unknown;
  Object.defineProperty(window, "webkitSpeechRecognition", {
    value: FakeRec,
    configurable: true,
  });
  Object.defineProperty(window, "SpeechRecognition", { value: FakeRec, configurable: true });

  // 2. A microphone that produces silence, and an audio graph that does nothing.
  const fakeTrack = { stop() {} };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [fakeTrack] }) },
  });
  class FakeCtx {
    sampleRate = 16000;
    destination = {};
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    createScriptProcessor() {
      return {
        connect() {},
        disconnect() {},
        set onaudioprocess(_fn: unknown) {
          /* never fires: we push transcripts directly */
        },
      };
    }
    close() {}
  }
  Object.defineProperty(window, "AudioContext", { value: FakeCtx, configurable: true });

  // 3. Transcribe. A fake socket that we can push results into from the test.
  const Real = window.WebSocket;
  const sockets: unknown[] = [];
  (window as unknown as { __sockets: unknown[] }).__sockets = sockets;

  class FakeWS extends EventTarget {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 1;
    binaryType = "arraybuffer";
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: ArrayBuffer }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    sent = 0;

    constructor(url: string) {
      super();
      sockets.push(this);
      setTimeout(() => {
        this.onopen?.();
        this.dispatchEvent(new Event("open"));
      }, 10);
      void url;
    }
    send() {
      this.sent += 1;
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
      this.dispatchEvent(new Event("close"));
    }

    /** Wrap JSON in the AWS event-stream envelope the client decodes. */
    push(payload: unknown) {
      const body = new TextEncoder().encode(JSON.stringify(payload));
      const headerLen = 0;
      const total = 16 + headerLen + body.length;
      const buf = new ArrayBuffer(total);
      const dv = new DataView(buf);
      dv.setUint32(0, total);
      dv.setUint32(4, headerLen);
      new Uint8Array(buf).set(body, 12);
      this.onmessage?.({ data: buf });
    }
  }
  (window as unknown as { WebSocket: unknown }).WebSocket = new Proxy(Real, {
    construct(target, args: [string]) {
      if (String(args[0]).includes("transcribestreaming")) {
        return new (FakeWS as unknown as new (u: string) => object)(args[0]);
      }
      return new (target as unknown as new (...a: unknown[]) => object)(...args);
    },
  });
}

test("one spoken sentence becomes one turn, not twenty", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(installFakes);
  await page.setViewportSize({ width: 420, height: 900 }); // his phone
  await page.goto(`${BASE}/login`);
  await page.locator('[data-testid="login-email"]:visible').first().fill("superadmin@gmail.com");
  await page.locator('[data-testid="login-password"]:visible').first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });

  await page.getByRole("button", { name: /talk to dineai/i }).click();
  await page.getByRole("button", { name: /new chat/i }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /start listening/i }).click();
  await page.waitForTimeout(2500);

  const socketCount = await page.evaluate(
    () => (window as unknown as { __sockets: unknown[] }).__sockets.length,
  );
  console.log("transcription sockets opened:", socketCount);

  // Now speak. Growing partials, exactly as Transcribe sends them — including
  // the flag arriving FALSE on every one, which is what his logs showed.
  await page.evaluate(() => {
    const socks = (window as unknown as { __sockets: { push: (p: unknown) => void }[] }).__sockets;
    const ws = socks[socks.length - 1];
    const growing = [
      "I",
      "I just",
      "I just want",
      "I just want to see",
      "I just want to see the staff list",
    ];
    growing.forEach((t, i) =>
      setTimeout(
        () =>
          ws.push({
            Transcript: {
              Results: [
                { ResultId: `r${i}`, IsPartial: false, Alternatives: [{ Transcript: t }] },
              ],
            },
          }),
        i * 120,
      ),
    );
  });

  // The silence timer submits the turn.
  await page.waitForTimeout(3500);

  const said = await page.evaluate(() => {
    const bubbles = [...document.querySelectorAll(".mise-voice-said")];
    return bubbles.map((b) => (b.textContent || "").trim());
  });
  console.log("user turns on screen:", JSON.stringify(said));

  await page.screenshot({ path: "e2e/__screens__/voice-pipeline.png" });

  expect(socketCount, `${socketCount} sockets for one session`).toBeLessThanOrEqual(2);
  expect(said.length, `it submitted ${said.length} turns for one sentence`).toBe(1);
  expect(said[0]).toBe("I just want to see the staff list");
});
