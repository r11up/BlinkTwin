// Webcam to eye, head and blink features, entirely in the page. MediaPipe Face Landmarker gives
// per-frame landmarks, eyeBlink and eyeLook blendshapes and a head transformation matrix. BlinkMeter
// turns closure into blinks, PERCLOS and blink duration; HeadTracker gives pose and nods. Frames are
// never stored; only one-minute summaries leave this module.

import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { BlinkMeter, type CamWindow } from './blink.ts';
import { gazeFromBlendshapes, HeadTracker, LookDownGate, poseFromMatrix, type Pose } from './head.ts';

const LOCAL_MODEL = '/models/face_landmarker.task';

// Timing counters for scripts/benchmark.mjs, collected only when the page is opened with ?perf=1.
const PERF = typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf');
const PERF_CPU = PERF && new URLSearchParams(location.search).get('perf') === 'cpu'; // ?perf=cpu: skip the GPU delegate
const PERF_GPU = PERF && new URLSearchParams(location.search).get('perf') === 'gpu'; // ?perf=gpu: GPU delegate even on software WebGL
export const perfCounters = { delegate: '', frames: 0, detectMs: [] as number[] };
if (PERF) (globalThis as unknown as { __blinktwinPerf: typeof perfCounters }).__blinktwinPerf = perfCounters;
const REMOTE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Face-mesh indices for the eye contours and irises (MediaPipe canonical face model)
const LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const RIGHT_EYE = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
const IRISES = [468, 473];

export interface FrameInfo {
  t: number;
  face: boolean;
  closure: number | null; // normalised 0-1
  eyesClosedForMs: number;
  pose: Pose | null; // relative to resting pose
  headDroppedForMs: number;
  gaze: { x: number; y: number } | null;
  lookingDown: boolean;
}

export interface LiveSummary extends CamWindow {
  nods: number;
  headMovement: number;
}

export interface CameraCallbacks {
  onFrame?: (f: FrameInfo) => void;
  onLive?: (w: LiveSummary) => void; // every second, trailing 60 s
  onWindow?: (w: LiveSummary) => void; // every full minute
  onError?: (message: string) => void;
}

const isZip = (b: Uint8Array) => {
  for (let i = 0; i < Math.min(16, b.length - 3); i++) if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x03 && b[i + 3] === 0x04) return true;
  return false;
};

async function modelBytes(): Promise<Uint8Array> {
  for (const url of [LOCAL_MODEL, REMOTE_MODEL]) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (isZip(bytes)) return bytes; // the dev server answers unknown paths with index.html, so check
    } catch {
      /* try the next source */
    }
  }
  throw new Error('could not download the face model (check your internet connection once, then it is cached)');
}

/**
 * True if WebGL is drawn in software (no usable graphics processor, e.g. SwiftShader or llvmpipe). There
 * MediaPipe's GPU delegate is several times slower than its CPU delegate (results/benchmark.json: about
 * 105 ms against 27 ms per frame in a cloud container), so the CPU delegate is used instead.
 */
export function softwareWebGl(renderer: string | null): boolean {
  return renderer !== null && /swiftshader|llvmpipe|software|softpipe|basic render/i.test(renderer);
}

function webGlRenderer(): string | null {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null;
  } catch {
    return null;
  }
}

async function loadLandmarker(): Promise<FaceLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  const modelAssetBuffer = await modelBytes();
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetBuffer, delegate },
    runningMode: 'VIDEO' as const,
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
  try {
    if (PERF_CPU || (!PERF_GPU && softwareWebGl(webGlRenderer()))) throw new Error('CPU delegate');
    const lm = await FaceLandmarker.createFromOptions(fileset, options('GPU'));
    perfCounters.delegate = 'GPU';
    return lm;
  } catch {
    perfCounters.delegate = 'CPU';
    return await FaceLandmarker.createFromOptions(fileset, options('CPU'));
  }
}

function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') return 'Camera permission was refused. Allow the camera for this site in the browser (address-bar camera icon), and on a Mac also in System Settings > Privacy & Security > Camera for your browser.';
  if (name === 'NotFoundError') return 'No camera was found.';
  if (name === 'NotReadableError') return 'The camera is in use by another app (for example Zoom or FaceTime). Close it and try again.';
  return err instanceof Error ? err.message : String(err);
}

export class Camera {
  private landmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private meter = new BlinkMeter();
  private head = new HeadTracker();
  private lookDown = new LookDownGate();
  private lastFrame = 0;
  private lastLive = 0;
  private lastWindow = 0;
  private startedAt = 0;
  private readonly video: HTMLVideoElement;
  private readonly overlay: HTMLCanvasElement | null;
  private readonly cb: CameraCallbacks;

  constructor(video: HTMLVideoElement, overlay: HTMLCanvasElement | null, cb: CameraCallbacks) {
    this.video = video;
    this.overlay = overlay;
    this.cb = cb;
  }

  get active(): boolean {
    return this.running;
  }

  /** Opens the camera first (so the preview appears at once), then loads the face model. */
  async start(onStatus?: (message: string) => void): Promise<void> {
    if (this.running) return;
    if (this.stream) this.stop(); // a previous attempt left the preview open
    try {
      onStatus?.('Asking for camera access…');
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
      this.video.srcObject = this.stream;
      await this.video.play();
    } catch (err) {
      this.stop();
      this.cb.onError?.(cameraErrorMessage(err));
      return;
    }
    try {
      if (!this.landmarker) {
        onStatus?.('Camera on. Loading the face model (first time only)…');
        this.landmarker = await loadLandmarker();
      }
    } catch (err) {
      this.cb.onError?.(`Camera works, but the face model failed to load: ${err instanceof Error ? err.message : String(err)}`);
      return; // keep the preview running so the person can see the camera works
    }
    this.meter = new BlinkMeter();
    this.head = new HeadTracker();
    this.lookDown = new LookDownGate();
    this.running = true;
    this.startedAt = performance.now();
    this.lastWindow = this.startedAt;
    requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    const ctx = this.overlay?.getContext('2d');
    if (ctx && this.overlay) ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  private summary(now: number, length: number): LiveSummary {
    return { ...this.meter.window(now, length), nods: this.head.nodsIn(now, length), headMovement: this.head.movement(now) };
  }

  private loop = (now: number) => {
    if (!this.running || !this.landmarker) return;
    if (now - this.lastFrame >= 1000 / 24 && this.video.readyState >= 2) {
      this.lastFrame = now;
      const callStart = PERF ? performance.now() : 0;
      const res = this.landmarker.detectForVideo(this.video, now);
      if (PERF) {
        perfCounters.frames++;
        perfCounters.detectMs.push(performance.now() - callStart);
      }
      const cats = res.faceBlendshapes?.[0]?.categories;
      const score = (name: string) => cats?.find((c) => c.categoryName === name)?.score ?? 0;
      const face = !!cats && cats.length > 0;
      const closure = this.meter.push(now, face ? (score('eyeBlinkLeft') + score('eyeBlinkRight')) / 2 : null);
      const matrix = res.facialTransformationMatrixes?.[0]?.data;
      const pose = face && matrix ? this.head.push(now, poseFromMatrix(matrix)) : null;
      this.cb.onFrame?.({
        t: now,
        face,
        closure,
        eyesClosedForMs: this.meter.closedFor(now),
        pose,
        headDroppedForMs: pose ? this.head.droppedFor(now) : 0,
        gaze: face ? gazeFromBlendshapes(score) : null,
        // decided from the frames before a closure began, not from the closure itself
        lookingDown: this.lookDown.push(now, face ? (score('eyeLookDownLeft') + score('eyeLookDownRight')) / 2 : null, this.meter.closedFor(now)) && face,
      });
      this.draw(res.faceLandmarks?.[0], closure);
      if (now - this.lastLive >= 1000) {
        this.lastLive = now;
        this.cb.onLive?.(this.summary(now, Math.min(60_000, now - this.startedAt)));
      }
      if (now - this.lastWindow >= 60_000) {
        this.lastWindow = now;
        this.cb.onWindow?.(this.summary(now, 60_000));
      }
    }
    requestAnimationFrame(this.loop);
  };

  private draw(lm: NormalizedLandmark[] | undefined, closure: number | null) {
    const c = this.overlay;
    if (!c) return;
    const w = (c.width = this.video.videoWidth || 640);
    const h = (c.height = this.video.videoHeight || 480);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (!lm) return;
    const closed = closure !== null && closure >= 0.8;
    ctx.lineWidth = 2;
    ctx.strokeStyle = closed ? '#e5484d' : '#3dd68c';
    for (const eye of [LEFT_EYE, RIGHT_EYE]) {
      ctx.beginPath();
      eye.forEach((i, k) => (k ? ctx.lineTo(lm[i].x * w, lm[i].y * h) : ctx.moveTo(lm[i].x * w, lm[i].y * h)));
      ctx.closePath();
      ctx.stroke();
    }
    ctx.fillStyle = '#ffd60a';
    for (const i of IRISES) {
      if (!lm[i]) continue;
      ctx.beginPath();
      ctx.arc(lm[i].x * w, lm[i].y * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // nose-to-forehead line shows head direction
    if (lm[1] && lm[10]) {
      ctx.strokeStyle = 'rgba(120,180,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(lm[10].x * w, lm[10].y * h);
      ctx.lineTo(lm[1].x * w, lm[1].y * h);
      ctx.stroke();
    }
  }
}
