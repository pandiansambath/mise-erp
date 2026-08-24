import { expect, test } from "@playwright/test";

// 🎙️ THE VOICE, AND THE CHAT THAT WAS TOO TIGHT.
//
// Two things this file refuses to accept as proof:
//
//   * that an endpoint returned 200. Every AI bug we have found returned 200
//     with a fluent wrong answer, so /voice/speak is checked for MP3 BYTES and
//     /voice/turn is checked for the ACTION it was supposed to decide on.
//   * that an element exists. "Very very tight" is a measurement, so the panel
//     and the page are measured, not eyeballed.
//
// What it cannot test: actual speech. Headless Chromium has no microphone, so
// the Web Speech API never fires. The hearing is the one link verified by hand.

const BASE = "https://nirai1.dineai.cloud";
const EMAIL = "superadmin@gmail.com";
const PASSWORD = "superadmin@123";

test.setTimeout(240_000);

async function signIn(page: import("@playwright/test").Page) {
  // The guided tour is a bottom sheet at z-70 and it EATS clicks aimed at the
  // floating launchers. Setting the flag after the dashboard paints is too
  // late - the sheet is already up. Plant it before the app ever loads.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mise.tour.done", "1");
    } catch {
      /* ignore */
    }
  });
  await page.goto(`${BASE}/login`);
  await page.locator("#li-email:visible").first().fill(EMAIL);
  await page.locator("#li-password:visible").first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
}

/** Call the API as the signed-in user, from inside the page. */
async function apiPost(page: import("@playwright/test").Page, path: string, body: unknown) {
  return page.evaluate(
    async ([p, b]) => {
      const token = sessionStorage.getItem("mise_token") ?? localStorage.getItem("mise_token");
      const res = await fetch(`/api${p}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(b),
      });
      const type = res.headers.get("content-type") ?? "";
      if (type.includes("audio")) {
        const buf = new Uint8Array(await res.arrayBuffer());
        return { status: res.status, audio: true, bytes: buf.length, head: [...buf.slice(0, 3)] };
      }
      return { status: res.status, audio: false, body: await res.text() };
    },
    [path, body] as const,
  );
}

test("the voice actually speaks - real MP3 bytes off the box", async ({ page }) => {
  await signIn(page);

  const out = await apiPost(page, "/assistant/voice/speak", {
    text: "We took twelve hundred pounds today. Not bad for a Tuesday.",
    voice: "Amy",
  });
  console.log("speak:", JSON.stringify(out).slice(0, 200));

  expect(out.status, "Polly must answer - this is the IAM role on the box").toBe(200);
  expect(out.audio, "must come back as audio/mpeg, not a JSON error").toBe(true);
  // An MP3 opens with an ID3 tag or a frame sync. A 200 holding an HTML error
  // page would sail past a length check, so check what the bytes SAY.
  const head = out.head as number[];
  const isMp3 = (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) || head[0] === 0xff;
  expect(isMp3, `first bytes were ${head} - not an MP3`).toBe(true);
  expect(out.bytes as number).toBeGreaterThan(4000);
});

test("six voices, three of each, as he asked", async ({ page }) => {
  await signIn(page);
  const list = await page.evaluate(async () => {
    const token = sessionStorage.getItem("mise_token") ?? localStorage.getItem("mise_token");
    const res = await fetch("/api/assistant/voice/voices", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return res.json();
  });
  const voices = list.voices as { id: string; sex: string }[];
  console.log("voices:", voices.map((v) => `${v.id}/${v.sex}`).join(" "));
  expect(voices).toHaveLength(6);
  expect(voices.filter((v) => v.sex === "male")).toHaveLength(3);
  expect(voices.filter((v) => v.sex === "female")).toHaveLength(3);
});

test("take me to sales comes back as a navigate action", async ({ page }) => {
  await signIn(page);
  const out = await apiPost(page, "/assistant/voice/turn", {
    text: "take me to the sales page please",
    history: [],
    route: "/dashboard",
  });
  console.log("turn:", (out.body as string)?.slice(0, 400));
  expect(out.status).toBe(200);
  const data = JSON.parse(out.body as string);

  // The whole feature is this line. Not "did it reply" - did it DECIDE.
  const nav = (data.actions ?? []).find((a: { kind: string }) => a.kind === "navigate");
  expect(nav, `no navigate action in ${JSON.stringify(data.actions)}`).toBeTruthy();
  expect(nav.page).toContain("sales");

  // And it must sound like a person, not a document.
  expect(data.spoken).not.toMatch(/[*_#|]/);
  expect(data.spoken.length, "a spoken reply is two or three sentences").toBeLessThan(400);
});

test("the bubble opens in the corner and the page stays visible", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);

  const launcher = page.getByRole("button", { name: /talk to dineai/i });
  await expect(launcher).toBeVisible({ timeout: 20_000 });
  await launcher.click();

  const card = page.locator(".mise-voice-card").first();
  await expect(card).toBeVisible();

  // "it needs to open as a popup small bubble in the corner so that I can see
  //  the dashboard pages" - so it must be small, and it must be in the corner.
  const box = (await card.boundingBox())!;
  console.log("bubble box:", JSON.stringify(box));
  expect(box.width, "a corner bubble, not a panel").toBeLessThan(420);
  expect(box.x + box.width, "hugs the right edge").toBeGreaterThan(1440 - 60);
  // Low, but deliberately NOT flush: it is raised to clear the draggable
  // "Ask DineAI" pill, which is what the overlap check below is really about.
  expect(box.y, "lives in the bottom half").toBeGreaterThan(450);
  expect(box.y + box.height, "still near the bottom").toBeGreaterThan(900 - 160);
  // The share of the screen it covers is the actual complaint being tested.
  const covered = (box.width * box.height) / (1440 * 900);
  expect(covered, `covers ${(covered * 100).toFixed(1)}% of the screen`).toBeLessThan(0.12);

  // The aurora is the UI he asked for by name.
  await expect(page.locator(".mise-aurora").first()).toBeAttached();

  // "the alignment and placement is not nice to see" was two floating things
  // sitting on top of each other. Overlap is a rectangle intersection, so it
  // is checked as one - not squinted at.
  const pill = page.getByRole("button", { name: /ask dineai/i }).first();
  const pillBox = await pill.boundingBox();
  if (pillBox) {
    const clash =
      box.x < pillBox.x + pillBox.width &&
      pillBox.x < box.x + box.width &&
      box.y < pillBox.y + pillBox.height &&
      pillBox.y < box.y + box.height;
    expect(clash, `the voice card is sitting on the Ask DineAI pill: ${JSON.stringify(pillBox)}`).toBe(
      false,
    );
  }

  await page.screenshot({ path: "e2e/__screens__/voice-bubble.png" });
});

test("the voice settings offer 6 voices and his three confirm modes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.getByRole("button", { name: /talk to dineai/i }).click();

  // "no voice choosing thing and all, nothing is there" — it was a 7-pixel
  // gear. It is now a named button, so it is found the way he would find it.
  await page.getByRole("button", { name: /choose a voice/i }).click();
  for (const name of ["Amy", "Joanna", "Kajal", "Brian", "Stephen", "Arthur"]) {
    await expect(page.getByRole("button", { name: new RegExp(name, "i") })).toBeVisible();
  }
  await page.screenshot({ path: "e2e/__screens__/voice-picker.png" });

  // "confirmation before serious actions, configurable." Its own control now.
  await page.getByRole("button", { name: /when to ask me first/i }).click();
  await expect(page.getByRole("button", { name: /ask me every time/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /ask about money/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /just do it/i })).toBeVisible();

  await page.screenshot({ path: "e2e/__screens__/voice-settings.png" });
});

test("the chat is no longer tight - bubble and full page, measured", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);

  // The bubble. It was 400x600 and he called it very very tight.
  await page.getByRole("button", { name: /ask dineai/i }).first().click();
  const panel = page.getByRole("dialog", { name: /copilot/i });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  const pbox = (await panel.boundingBox())!;
  console.log("copilot panel:", JSON.stringify(pbox));
  expect(pbox.width, "was 400").toBeGreaterThanOrEqual(470);
  expect(pbox.height, "was 600").toBeGreaterThanOrEqual(660);
  await page.screenshot({ path: "e2e/__screens__/chat-bubble.png" });

  // The full page. It was max-w-3xl - 48rem on a 1440 screen.
  await page.goto(`${BASE}/ai-scan`);
  const column = page.locator(".mise-page-grow").first();
  await expect(column).toBeVisible({ timeout: 20_000 });
  const cbox = (await column.boundingBox())!;
  console.log("full page column:", JSON.stringify(cbox));
  expect(cbox.width, "a 48rem corridor on a wide screen").toBeGreaterThan(900);
  await page.screenshot({ path: "e2e/__screens__/chat-full-page.png", fullPage: false });
});


test("it glows while it is live, and only while it is live", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.getByRole("button", { name: /talk to dineai/i }).click();

  // "when we are live with voice then it need to glow in aurora kinda color."
  // Idle is the important half of that sentence: a glow that never stops does
  // not mean anything, so it must be ABSENT here.
  await expect(page.locator(".mise-live-glow")).toHaveCount(0);

  // The typed route reaches the same brain and the same states, which is the
  // only way to drive this in a headless browser with no microphone.
  await page.getByLabel(/type what you need/i).fill("what did we take today");
  await page.getByRole("button", { name: /^send$/i }).click();

  const glow = page.locator(".mise-live-glow");
  await expect(glow).toBeVisible({ timeout: 20_000 });
  await expect(glow).toHaveAttribute("data-phase", /thinking|speaking/);
  // It must cover the window and catch nothing — it is light, not a layer.
  const box = (await glow.boundingBox())!;
  expect(box.width).toBeGreaterThan(1400);
  expect(await glow.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  await page.screenshot({ path: "e2e/__screens__/voice-live-glow.png" });
});

test("it offers something to say instead of a silence", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.getByRole("button", { name: /talk to dineai/i }).click();
  // A mic and a blank panel is a guessing game about what it understands.
  await expect(page.getByRole("button", { name: /what did we take today/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /running low/i })).toBeVisible();
});
