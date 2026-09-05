import { expect, test } from "@playwright/test";

// 🧪 THE TEST HE ASKED FOR, DONE THE WAY HE ASKED.
//
//   "not only this role page... once we give permission to someone, in THEIR
//    account it needs to reflect. That is what a real functionality check is.
//    Create a new login staff and give access to them and check whether you can
//    see that page with that permission in that account. Then remove and add
//    new and check. I need you to act like a MANUAL TESTER in this scenario."
//
// Everything up to now proved the switch moves and the API returns 200. Neither
// is the thing that matters. The thing that matters is what the OTHER person
// sees when they sign in, and the only way to know that is to be them.
//
// So: make a real login, give it one page, sign in AS it, look at the sidebar.
// Then take the page away, sign in again, and look again. Two sign-ins, two
// screenshots, one fact.

const BASE = "https://nirai1.dineai.cloud";
const OWNER = { email: "superadmin@gmail.com", password: "superadmin@123" };

// A throwaway account per run, so a leftover from last time cannot make this
// pass without proving anything.
const STAMP = Date.now().toString().slice(-6);
const SUBJECT = { email: `probe${STAMP}@dineai.cloud`, password: "probe-pass-8891" };

test.setTimeout(300_000);

async function signIn(
  page: import("@playwright/test").Page,
  who: { email: string; password: string },
) {
  await page.goto(`${BASE}/login`);
  // The form renders twice (mobile + desktop copies); :visible or it fills the
  // hidden one and waits forever.
  await page.locator('[data-testid="login-email"]:visible').first().fill(who.email);
  await page.locator('[data-testid="login-password"]:visible').first().fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60_000 });
  await page.evaluate(() => localStorage.setItem("mise.tour.done", "1"));
}

/** Talk to the API as the owner — making the fixtures through the UI would be
 *  testing the UI twice and would not tell us anything more. */
async function asOwner(request: import("@playwright/test").APIRequestContext) {
  const r = await request.post(`${BASE}/api/auth/login`, { data: OWNER });
  const token = (await r.json()).access_token as string;
  return { Authorization: `Bearer ${token}` };
}

test("a page granted to somebody actually appears in THEIR account", async ({
  page,
  request,
}) => {
  const auth = await asOwner(request);

  // 1 · a real login, as plain STAFF (reaches almost nothing by default)
  const made = await request.post(`${BASE}/api/auth/users`, {
    headers: auth,
    data: { email: SUBJECT.email, password: SUBJECT.password, role: "STAFF" },
  });
  expect(made.ok(), await made.text()).toBeTruthy();
  const subjectId = (await made.json()).id as string;

  // 2 · as themselves, before anything is granted: no Inventory.
  await signIn(page, SUBJECT);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "e2e/__screens__/probe-before.png", fullPage: true });
  const before = await page.locator("nav, aside").first().innerText();
  expect(before, "a plain STAFF account should not see Inventory").not.toMatch(/Inventory/i);

  // 3 · the owner grants stock, but ONLY the Inventory screen — not Stock-take,
  //     not Waste. This is 5a: the shortlist inside the permission.
  const granted = await request.put(`${BASE}/api/roles/user/${subjectId}/access`, {
    headers: auth,
    data: {
      base_role: "STAFF",
      overrides: {
        "inventory:read": true,
        "page:inventory": true,
        "page:stock-take": false,
        "page:waste": false,
      },
    },
  });
  expect(granted.ok(), await granted.text()).toBeTruthy();

  // 4 · as themselves again. Inventory is there; the two we withheld are not.
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`);
  await page.evaluate(() => localStorage.clear());
  await signIn(page, SUBJECT);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "e2e/__screens__/probe-granted.png", fullPage: true });

  const nav = page.locator("nav, aside").first();
  await expect(nav.getByText("Inventory", { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  const after = await nav.innerText();
  expect(after, "Stock-take was withheld and must not be shown").not.toMatch(/Stock-take/i);
  expect(after, "Waste was withheld and must not be shown").not.toMatch(/Waste/i);

  // 5 · and the page itself opens, not just the menu item.
  await page.goto(`${BASE}/inventory`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "e2e/__screens__/probe-inventory.png", fullPage: true });
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/don.t have access|not allowed|403/i);

  // 6 · take it away again, and prove it goes.
  const revoked = await request.put(`${BASE}/api/roles/user/${subjectId}/access`, {
    headers: auth,
    data: { base_role: "STAFF", overrides: { "inventory:read": false } },
  });
  expect(revoked.ok(), await revoked.text()).toBeTruthy();

  await page.context().clearCookies();
  await page.goto(`${BASE}/login`);
  await page.evaluate(() => localStorage.clear());
  await signIn(page, SUBJECT);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "e2e/__screens__/probe-revoked.png", fullPage: true });
  const gone = await page.locator("nav, aside").first().innerText();
  expect(gone, "revoking must actually remove it").not.toMatch(/Inventory/i);

  // 7 · clean up after ourselves — this runs against his live restaurant.
  //
  // Deleting the login is not enough: tuning one person's switches creates a
  // CustomRole named "<who> — custom access" underneath, and four of those
  // were left littering his roles list before I noticed. Take the role too.
  await request.delete(`${BASE}/api/auth/users/${subjectId}`, { headers: auth });
  const roles = await (await request.get(`${BASE}/api/roles`, { headers: auth })).json();
  for (const r of roles.roles ?? []) {
    if (r.is_active && r.name.startsWith(`probe${STAMP}`)) {
      await request.delete(`${BASE}/api/roles/${r.id}`, { headers: auth });
    }
  }
});
