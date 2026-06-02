// Probe: click "Use" on a Gym template → confirm it clones, switches to
// Mine, and loads. Also check the Users icon badge on shared templates.

import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
page.on("response", (r) => {
  if (r.url().includes("/api/") && r.status() >= 400 && !r.url().includes("/auth/")) {
    errs.push(`HTTP ${r.status()} ${r.url()}`);
  }
});

await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await page.fill('input[type="email"], input[name="email"]', "sarah.dorich@gmail.com");
await page.fill('input[type="password"], input[name="password"]', "verify-pw-temp-9281");
await page.getByRole("button", { name: /Sign In/i }).click();
await page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 15000 });

await page.goto("http://localhost:3000/hyrox/race-tools?tab=timer", {
  waitUntil: "networkidle",
});
await page.waitForTimeout(1200);

// Switch to Gym tab.
await page
  .locator("[data-slot='tabs-trigger']")
  .filter({ hasText: /Gym/ })
  .first()
  .click();
await page.waitForTimeout(500);

const beforeMine = await page.evaluate(() => {
  // count Mine pills by toggling
  return null;
});

// Click "Use" on Brian's template.
const useBtn = page
  .locator("button")
  .filter({ hasText: /Brian Doubles Pro/ })
  .first();
await useBtn.click();
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/timer-04-after-clone.png", fullPage: true });

const afterState = await page.evaluate(() => {
  // What tab is active?
  const activeTrigger = [
    ...document.querySelectorAll("[data-slot='tabs-trigger']"),
  ].find((el) => el.getAttribute("data-active") === "" || el.dataset.active === "");
  const activePanel = [
    ...document.querySelectorAll("[data-slot='tabs-content']"),
  ].find((el) => !el.hidden && !el.hasAttribute("hidden"));
  return {
    activeTab: activeTrigger?.textContent?.trim(),
    panelText: activePanel?.innerText?.slice(0, 600),
    minePillCount: document.querySelectorAll(
      "[data-slot='tabs-content'] [class*='rounded-full']",
    ).length,
    pillsWithIcons: [
      ...document.querySelectorAll("[data-slot='tabs-content'] [class*='rounded-full']"),
    ]
      .map((el) => ({
        text: el.textContent?.trim(),
        hasSvg: !!el.querySelector("svg"),
      }))
      .slice(0, 10),
  };
});
console.log("--- AFTER CLONE:");
console.log(JSON.stringify(afterState, null, 2));

// Verify toast (sonner renders to portal).
const toastText = await page.evaluate(() => {
  return [...document.querySelectorAll("[data-sonner-toast], [class*='toast']")]
    .map((el) => el.textContent?.trim())
    .filter(Boolean)
    .join(" | ");
});
console.log("--- TOAST:", toastText);

// Try to delete a template — verify existing flow still works.
const xBtn = page.locator("button[aria-label^='Delete template']").first();
if (await xBtn.isVisible().catch(() => false)) {
  const labelBefore = await xBtn.getAttribute("aria-label");
  console.log("--- DELETE TARGET:", labelBefore);
  await xBtn.click();
  await page.waitForTimeout(800);
  const labelAfter = await page
    .locator("button[aria-label^='Delete template']")
    .first()
    .getAttribute("aria-label")
    .catch(() => null);
  console.log("--- AFTER DELETE FIRST PILL aria-label:", labelAfter);
}

console.log("--- ERRORS:");
console.log(errs.length === 0 ? "(none)" : errs.join("\n"));

await browser.close();
