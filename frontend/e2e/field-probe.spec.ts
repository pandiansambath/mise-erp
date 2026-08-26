import { test } from "@playwright/test";

const BASE = "https://nirai1.dineai.cloud";

test("what does the page offer for 'method'", async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem("mise.tour.done", "1"); } catch { /* ignore */ }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`);
  await page.locator("#li-email:visible").first().fill("superadmin@gmail.com");
  await page.locator("#li-password:visible").first().fill("superadmin@123");
  await page.getByRole("button", { name: "Sign in" }).filter({ visible: true }).first().click();
  await page.waitForURL("**/dashboard", { timeout: 60_000 });
  await page.goto(`${BASE}/sales`);
  await page.waitForTimeout(3000);

  // Run the component's own algorithm, step by step, and report where it stops.
  const out = await page.evaluate(async () => {
    const steps: string[] = [];
    const labelNear = (el: HTMLElement) => {
      const bits: (string | null | undefined)[] = [
        el.getAttribute("aria-label"), el.getAttribute("name"), el.closest("label")?.textContent,
      ];
      let node: HTMLElement | null = el;
      for (let i = 0; i < 4 && node; i += 1) {
        node = node.parentElement;
        const lab = node?.querySelector(":scope > label");
        if (lab?.textContent) { bits.push(lab.textContent); break; }
      }
      return bits.filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9]/g, "");
    };
    const triggers = [...document.querySelectorAll<HTMLElement>('button[aria-haspopup="listbox"]')]
      .filter((el) => el.offsetParent !== null);
    steps.push(`triggers: ${triggers.length}`);
    const trigger = triggers.find((el) => labelNear(el).includes("method"));
    if (!trigger) return { steps: [...steps, "NO TRIGGER MATCHED"] };
    steps.push(`trigger found, reads "${(trigger.textContent || "").trim()}"`);

    const before = trigger.textContent ?? "";
    trigger.click();
    await new Promise((r) => setTimeout(r, 200));
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    steps.push(`options after click: ${options.length} -> ${options.map((o) => (o.textContent || "").trim()).join("|")}`);
    if (!options.length) return { steps: [...steps, "LISTBOX DID NOT OPEN"] };

    const match = options.find((o) => (o.textContent || "").trim().toLowerCase() === "cash")
      ?? options.find((o) => (o.textContent || "").trim().toLowerCase().includes("cash"));
    if (!match) return { steps: [...steps, "NO CASH OPTION"] };
    steps.push(`matched option "${(match.textContent || "").trim()}"`);
    match.click();
    await new Promise((r) => setTimeout(r, 250));
    const after = trigger.textContent ?? "";
    steps.push(`before="${before.trim()}" after="${after.trim()}" changed=${after !== before}`);
    return { steps };
  });
  console.log("PROBE:", JSON.stringify(out, null, 1));
});
