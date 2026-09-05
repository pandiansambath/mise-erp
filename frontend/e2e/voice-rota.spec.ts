import { expect, test } from "@playwright/test";

/**
 * "I tried but it is not adding rota."
 *
 * Every test I have written so far checked a piece: the fold, the socket count,
 * the field matcher. He keeps telling me the WHOLE THING does not work, and he
 * is the only one who has actually tried it. So this does what he does — speaks
 * a rota instruction, from the dashboard, and follows it all the way to what
 * ends up in the form.
 *
 * It fakes only the microphone and Transcribe. Everything else is the real app
 * talking to the real deployment.
 */

const BASE = "https://nirai1.dineai.cloud";

function installFakes() {
  try {
    localStorage.setItem("mise.tour.done", "1");
  } catch {
    /* ignore */
  }
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
  Object.defineProperty(window, "webkitSpeechRecognition", { value: FakeRec, configurable: true });
  Object.defineProperty(window, "SpeechRecognition", { value: FakeRec, configurable: true });

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
  });
  class FakeCtx {
    sampleRate = 16000;
    destination = {};
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    createScriptProcessor() {
      return { connect() {}, disconnect() {}, set onaudioprocess(_f: unknown) {} };
    }
    close() {}
  }
  Object.defineProperty(window, "AudioContext", { value: FakeCtx, configurable: true });

  const Real = window.WebSocket;
  const sockets: unknown[] = [];
  (window as unknown as { __sockets: unknown[] }).__sockets = sockets;
  class FakeWS extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    binaryType = "arraybuffer";
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: ArrayBuffer }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(url: string) {
      super();
      sockets.push(this);
      setTimeout(() => this.onopen?.(), 10);
      void url;
    }
    send() {}
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
    push(payload: unknown) {
      const body = new TextEncoder().encode(JSON.stringify(payload));
      const total = 16 + body.length;
      const buf = new ArrayBuffer(total);
      const dv = new DataView(buf);
      dv.setUint32(0, total);
      dv.setUint32(4, 0);
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

/** Say something, the way Transcribe actually delivers it. */
async function speak(page: import("@playwright/test").Page, sentence: string) {
  await page.evaluate((text: string) => {
    const socks = (window as unknown as { __sockets: { push: (p: unknown) => void }[] }).__sockets;
    const ws = socks[socks.length - 1];
    const words = text.split(" ");
    // Growing partials, the flag arriving FALSE on every one, exactly as his
    // CloudWatch line showed.
    words.forEach((_, i) => {
      setTimeout(() => {
        ws.push({
          Transcript: {
            Results: [
              {
                ResultId: `r${i}`,
                IsPartial: false,
                Alternatives: [{ Transcript: words.slice(0, i + 1).join(" ") }],
              },
            ],
          },
        });
      }, i * 90);
    });
  }, sentence);
  await page.waitForTimeout(sentence.split(" ").length * 90 + 2600);
}

test("speaking a rota instruction fills the rota form, on the right day", async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(installFakes);
  await page.setViewportSize({ width: 420, height: 900 });
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

  const before = await page.evaluate(() => ({
    sockets: (window as unknown as { __sockets: unknown[] }).__sockets.length,
    live: Boolean(document.querySelector(".mise-voice-live")),
  }));
  console.log("DIAG before speaking:", JSON.stringify(before));

  await speak(page, "add a rota shift for Balaji today from 9 am to 5 pm");

  const after = await page.evaluate(() => {
    return {
      sockets: (window as unknown as { __sockets: unknown[] }).__sockets.length,
      liveTranscript: (document.querySelector(".mise-voice-card")?.textContent || "").slice(0, 120),
      anyText: (document.querySelector(".mise-voice-card")?.textContent || "").slice(0, 200),
    };
  });
  console.log("DIAG after speaking:", JSON.stringify(after));

  // It has to get to the rota, open the form, and fill it. Give it room.
  await page.waitForTimeout(6000);
  const confirm = page.getByRole("button", { name: /yes, fill it in/i });
  await confirm.waitFor({ state: "visible", timeout: 45_000 }).catch(() => {});
  if (await confirm.isVisible()) await confirm.click();
  await page.waitForTimeout(5000);

  const state = await page.evaluate(() => {
    const said = [...document.querySelectorAll(".mise-voice-said")].map((b) =>
      (b.textContent || "").trim(),
    );
    const labelNear = (el: Element) => {
      let n: Element | null = el;
      for (let i = 0; i < 4 && n; i += 1) {
        n = n.parentElement;
        const l = n?.querySelector(":scope > span, :scope > label");
        if (l?.textContent) return l.textContent.trim();
      }
      return "";
    };
    const fields: Record<string, string> = {};
    document.querySelectorAll<HTMLInputElement>("input").forEach((el) => {
      if (el.offsetParent && el.value) fields[labelNear(el) || el.type] = el.value;
    });
    document
      .querySelectorAll<HTMLElement>('button[aria-haspopup="listbox"]')
      .forEach((el) => {
        if (el.offsetParent)
          fields[labelNear(el) || "dropdown"] = (el.textContent || "").replace(/[▾▼]/g, "").trim();
      });
    return { url: location.pathname, turns: said, fields };
  });

  console.log("URL      :", state.url);
  console.log("turns    :", JSON.stringify(state.turns));
  console.log("form     :", JSON.stringify(state.fields, null, 1));
  await page.screenshot({ path: "e2e/__screens__/voice-rota.png", fullPage: false });

  const today = new Date();
  const dayMonth = `${today.getDate()}/${today.getMonth() + 1}`;

  expect(state.turns.length, `it heard ${state.turns.length} sentences, not 1`).toBe(1);
  expect(state.url, "it never reached the rota").toContain("/rota");
  const values = Object.values(state.fields).join(" | ").toLowerCase();
  expect(values, `the day is not today (${dayMonth}) — form was ${values}`).toContain(dayMonth);
  expect(values, "the start time never landed").toMatch(/09:00|9:00/);
});
