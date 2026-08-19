import { chromium } from 'playwright';
const B = 'http://localhost:3111';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
await page.goto(`${B}/login`);
await page.fill('#email', 'admin@frese-wohnung.local');
await page.fill('#password', 'demo-admin-pw-2026');
await page.click('button[type=submit]');
await page.waitForTimeout(2500);
console.log('nach login:', page.url());

await page.goto(`${B}/einstellungen`);
await page.waitForTimeout(1500);
// Erweiterte Einstellungen aufklappen
for (const d of await page.locator('details').all()) {
  await d.evaluate((e) => (e.open = true));
}
await page.waitForTimeout(500);
const boxes = await page.locator('input[name^="feature:"], .feature-row').count();
console.log('feature-Zeilen:', boxes);
const labels = await page.locator('.feature-row strong, .feature-row label').allTextContents();
console.log(labels.slice(0, 20));
await page.screenshot({ path: 'shot-einstellungen.png', fullPage: true });
await browser.close();
