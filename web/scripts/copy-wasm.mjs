// Copies MediaPipe's WebAssembly files into public/ so the site works without a CDN.
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('public/mediapipe', { recursive: true });
cpSync('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe/wasm', { recursive: true });
console.log('MediaPipe wasm copied to public/mediapipe/wasm');
