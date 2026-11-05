// Event storage in the browser. Only numbers are stored (ratings, reaction-time and blink summaries);
// no images or video. Storage can be unavailable (private windows), so every access is guarded.

import type { TwinEvent } from './twin/twin.ts';

const KEY = 'blinktwin.events.v1';
const DEMO_KEY = 'blinktwin.demo.v1';

function read(key: string): TwinEvent[] | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as TwinEvent[]) : null;
  } catch {
    return null;
  }
}

function write(key: string, events: TwinEvent[] | null) {
  try {
    if (events === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(events));
  } catch {
    /* storage unavailable: keep working in memory */
  }
}

export interface DemoState {
  events: TwinEvent[];
  now: number;
}

export class Store {
  private events: TwinEvent[] = read(KEY) ?? [];
  private demo: DemoState | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(DEMO_KEY);
      this.demo = raw ? (JSON.parse(raw) as DemoState) : null;
    } catch {
      this.demo = null;
    }
  }

  get isDemo(): boolean {
    return this.demo !== null;
  }

  now(): number {
    return this.demo ? this.demo.now : Date.now();
  }

  all(): TwinEvent[] {
    return this.demo ? this.demo.events : this.events;
  }

  add(e: TwinEvent) {
    if (this.demo) {
      this.demo.events.push(e);
      this.saveDemo();
      return;
    }
    this.events.push(e);
    write(KEY, this.events);
  }

  startDemo(state: DemoState) {
    this.demo = state;
    this.saveDemo();
  }

  stopDemo() {
    this.demo = null;
    try {
      localStorage.removeItem(DEMO_KEY);
    } catch {
      /* ignore */
    }
  }

  clear() {
    this.events = [];
    write(KEY, null);
  }

  private saveDemo() {
    try {
      localStorage.setItem(DEMO_KEY, JSON.stringify(this.demo));
    } catch {
      /* ignore */
    }
  }
}

export function toCsv(events: TwinEvent[]): string {
  const cols = ['t_iso', 'type', 'value', 'medianRt', 'lapses', 'perclos', 'blinkRate', 'meanBlinkMs', 'coverage', 'nods', 'headMovement', 'context', 'wake_iso', 'hours', 'level', 'reason'];
  const rows = events.map((e) => {
    const r: Record<string, string | number> = { t_iso: new Date(e.t).toISOString(), type: e.type };
    if (e.type === 'kss' || e.type === 'tlx') r.value = e.value;
    if (e.type === 'pvt') Object.assign(r, { medianRt: e.medianRt, lapses: e.lapses });
    if (e.type === 'cam') Object.assign(r, { perclos: e.perclos, blinkRate: e.blinkRate, meanBlinkMs: e.meanBlinkMs, coverage: e.coverage, nods: e.nods ?? '', headMovement: e.headMovement ?? '' });
    if (e.type === 'alert') Object.assign(r, { level: e.level, reason: JSON.stringify(e.reason) });
    if (e.type === 'context') r.context = e.context;
    if (e.type === 'sleep') Object.assign(r, { wake_iso: new Date(e.wake).toISOString(), hours: e.hours });
    return cols.map((c) => (r[c] ?? '').toString()).join(',');
  });
  return [cols.join(','), ...rows].join('\n');
}
