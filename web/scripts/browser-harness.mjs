// Shared helpers for the browser-based checks (privacy_check.mjs, benchmark.mjs): build the site, serve it
// with `vite preview`, and load Playwright (a local install, or the global one if there is no local copy).

import { execSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    const root = execSync('npm root -g').toString().trim();
    return require(join(root, 'playwright'));
  }
}

/** Builds the production site (dist/) unless `--no-build` was passed. */
export function buildSite(argv = process.argv) {
  if (argv.includes('--no-build')) return;
  execSync('npm run build --silent', { stdio: ['ignore', 'ignore', 'inherit'] });
}

/** Downloads the face model into public/models/ if it is not there, so the site serves it itself. */
export function fetchModel() {
  try {
    execSync('node scripts/fetch-model.mjs', { stdio: ['ignore', 'ignore', 'inherit'] });
    return true;
  } catch {
    return false; // the site then loads the model from Google's model storage
  }
}

/** Starts `vite preview` on 127.0.0.1:port and resolves once it answers. */
export async function startPreview(port = 4173) {
  // its own process group, so that stopping it also stops the vite process npx starts
  const proc = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true });
  const stop = () => {
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  };
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return { url, stop };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  stop();
  throw new Error('vite preview did not start');
}

export const FAKE_CAMERA_ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
