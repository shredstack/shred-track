import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const page = await ctx.newPage();

const errs = [];
page.on("console", (m) => {
  if (m.type() === "error") errs.push(`console: ${m.text()}`);
});
page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
page.on("response", (r) => {
  if (r.url().includes("/api/") && r.status() >= 400 && !r.url().includes("/auth/")) {
    errs.push(`HTTP ${r.status()} ${r.url()}`);
  }
});

// Sign in via the real login form.
await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await page.fill('input[type="email"], input[name="email"]', "sarah.dorich@gmail.com");
await page.fill('input[type="password"], input[name="password"]', "verify-pw-temp-9281");
await page.getByRole("button", { name: /Sign In/i }).click();
await page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 15000 });
console.log("--- signed in, URL:", page.url());

// Navigate to the race timer.
await page.goto("http://localhost:3000/hyrox/race-tools?tab=timer", {
  waitUntil: "networkidle",
});
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/timer-01-loaded.png", fullPage: true });

const tabs = await page.evaluate(() => {
  const triggers = [...document.querySelectorAll("[data-slot='tabs-trigger']")];
  return triggers.map((t) => t.textContent?.trim());
});
console.log("--- TAB TRIGGERS:", JSON.stringify(tabs));

const visibleText = await page.evaluate(() => document.body.innerText.slice(0, 3000));
console.log("--- VISIBLE TEXT (first 3k chars):");
console.log(visibleText);

// Click Gym tab if present.
const gymTab = page.locator("[data-slot='tabs-trigger']").filter({ hasText: /Gym/ }).first();
if (await gymTab.isVisible().catch(() => false)) {
  await gymTab.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/timer-02-gym-tab.png", fullPage: true });

  const gymPanel = await page.evaluate(() => {
    const p = [...document.querySelectorAll("[data-slot='tabs-content']")].find(
      (el) => !el.hidden && el.getAttribute("hidden") === null,
    );
    return p?.innerText;
  });
  console.log("--- GYM TAB CONTENT:");
  console.log(gymPanel);
}

// Switch to Custom mode so Save button is reachable.
const customBtn = page.getByRole("button", { name: /^Custom$/ }).first();
if (await customBtn.isVisible().catch(() => false)) {
  await customBtn.click();
  await page.waitForTimeout(400);
}

// Back to Mine tab, open Save dialog.
const mineTab = page.locator("[data-slot='tabs-trigger']").filter({ hasText: /Mine/ }).first();
await mineTab.click().catch(() => {});
await page.waitForTimeout(300);

const saveBtn = page.getByRole("button", { name: /Save current/ }).first();
if (await saveBtn.isVisible().catch(() => false)) {
  await saveBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/timer-03-save-dialog.png", fullPage: true });
  const dlg = await page.evaluate(
    () => document.querySelector("[role='dialog']")?.innerText,
  );
  console.log("--- SAVE DIALOG:");
  console.log(dlg);
}

console.log("--- ERRORS (excl auth):");
console.log(errs.length === 0 ? "(none)" : errs.join("\n"));

await browser.close();
