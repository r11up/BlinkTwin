// Privacy check: does BlinkTwin send anything over the network once it has loaded?
//
// Builds the site, serves it with `vite preview`, and drives it in headless Chromium with a fake camera
// (Chromium's test pattern): camera on for about 2.5 minutes, one check-in, and a 1-minute reaction test
// (which asks for a check-in first). Every request the page or its workers make is recorded. The check
// passes if, after the initial load (the site's own files, the MediaPipe WebAssembly files and the face
// model), there are no further requests and no WebSocket connections at all, if no request body ever
// contains image or video data or landmark-like number arrays, and if what the page stores in the browser
// holds only the documented numeric summaries.
//
// Usage (from web/): node scripts/privacy_check.mjs [--no-build]
// Needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium, or a global install).
// Writes ../results/privacy_check.json and prints one PASS/FAIL line.

import { mkdirSync, writeFileSync } from 'node:fs';
import { buildSite, FAKE_CAMERA_ARGS, fetchModel, loadPlaywright, sleep, startPreview } from './browser-harness.mjs';

const OUT = '../results/privacy_check.json';
const CAMERA_SECONDS = 150;

const modelLocal = fetchModel();
buildSite();
const server = await startPreview(4173);
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ args: FAKE_CAMERA_ARGS });
const browserVersion = browser.version();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['camera'] });
const page = await context.newPage();

const requests = [];
const sockets = [];
let phase = 'load';
const started = Date.now();

/** Flags a request body that looks like an image, a video or an array of landmark coordinates. */
function inspectBody(buf) {
  if (!buf || !buf.length) return null;
  const head = buf.subarray(0, 16);
  if (head[0] === 0xff && head[1] === 0xd8) return 'JPEG data';
  if (head.subarray(1, 4).toString() === 'PNG') return 'PNG data';
  if (head.subarray(0, 4).toString() === 'RIFF' || head.subarray(4, 8).toString() === 'ftyp') return 'video or WebP data';
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'WebM data';
  const text = buf.toString('utf8');
  if (/data:(image|video)\//.test(text)) return 'data URL with an image or video';
  if (/\[\s*-?\d+(\.\d+)?(\s*,\s*-?\d+(\.\d+)?){99,}/.test(text)) return 'array of 100 or more numbers (landmark-like)';
  return null;
}

page.on('request', (req) => {
  const body = req.postDataBuffer();
  const url = new URL(req.url());
  requests.push({
    t_s: (Date.now() - started) / 1000,
    phase,
    method: req.method(),
    type: req.resourceType(),
    host: url.protocol === 'data:' || url.protocol === 'blob:' ? url.protocol : url.host,
    path: url.protocol === 'data:' ? '(data URL)' : url.pathname,
    bodyBytes: body ? body.length : 0,
    bodyFlag: inspectBody(body),
    bodyHexPrefix: body && body.length ? body.subarray(0, 48).toString('hex') : '',
    received: 0,
    outcome: 'pending', // finished | blocked (by the page's Content-Security-Policy, never sent) | failed
    failure: '',
    req,
  });
});
page.on('requestfailed', (req) => {
  const r = requests.find((x) => x.req === req);
  if (!r) return;
  r.failure = req.failure()?.errorText ?? '';
  r.outcome = /BLOCKED_BY_CSP|csp/i.test(r.failure) ? 'blocked' : 'failed';
});
page.on('requestfinished', async (req) => {
  const r = requests.find((x) => x.req === req);
  if (!r) return;
  r.outcome = 'finished';
  try {
    const s = await req.sizes();
    r.received = s.responseBodySize + s.responseHeadersSize;
  } catch {
    /* sizes unavailable for this request */
  }
});
page.on('websocket', (ws) => sockets.push({ t_s: (Date.now() - started) / 1000, url: ws.url() }));
const consoleErrors = [];
const cspViolations = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));
page.on('console', (m) => {
  if (/Content Security Policy/i.test(m.text())) cspViolations.push({ t_s: (Date.now() - started) / 1000, phase, message: m.text().slice(0, 200) });
});

// 1. initial load: open the site, start the camera, wait for the face model to run and the network to settle
await page.goto(server.url, { waitUntil: 'networkidle' });
await page.click('#cam-toggle');
await page.waitForFunction(() => document.querySelector('#cam-stop') && !document.querySelector('#cam-stop').disabled, null, { timeout: 120_000 });
await page.waitForFunction(() => (document.querySelector('#head-live')?.textContent ?? '').length > 0, null, { timeout: 60_000 });
await page.waitForLoadState('networkidle');
await sleep(2000);
phase = 'after-load';
const cameraOn = Date.now();

// 2. use the app: a check-in, then a 1-minute reaction test (rated first), with the camera running throughout
await sleep(20_000);
await page.click('#btn-checkin');
await page.click('.kss-option >> nth=4');
await page.click('button[value="ok"]');
await sleep(10_000);
await page.check('#pvt-quick');
await page.click('#btn-pvt');
await page.click('.kss-option >> nth=5');
await page.click('button[value="ok"]');
await page.click('.pvt-go');
const pvtStart = Date.now();
while (Date.now() - pvtStart < 70_000) {
  if (await page.isVisible('.pvt-result')) break;
  if (await page.isVisible('.pvt-counter')) {
    await sleep(260 + Math.random() * 120);
    if (await page.isVisible('.pvt-counter')) await page.keyboard.press('Space');
    await sleep(700); // let the feedback disappear before looking again
  }
  await sleep(25);
}
if (await page.isVisible('.pvt-done')) await page.click('.pvt-done');
const remaining = CAMERA_SECONDS * 1000 - (Date.now() - cameraOn);
if (remaining > 0) await sleep(remaining);

// 3. what the page stored in the browser
const storage = await page.evaluate(() => {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    out[k] = localStorage.getItem(k);
  }
  return out;
});
await browser.close();
server.stop();

const storageSummary = {};
let storageProblems = [];
for (const [key, raw] of Object.entries(storage)) {
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* plain string */
  }
  let maxArray = 0;
  const walk = (v) => {
    if (Array.isArray(v)) {
      if (!(key.endsWith('events.v1') && v === parsed)) maxArray = Math.max(maxArray, v.length);
      v.forEach(walk);
    } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(parsed);
  const events = Array.isArray(parsed) ? parsed : [];
  const byType = {};
  for (const e of events) byType[e.type] = (byType[e.type] ?? 0) + 1;
  const camFields = [...new Set(events.filter((e) => e.type === 'cam').flatMap((e) => Object.keys(e)))].sort();
  storageSummary[key] = { bytes: raw.length, events: events.length, eventsByType: byType, camEventFields: camFields, longestNestedArray: maxArray };
  if (/data:(image|video)\//.test(raw)) storageProblems.push(`${key}: contains an image or video data URL`);
  if (maxArray > 6) storageProblems.push(`${key}: contains an array of ${maxArray} values (only the six NASA-TLX items are expected)`);
}

const load = requests.filter((r) => r.phase === 'load');
const afterAll = requests.filter((r) => r.phase === 'after-load');
// a request the page's Content-Security-Policy blocked never left the browser
const blocked = afterAll.filter((r) => r.outcome === 'blocked');
const after = afterAll.filter((r) => r.outcome !== 'blocked');
const flagged = requests.filter((r) => r.bodyFlag);
const group = (rs, key) => rs.reduce((m, r) => ((m[r[key]] = (m[r[key]] ?? 0) + 1), m), {});
const pass = after.length === 0 && sockets.length === 0 && flagged.length === 0 && storageProblems.length === 0;

const result = {
  date: new Date().toISOString(),
  setup: `production build served by vite preview; headless Chromium ${browserVersion} with a fake camera (test pattern, no face); face model served ${modelLocal ? 'by the site itself' : 'from Google model storage'}`,
  session: {
    camera_on_s: Math.round((Date.now() - cameraOn) / 1000),
    actions: ['camera on', 'check-in', '1-minute reaction test (rated first)'],
    page_errors: consoleErrors,
  },
  initial_load: {
    requests: load.length,
    by_host: group(load, 'host'),
    by_type: group(load, 'type'),
    by_method: group(load, 'method'),
    bytes_received: load.reduce((s, r) => s + r.received, 0),
    bytes_sent_in_bodies: load.reduce((s, r) => s + r.bodyBytes, 0),
  },
  after_load: {
    requests_sent: after.length,
    bytes_sent_in_bodies: after.reduce((s, r) => s + r.bodyBytes, 0),
    list: after.map(({ req, ...r }) => r),
    blocked_by_content_security_policy: blocked.map(({ req, ...r }) => r),
  },
  websockets: sockets,
  content_security_policy_violations: cspViolations,
  request_bodies_flagged: flagged.map(({ req, ...r }) => r),
  browser_storage: storageSummary,
  storage_problems: storageProblems,
  pass,
  note: 'The fake camera shows no face, so no landmarks are produced; the model still runs on every frame, so the network behaviour is that of normal use. The MediaPipe library tries to post usage statistics to odml.pa.googleapis.com once a minute; the page\'s Content-Security-Policy (index.html) blocks it in the browser, so it is listed as blocked, not sent.',
};
mkdirSync('../results', { recursive: true });
writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
console.log(
  `${pass ? 'PASS' : 'FAIL'}: ${load.length} requests during load (${Object.keys(result.initial_load.by_host).join(', ')}), ${after.length} sent after load in ${result.session.camera_on_s} s with the camera on (${blocked.length} blocked by the page's policy), ${sockets.length} WebSockets, ${flagged.length} suspicious bodies, ${storageProblems.length} storage problems -> ${OUT}`,
);
process.exit(pass ? 0 : 1);
