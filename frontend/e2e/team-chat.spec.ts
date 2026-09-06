import { expect, test } from "@playwright/test";

/**
 * Team chat, checked on the DEPLOYED site.
 *
 * Everything here runs against his live tenant, so it must leave nothing
 * behind. That rules out posting into Everyone — those messages have no delete
 * endpoint and would sit in his staff's room forever. Instead the test makes
 * its OWN group, does all its talking in there, and closes it at the end, which
 * has the happy side effect of exercising create → send → reload → close as one
 * chain rather than four isolated assertions.
 *
 * Every check ends in a screenshot I have to actually look at. "0 messages"
 * reads the same for *the room is empty* and *the list never rendered*, and I
 * have been caught by exactly that before.
 */

const BASE = "https://nirai1.dineai.cloud";
const STAMP = `probe ${Date.now()}`;

type Page = import("@playwright/test").Page;

async function signIn(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("mise.tour.done", "1");
    } catch {
      /* ignore */
    }
  });
  await page.goto(`${BASE}/login`);
  await page
    .locator('[data-testid="login-email"]:visible, #li-email:visible')
    .first()
    .fill("superadmin@gmail.com");
  await page
    .locator('[data-testid="login-password"]:visible, #li-password:visible')
    .first()
    .fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
}

async function openChat(page: Page) {
  await page.goto(`${BASE}/chat`);
  // NOT networkidle: the app holds a realtime stream open, so it never fires.
  await page.waitForLoadState("domcontentloaded");
  await expect
    .poll(async () => page.getByTestId("chat-room").count(), {
      timeout: 60_000,
      message: "the room list never loaded",
    })
    .toBeGreaterThan(0);
}

test("21.1/21.2 — the two standing rooms are there, and named", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await openChat(page);

  const names = await page.getByTestId("chat-room").allInnerTexts();
  expect(names.join(" | ")).toContain("Everyone");
  expect(names.join(" | ")).toContain("Managers");

  await page.screenshot({ path: "e2e-out/chat-rooms.png", fullPage: true });
});

test("21.3/21.4/21.6 — make a group, talk in it, it survives a reload, then close it", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page);
  await openChat(page);

  // ── create, choosing members from the live roster
  await page.getByTestId("new-group").click();
  await page.getByTestId("group-name").fill(STAMP);
  await expect
    .poll(async () => page.getByTestId("member-option").count(), {
      timeout: 30_000,
      message: "the people list never loaded",
    })
    .toBeGreaterThan(0);
  await page.getByTestId("member-option").first().click();
  await page.screenshot({ path: "e2e-out/chat-new-group.png" });
  await page.getByTestId("group-create").click();

  // The new group opens by itself, and is the one we are looking at.
  await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("body")).toContainText(STAMP, { timeout: 30_000 });

  // ── say something, with an emoji picked from the picker
  const line = `hello from the probe ${Date.now()}`;
  await page.getByTestId("chat-input").fill(line);
  await page.getByRole("button", { name: "Emoji" }).click();
  await page.getByRole("button", { name: "🔥", exact: true }).first().click();
  await expect(page.getByTestId("chat-input")).toHaveValue(`${line}🔥`);
  await page.getByTestId("chat-send").click();

  // It lands...
  await expect(page.locator("body")).toContainText(line, { timeout: 30_000 });

  // ...and it is still there after a full reload. That is what "persistent" means.
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.getByTestId("chat-room").filter({ hasText: STAMP }).first().click();
  await expect(page.locator("body")).toContainText(line, { timeout: 30_000 });
  await page.screenshot({ path: "e2e-out/chat-conversation.png", fullPage: true });

  // ── the page itself must not scroll; only the message list moves
  const overflow = await page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  );
  expect(overflow, "the chat page should not scroll as a whole").toBeLessThanOrEqual(2);

  // ── clean up: close the group, so his tenant is exactly as we found it
  await page.getByTestId("room-settings").click();
  await page.getByTestId("group-close").click();
  await page.getByTestId("group-close-confirm").click();
  await expect
    .poll(
      async () =>
        page.getByTestId("chat-room").filter({ hasText: STAMP }).count(),
      { timeout: 30_000, message: "the probe group was not removed" },
    )
    .toBe(0);
  await page.screenshot({ path: "e2e-out/chat-cleaned.png", fullPage: true });
});

test("21.6 — on a phone it is one pane at a time, with a way back", async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();

  await signIn(page);
  await openChat(page);

  // The LIST is the landing screen — no conversation is open over it.
  await expect(page.getByTestId("chat-input")).toBeHidden();
  await page.screenshot({ path: "e2e-out/chat-mobile-list.png", fullPage: true });

  // Tapping a room replaces the list rather than squeezing in beside it.
  await page.getByTestId("chat-room").first().click();
  await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("chat-room").first()).toBeHidden();
  await page.screenshot({ path: "e2e-out/chat-mobile-room.png", fullPage: true });

  // And Back returns to it.
  await page.getByRole("button", { name: "Back to conversations" }).click();
  await expect(page.getByTestId("chat-room").first()).toBeVisible();
  await expect(page.getByTestId("chat-input")).toBeHidden();

  // The composer must be reachable without scrolling the window — a chat whose
  // input sits below the fold is a chat you cannot answer on a phone.
  await page.getByTestId("chat-room").first().click();
  await expect(page.getByTestId("chat-input")).toBeInViewport({ timeout: 30_000 });
  await page.screenshot({ path: "e2e-out/chat-mobile-composer.png", fullPage: true });

  await ctx.close();
});

test("21.7 — the nav offers Team chat to a page that is not chat", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  // The badge and the link live in the shell, so they must be present elsewhere.
  await expect(page.getByRole("link", { name: /Team chat/i }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.screenshot({ path: "e2e-out/chat-nav.png" });
});
