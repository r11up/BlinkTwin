// Screenshots of the demo day for the README and the paper, at twice the CSS pixel density.
//
//   cd web && node scripts/screenshots.mjs            (builds the site first; add --no-build to skip)
//
// Writes docs/img/dashboard.png (README), paper/figures/app_now.png and paper/figures/app_timeline.png
// (paper figure). The demo is a simulated person's day; no real data is involved.

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite, loadPlaywright, startPreview } from './browser-harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCALE = 2;

buildSite();
const { chromium } = loadPlaywright();
const { url, stop } = await startPreview(4192);
const browser = await chromium.launch();
const errors = [];

async function demoPage(width, height = 1000) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: SCALE,
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}?demo=1&study=0`);
  await page.locator('#now-kss').filter({ hasText: /\d/ }).waitFor();
  await page.locator('#kss-chart svg').waitFor();
  await page.waitForTimeout(500);
  // no hover or focus ring in the pictures
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  return { ctx, page };
}

/** Page-coordinate box of the first element matching the selector. */
async function pageBox(page, selector) {
  return page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
  });
}

try {
  mkdirSync(join(ROOT, 'docs/img'), { recursive: true });
  mkdirSync(join(ROOT, 'paper/figures'), { recursive: true });

  // README: the top of the dashboard down to the end of the timeline card, at a laptop width
  {
    const { ctx, page } = await demoPage(1280);
    const timeline = await pageBox(page, '.card.timeline');
    const clip = { x: 0, y: 0, width: 1280, height: Math.ceil(timeline.y + timeline.height + 16) };
    await page.screenshot({ path: join(ROOT, 'docs/img/dashboard.png'), clip, fullPage: true });
    await ctx.close();
  }

  // Paper, left panel: the Now card with its estimate, forecast and attribution. The buttons, the check-in
  // prompt and the reaction-test panel are hidden so the panel fits the figure; the caption says so.
  {
    const { ctx, page } = await demoPage(540);
    await page.addStyleTag({
      content: '.card.now #nudge, .card.now .info-row, .card.now .actions, .card.now #pvt-last, .card.now #objective, .card.now [data-science="pvt"] { display: none !important; }',
    });
    await page.waitForTimeout(200);
    await page.locator('.card.now').screenshot({ path: join(ROOT, 'paper/figures/app_now.png') });
    await ctx.close();
  }

  // Paper, right panel: the sleepiness and workload timelines (the what-if buttons are hidden)
  {
    const { ctx, page } = await demoPage(680);
    await page.addStyleTag({
      content: '.card.timeline .what-if, .card.timeline #scenario-note, .card.timeline [data-science="whatif"] { display: none !important; }',
    });
    await page.waitForTimeout(200);
    await page.locator('.card.timeline').screenshot({ path: join(ROOT, 'paper/figures/app_timeline.png') });
    await ctx.close();
  }
} finally {
  await browser.close();
  stop();
}

if (errors.length) {
  console.error('page errors:', errors);
  process.exit(1);
}
console.log('wrote docs/img/dashboard.png, paper/figures/app_now.png, paper/figures/app_timeline.png');
