// Downloads MediaPipe's Face Landmarker model (Apache 2.0, from Google's official model storage) into
// public/models/ so the site works offline. Skips the download if a valid copy is already there.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const OUT = 'public/models/face_landmarker.task';
// .task files are zip bundles; the "PK\x03\x04" signature can follow a few padding bytes
const isZip = (buf) => buf.length > 1000 && Buffer.from(buf.subarray(0, 16)).includes(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

mkdirSync('public/models', { recursive: true });
if (existsSync(OUT) && isZip(readFileSync(OUT))) {
  console.log('Face model already present');
} else {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Model download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!isZip(buf)) throw new Error('Downloaded model is not a valid .task archive');
  writeFileSync(OUT, buf);
  console.log(`Face model saved to ${OUT} (${(buf.length / 1e6).toFixed(1)} MB)`);
}
