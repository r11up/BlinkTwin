// Cross-checks the Python MediaPipe extraction against the browser package the website uses.
// Starts a local Vite server (root web/) that also serves the DROZY videos and receives results, opens
// web/validation/drozy.html in headless Chrome for each test, and compares the browser's per-frame
// eyeBlink scores with the Python ones for the same frames. Only numbers are written; no frames.
//
// Usage (from web/): node scripts/drozy_mediapipe_browser_check.mjs <videos dir> <python frames dir> <out json> [tests...]

import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';

const [videosDir, framesDir, outJson, ...testsArg] = process.argv.slice(2);
const tests = testsArg.length ? testsArg : ['1-1', '4-2', '10-3'];
const FRAMES = 1800;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let pending = null;
const server = await createServer({
  root: resolve('.'),
  configFile: false,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 5199, strictPort: true },
  plugins: [
    {
      name: 'drozy-check',
      configureServer(s) {
        s.middlewares.use('/drozy-video', (req, res) => {
          const file = join(videosDir, decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0]));
          if (!/^\d+-\d+\.mp4$/.test(file.split('/').pop() ?? '') || !existsSync(file)) {
            res.statusCode = 404;
            res.end();
            return;
          }
          const size = statSync(file).size;
          const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Content-Type', 'video/mp4');
          if (range) {
            const start = range[1] ? Number(range[1]) : 0;
            const end = range[2] ? Number(range[2]) : size - 1;
            res.statusCode = 206;
            res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
            res.setHeader('Content-Length', end - start + 1);
            createReadStream(file, { start, end }).pipe(res);
          } else {
            res.setHeader('Content-Length', size);
            createReadStream(file).pipe(res);
          }
        });
        s.middlewares.use('/drozy-result', (req, res) => {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            res.end('ok');
            pending?.(JSON.parse(body));
          });
        });
      },
    },
  ],
});
await server.listen();

function python(test) {
  const lines = readFileSync(join(framesDir, `${test}.csv`), 'utf8').trim().split('\n').slice(1, FRAMES + 1);
  return lines.map((l) => {
    const c = l.split(',');
    return c[2] === '1' ? Number(c[3]) : null;
  });
}

const fpsOf = (test) => {
  const lines = readFileSync(join(framesDir, `${test}.csv`), 'utf8').trim().split('\n').slice(1, 302);
  const t = lines.map((l) => Number(l.split(',')[1]));
  return Math.round(300 / ((t[300] - t[0]) / 1000));
};

const out = { frames_per_test: FRAMES, tests: {} };
for (const test of tests) {
  const fps = fpsOf(test);
  const profile = mkdtempSync(join(tmpdir(), 'blinktwin-check-'));
  const result = new Promise((r) => (pending = r));
  const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', `--user-data-dir=${profile}`, '--autoplay-policy=no-user-gesture-required', `http://127.0.0.1:5199/validation/drozy.html?test=${test}&frames=${FRAMES}&fps=${fps}`], { stdio: 'ignore' });
  const r = await Promise.race([result, new Promise((r2) => setTimeout(() => r2({ test, error: 'timeout' }), 20 * 60_000))]);
  chrome.kill();
  if (r.error) {
    out.tests[test] = { error: r.error };
    console.log(test, 'error:', r.error);
    continue;
  }
  const py = python(test);
  const pairs = r.scores.map((b, i) => [b, py[i]]).filter(([b, p]) => b !== null && p !== null);
  const both = pairs.length;
  const n = Math.min(r.scores.length, py.length);
  const agreeFace = r.scores.slice(0, n).filter((b, i) => (b === null) === (py[i] === null)).length / n;
  const mb = pairs.reduce((s, [b]) => s + b, 0) / both;
  const mp = pairs.reduce((s, [, p]) => s + p, 0) / both;
  const cov = pairs.reduce((s, [b, p]) => s + (b - mb) * (p - mp), 0);
  const vb = pairs.reduce((s, [b]) => s + (b - mb) ** 2, 0);
  const vp = pairs.reduce((s, [, p]) => s + (p - mp) ** 2, 0);
  const diffs = pairs.map(([b, p]) => Math.abs(b - p)).sort((a, b) => a - b);
  out.tests[test] = {
    fps,
    delegate: r.delegate,
    frames_compared: both,
    face_agreement: agreeFace,
    pearson: cov / Math.sqrt(vb * vp),
    mean_abs_diff: diffs.reduce((s, d) => s + d, 0) / both,
    p95_abs_diff: diffs[Math.floor(0.95 * both)],
    browser_mean: mb,
    python_mean: mp,
  };
  console.log(test, JSON.stringify(out.tests[test]));
}
writeFileSync(outJson, JSON.stringify(out, null, 2));
await server.close();
process.exit(0);
