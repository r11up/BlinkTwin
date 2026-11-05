// Real-data evaluation of the released twin on DROZY (Massoz et al., 2016), leaving one subject out.
//
//   node scripts/drozy_twin.ts <DROZY dir> <results dir>
//
// Each subject did three 10-min PVTs: about 10:00 (rested), about 03:40 the next night and about 12:00 the
// next day, without sleep in between, rating KSS at each. For every subject, the forward models are refitted
// on the other 13 subjects; the twin then replays the subject's real test times, PVT median RT, per-minute
// webcam features (landmark-based PERCLOS and blink duration) and KSS ratings, and predicts the KSS of a test
// before seeing it. Assumed sleep: woke at 07:00 on the day of test 1 after 7.5 h (varied in a sensitivity
// analysis). Writes results/drozy_twin_summary.json (aggregates only).

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG, replay, type Channel, type ChannelId, type TwinConfig, type TwinEvent } from '../src/twin/twin.ts';

const [dir, out] = [process.argv[2], process.argv[3]];
const H = 3_600_000;
const M = 60_000;

const parseCsv = (path: string) => {
  const [head, ...rows] = readFileSync(path, 'utf8').trim().split('\n');
  const cols = head.split(',');
  return rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [cols[i], Number(v)])) as Record<string, number>);
};
const sessions = parseCsv(join(out, 'drozy_sessions.csv')).filter((s) => s.kss > 0);
const minutes = parseCsv(join(out, 'drozy_eye_minutes.csv'));

// test start times from the PVT files (local clock time, treated as UTC with offset 0)
const startOf = new Map<string, number>();
for (const f of readdirSync(join(dir, 'pvt-rt'))) {
  const m = f.match(/^(\d+)-(\d)\.csv$/);
  if (!m) continue;
  const head = readFileSync(join(dir, 'pvt-rt', f), 'utf8').split('\n')[0].trim();
  const [d, t] = head.split('_');
  const [hh, mm, ss] = t.split('.').map(Number);
  const [y, mo, da] = d.split('-').map(Number);
  startOf.set(`${m[1]}-${m[2]}`, Date.UTC(y, mo - 1, da, hh, mm, ss));
}

interface Obs {
  subject: number;
  x: number; // KSS - 3
  y: number;
}

/** Forward model with subject fixed effects, as in analysis/drozy_forward.py. */
function fitForward(obs: Obs[], base: Channel): Channel {
  const bySub = new Map<number, Obs[]>();
  obs.forEach((o) => bySub.set(o.subject, [...(bySub.get(o.subject) ?? []), o]));
  let sxy = 0;
  let sxx = 0;
  for (const g of bySub.values()) {
    const mx = g.reduce((a, o) => a + o.x, 0) / g.length;
    const my = g.reduce((a, o) => a + o.y, 0) / g.length;
    g.forEach((o) => {
      sxy += (o.x - mx) * (o.y - my);
      sxx += (o.x - mx) ** 2;
    });
  }
  const b = sxy / sxx;
  const ai = [...bySub.entries()].map(([s, g]) => [s, g.reduce((a, o) => a + o.y - b * o.x, 0) / g.length] as const);
  const a = ai.reduce((acc, [, v]) => acc + v, 0) / ai.length;
  const aMap = new Map(ai);
  const res = obs.map((o) => o.y - ((aMap.get(o.subject) as number) + b * o.x));
  const noise = Math.sqrt(res.reduce((acc, r) => acc + r * r, 0) / Math.max(1, obs.length - bySub.size - 1));
  const meanN = obs.length / bySub.size;
  const varA = ai.reduce((acc, [, v]) => acc + (v - a) ** 2, 0) / Math.max(1, ai.length - 1);
  const biasSd = Math.sqrt(Math.max(0, varA - noise ** 2 / meanN));
  return { ...base, at3: a, perKss: b, biasSd: Math.max(biasSd, 1e-3) };
}

function fitConfig(exclude: number): TwinConfig {
  const train = sessions.filter((s) => s.subject !== exclude);
  const kssOf = new Map(train.map((s) => [`${s.subject}-${s.test}`, s.kss]));
  const mins = minutes.filter((m) => m.subject !== exclude && kssOf.has(`${m.subject}-${m.test}`));
  const c = DEFAULT_CONFIG.channels;
  const channels: Record<ChannelId, Channel> = {
    pvt: fitForward(train.map((s) => ({ subject: s.subject, x: s.kss - 3, y: s.median_rt })), c.pvt),
    perclos: fitForward(mins.map((m) => ({ subject: m.subject, x: (kssOf.get(`${m.subject}-${m.test}`) as number) - 3, y: m.perclos * 100 })), c.perclos),
    blink: fitForward(
      mins.filter((m) => m.blinks >= 3).map((m) => ({ subject: m.subject, x: (kssOf.get(`${m.subject}-${m.test}`) as number) - 3, y: m.mean_blink_ms })),
      c.blink,
    ),
  };
  return { ...DEFAULT_CONFIG, tzOffsetMinutes: 0, channels };
}

function eventsFor(subject: number, wakeHour: number, include: { pvt: boolean; cam: boolean; kssTests: number[] }): { events: TwinEvent[]; kssTime: Map<number, number> } {
  const tests = sessions.filter((s) => s.subject === subject).sort((a, b) => a.test - b.test);
  const first = startOf.get(`${subject}-1`) ?? (startOf.get(`${subject}-${tests[0].test}`) as number) - (tests[0].test === 2 ? 17.5 * H : 26 * H);
  const day0 = Date.UTC(new Date(first).getUTCFullYear(), new Date(first).getUTCMonth(), new Date(first).getUTCDate());
  const wake = day0 + wakeHour * H;
  const events: TwinEvent[] = [{ t: wake, type: 'sleep', wake, hours: 7.5 }];
  const kssTime = new Map<number, number>();
  for (const s of tests) {
    const t0 = startOf.get(`${subject}-${s.test}`);
    if (t0 === undefined) continue;
    kssTime.set(s.test, t0 + 11 * M);
    if (include.pvt) events.push({ t: t0 + 10 * M, type: 'pvt', medianRt: s.median_rt, lapses: s.lapses355, n: s.pvt_n, falseStarts: s.false_starts });
    if (include.cam) {
      for (const m of minutes.filter((x) => x.subject === subject && x.test === s.test)) {
        events.push({ t: t0 + m.minute * M, type: 'cam', perclos: m.perclos, blinkRate: m.blinks, meanBlinkMs: m.blinks >= 3 ? m.mean_blink_ms : 0, coverage: m.coverage });
      }
    }
    if (include.kssTests.includes(s.test)) events.push({ t: t0 + 11 * M, type: 'kss', value: s.kss });
  }
  return { events, kssTime };
}

interface Pred {
  subject: number;
  test: number;
  truth: number;
  pred: number;
}

function run(name: string, wakeHour: number, include: { pvt: boolean; cam: boolean; checkIns: number[] }, targets: number[]): Pred[] {
  const preds: Pred[] = [];
  for (const subject of [...new Set(sessions.map((s) => s.subject))]) {
    const cfg = { ...fitConfig(subject), usePassive: include.pvt || include.cam };
    const { events, kssTime } = eventsFor(subject, wakeHour, { pvt: include.pvt, cam: include.cam, kssTests: include.checkIns });
    for (const test of targets) {
      const s = sessions.find((x) => x.subject === subject && x.test === test);
      const tk = kssTime.get(test);
      if (!s || tk === undefined || include.checkIns.includes(test)) continue;
      if (include.checkIns.some((c) => !sessions.find((x) => x.subject === subject && x.test === c))) continue; // need the check-in tests
      const r = replay(events, cfg, { until: tk - 1, stepMinutes: 60 });
      preds.push({ subject, test, truth: s.kss, pred: r.now.kss });
    }
  }
  void name;
  return preds;
}

const mae = (p: Pred[]) => p.reduce((a, x) => a + Math.abs(x.pred - x.truth), 0) / p.length;
function bootSubjects(p: Pred[], B = 2000): [number, number] {
  const subs = [...new Set(p.map((x) => x.subject))];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const ms: number[] = [];
  for (let b = 0; b < B; b++) {
    const pick = subs.map(() => subs[Math.floor(rnd() * subs.length)]);
    const sample = pick.flatMap((s) => p.filter((x) => x.subject === s));
    ms.push(mae(sample));
  }
  ms.sort((a, b) => a - b);
  return [ms[Math.floor(0.025 * B)], ms[Math.floor(0.975 * B)]];
}

const results: Record<string, unknown> = {};
const conditions: [string, { pvt: boolean; cam: boolean; checkIns: number[] }, number[]][] = [
  ['rhythm model only', { pvt: false, cam: false, checkIns: [] }, [2, 3]],
  ['passive only (PVT + webcam)', { pvt: true, cam: true, checkIns: [] }, [2, 3]],
  ['PVT only', { pvt: true, cam: false, checkIns: [] }, [2, 3]],
  ['check-in at test 1 only', { pvt: false, cam: false, checkIns: [1] }, [2, 3]],
  ['BlinkTwin: check-in at test 1 + PVT + webcam', { pvt: true, cam: true, checkIns: [1] }, [2, 3]],
  ['check-in at test 1 + PVT', { pvt: true, cam: false, checkIns: [1] }, [2, 3]],
  ['check-ins at tests 1-2 only', { pvt: false, cam: false, checkIns: [1, 2] }, [3]],
  ['BlinkTwin: check-ins at tests 1-2 + PVT + webcam', { pvt: true, cam: true, checkIns: [1, 2] }, [3]],
];
for (const wakeHour of [7, 6, 8]) {
  const block: Record<string, unknown> = {};
  for (const [name, inc, targets] of conditions) {
    const p = run(name, wakeHour, inc, targets);
    block[name] = { n: p.length, mae: mae(p), ci: bootSubjects(p), mae_test2: mae(p.filter((x) => x.test === 2)), mae_test3: mae(p.filter((x) => x.test === 3)), bias: p.reduce((a, x) => a + x.pred - x.truth, 0) / p.length };
  }
  results[`wake_${String(wakeHour).padStart(2, '0')}00`] = block;
}
// naive baselines (no model): leave-one-subject-out mean KSS of the test, and carrying test 1 forward
const naive: Pred[] = [];
const carry: Pred[] = [];
for (const s of sessions.filter((x) => x.test > 1)) {
  const others = sessions.filter((x) => x.test === s.test && x.subject !== s.subject);
  naive.push({ subject: s.subject, test: s.test, truth: s.kss, pred: others.reduce((a, x) => a + x.kss, 0) / others.length });
  const t1 = sessions.find((x) => x.subject === s.subject && x.test === 1);
  if (t1) carry.push({ subject: s.subject, test: s.test, truth: s.kss, pred: t1.kss });
}
results.naive = { 'LOSO mean KSS of the test': { n: naive.length, mae: mae(naive), ci: bootSubjects(naive) }, 'carry test-1 KSS forward': { n: carry.length, mae: mae(carry), ci: bootSubjects(carry) } };
results.note = 'Wake time is not recorded in DROZY; 07:00 is assumed (06:00 and 08:00 as sensitivity). KSS is placed 11 min after each test start, after the 10-min PVT. Webcam features are from the 68-point landmarks (EAR), not MediaPipe.';
writeFileSync(join(out, 'drozy_twin_summary.json'), JSON.stringify(results, null, 1));
for (const [w, block] of Object.entries(results)) {
  if (typeof block !== 'object' || block === null) continue;
  console.log(`== ${w}`);
  for (const [k, v] of Object.entries(block as Record<string, { n: number; mae: number; ci: [number, number] }>)) console.log(`  ${k.padEnd(50)} n=${v.n}  MAE ${v.mae.toFixed(2)} [${v.ci[0].toFixed(2)}, ${v.ci[1].toFixed(2)}]`);
}
