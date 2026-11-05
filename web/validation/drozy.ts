// Browser cross-check for the DROZY validation: runs the website's MediaPipe package (tasks-vision, the
// same model file and wasm the site loads) on the first N frames of one DROZY video, frame by frame, and
// posts the per-frame mean eyeBlink scores back to the local check server. No frames are kept or shown.

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const params = new URLSearchParams(location.search);
const test = params.get('test') ?? '1-1';
const nFrames = Number(params.get('frames') ?? 1800);
const status = document.getElementById('status') as HTMLElement;
const video = document.getElementById('v') as HTMLVideoElement;

async function landmarker(): Promise<{ lm: FaceLandmarker; delegate: string }> {
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      const lm = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
      return { lm, delegate };
    } catch {
      /* try CPU */
    }
  }
  throw new Error('could not create FaceLandmarker');
}

function seek(t: number): Promise<void> {
  return new Promise((resolve) => {
    video.addEventListener('seeked', () => resolve(), { once: true });
    video.currentTime = t;
  });
}

async function main() {
  const { lm, delegate } = await landmarker();
  video.src = `/drozy-video/${test}.mp4`;
  await new Promise((r) => video.addEventListener('loadeddata', r, { once: true }));
  const fps = Number(params.get('fps') ?? 30);
  const scores: (number | null)[] = [];
  for (let i = 0; i < nFrames; i++) {
    await seek((i + 0.5) / fps);
    const res = lm.detectForVideo(video, i + 1);
    const cats = res.faceBlendshapes?.[0]?.categories;
    if (!cats) {
      scores.push(null);
      continue;
    }
    const l = cats.find((c) => c.categoryName === 'eyeBlinkLeft')?.score ?? 0;
    const r = cats.find((c) => c.categoryName === 'eyeBlinkRight')?.score ?? 0;
    scores.push((l + r) / 2);
    if (i % 200 === 0) status.textContent = `${test}: ${i}/${nFrames}`;
  }
  await fetch('/drozy-result', { method: 'POST', body: JSON.stringify({ test, fps, delegate, scores }) });
  status.textContent = 'done';
}

main().catch(async (e) => {
  await fetch('/drozy-result', { method: 'POST', body: JSON.stringify({ test, error: String(e) }) });
});
