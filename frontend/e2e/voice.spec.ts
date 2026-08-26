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

test("the bubble opens in the corner and there is only ONE launcher", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);

  // "why we have 2 bubbles... it feels awkward to look... better combine both."
  // Two floating launchers for one assistant was an artefact of building the
  // voice second, not a design. This is what keeps it at one.
  await expect(
    page.locator(".mise-launcher-in"),
    "the old Ask DineAI pill is still floating alongside the voice",
  ).toHaveCount(0);

  await page.getByRole("button", { name: /talk to dineai/i }).click();
  const card = page.locator(".mise-voice-card").first();
  await expect(card).toBeVisible();

  // The whole point is watching the dashboard while you talk to it, so the
  // panel has to stay small and out of the way.
  const box = await card.boundingBox();
  expect(box, "no card").not.toBeNull();
  const area = (box!.width * box!.height) / (1440 * 900);
  expect(area, `the panel covers ${(area * 100).toFixed(0)}% of the screen`).toBeLessThan(0.3);
  await expect(page.getByRole("heading", { name: /nirai/i }).first()).toBeVisible();
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

test("the chat has room now - the panel and the full page, measured", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);

  // The panel IS the chat now — there is no second launcher to click. Its
  // transcript used to be 160px of flat paragraphs capped at six lines, which
  // is the "very very tight" he meant.
  await page.getByRole("button", { name: /talk to dineai/i }).click();
  await page.getByLabel(/type what you need/i).fill("what did we take today");
  await page.getByRole("button", { name: /^send$/i }).click();

  const log = page.locator(".mise-voice-card .overflow-y-auto").first();
  await expect(log).toBeVisible({ timeout: 25_000 });
  const lbox = (await log.boundingBox())!;
  console.log("conversation area:", JSON.stringify(lbox));
  expect(lbox.height, "the conversation is still a letterbox").toBeGreaterThan(150);

  // The orb has to stand down once there is something to read, or it eats the
  // room it was supposed to be giving up.
  const orb = page.locator(".mise-voice-orb").first();
  const obox = (await orb.boundingBox())!;
  expect(obox.height, "the orb is still full size over a conversation").toBeLessThan(60);
  await page.screenshot({ path: "e2e/__screens__/chat-bubble.png" });

  // The full page. Model/Plan/Questions-left were three full-height tiles
  // above the conversation, so the chat got the band that was left.
  await page.goto(`${BASE}/ai-scan`);
  const column = page.locator(".mise-page-grow").first();
  await expect(column).toBeVisible({ timeout: 20_000 });
  const cbox = (await column.boundingBox())!;
  const thread = page.locator(".mise-chat-log").first();
  const tbox = (await thread.boundingBox())!;
  console.log("full page column:", JSON.stringify(cbox), "thread:", JSON.stringify(tbox));
  expect(cbox.width, "a 48rem corridor on a wide screen").toBeGreaterThan(900);
  expect(
    tbox.height / cbox.height,
    "the header is still eating the page the conversation is for",
  ).toBeGreaterThan(0.6);
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


test("the card cannot scroll sideways, so its text cannot walk off the edge", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.getByRole("button", { name: /talk to dineai/i }).click();
  // Opening the voice list is what triggered it: focusing a button inside made
  // the browser scroll the card to reveal it. The aurora sat at inset:-40%, so
  // `overflow:hidden` had given the card 146px of scrollable area on each side
  // — and every row shunted 68px left, clean off the edge. His screenshot read
  // "nna", "phen", "l Voice". Nothing threw and every other assertion passed.
  await page.getByRole("button", { name: /choose a voice/i }).click();
  await page.waitForTimeout(500);

  const geom = await page.evaluate(() => {
    const card = document.querySelector(".mise-voice-card") as HTMLElement;
    const cb = card.getBoundingClientRect();
    const rows = [...card.querySelectorAll("button, p")]
      .map((el) => el.getBoundingClientRect())
      .filter((b) => b.width > 0);
    return {
      scrollLeft: card.scrollLeft,
      scrollWidth: card.scrollWidth,
      clientWidth: card.clientWidth,
      worstSpill: Math.max(0, ...rows.map((b) => cb.left - b.left)),
    };
  });
  console.log("card geometry:", JSON.stringify(geom));

  expect(geom.scrollLeft, "the card scrolled its own contents out of view").toBe(0);
  expect(
    geom.scrollWidth,
    "the card has a scrollable area it should not have — something inside overhangs it",
  ).toBeLessThanOrEqual(geom.clientWidth + 1);
  expect(geom.worstSpill, "text is hanging off the left edge of the card").toBeLessThan(2);
});

test("the card is a surface, not a tint", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.getByRole("button", { name: /talk to dineai/i }).click();

  // It was 94% opaque leaning on a backdrop blur that was reporting `none`, so
  // the dashboard read straight through it. A panel floating over live data has
  // to be readable without the page competing for the same pixels.
  const bg = await page.evaluate(() => {
    const card = document.querySelector(".mise-voice-card") as HTMLElement;
    const c = getComputedStyle(card).backgroundColor;
    const m = c.match(/[\d.]+/g)?.map(Number) ?? [];
    // rgb() is opaque; rgba()/color() carry a 4th value.
    return { raw: c, alpha: m.length >= 4 ? m[3] : 1 };
  });
  console.log("card background:", JSON.stringify(bg));
  expect(bg.alpha, `card background ${bg.raw} lets the page through`).toBeGreaterThanOrEqual(0.99);
});


test("hands free: it opens Sales and types the number into the real form", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);

  // This is the sentence the whole feature was asked for:
  // "when I say 'hey could you please add this sales into sales page' it needs
  //  to navigate to that sales page in realtime and enter the sale value."
  //
  // Correct ACTIONS coming back over the wire is not the same as the number
  // landing in the box — the field matcher has to find a real input by the
  // plainest name a person would use, on a page it has never seen.
  await page.getByRole("button", { name: /talk to dineai/i }).click();
  await page.getByLabel(/type what you need/i).fill("add a 120 pound cash sale into the sales page");
  await page.getByRole("button", { name: /^send$/i }).click();

  // It must actually go there.
  await page.waitForURL("**/sales", { timeout: 45_000 });

  // Then either it fills, or it asks first — both are correct, and which one
  // depends on his confirm setting. Money defaults to asking.
  // isVisible() does NOT wait — it answers about this instant, and the reply
  // takes several seconds. Asking it immediately said "no dialog" and the test
  // sailed past the very step it existed to exercise.
  const confirm = page.getByRole("button", { name: /yes, fill it in/i });
  await confirm.waitFor({ state: "visible", timeout: 45_000 }).catch(() => {});
  if (await confirm.isVisible()) await confirm.click();

  // The number has to be IN a field, not merely mentioned in the reply.
  const landed = await page.waitForFunction(
    () => {
      const inputs = [...document.querySelectorAll("input")];
      return inputs.some((el) => el.offsetParent !== null && el.value.replace(/[^\d.]/g, "") === "120");
    },
    undefined,
    { timeout: 25_000 },
  ).catch(() => null);

  // The METHOD matters as much as the number. He said cash; a <select> only
  // accepts a value that is one of its options, so assigning "cash" to a
  // dropdown of CARD/CASH did nothing and it stayed on CARD. The reply still
  // said "cash". Silently recording a card sale is worse than recording none.
  // The Method control is NOT a <select> — it is one of our own components, a
  // button that opens a portaled listbox. An earlier version of this test only
  // queried <select> and therefore could not see the very control it existed to
  // check: it reported null and I read that as a failure of the fix.
  const method = await page.evaluate(() => {
    const labelNear = (el: HTMLElement) => {
      let node: HTMLElement | null = el;
      for (let i = 0; i < 4 && node; i += 1) {
        node = node.parentElement;
        const lab = node?.querySelector(":scope > label");
        if (lab?.textContent) return lab.textContent.toLowerCase();
      }
      return (el.getAttribute("aria-label") || "").toLowerCase();
    };
    const native = [...document.querySelectorAll("select")].find((el) =>
      labelNear(el as HTMLElement).includes("method"),
    ) as HTMLSelectElement | undefined;
    if (native) return (native.options[native.selectedIndex]?.textContent || native.value).trim();

    const custom = [...document.querySelectorAll<HTMLElement>('button[aria-haspopup="listbox"]')]
      .filter((el) => el.offsetParent !== null)
      .find((el) => labelNear(el).includes("method"));
    return custom ? (custom.textContent || "").replace(/[▾▼]/g, "").trim() : null;
  });
  console.log("method control reads:", method);

  await page.screenshot({ path: "e2e/__screens__/voice-hands-free.png" });
  expect(landed, "it navigated and talked about the sale but never typed the 120").toBeTruthy();
  expect(
    (method ?? "").toLowerCase(),
    `it said cash and left the method on "${method}"`,
  ).toContain("cash");
});
