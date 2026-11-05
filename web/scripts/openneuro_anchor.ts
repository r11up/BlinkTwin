// Does a person's KSS offset from the Three-Process Model after normal sleep predict their offset after a
// night without sleep? This is the premise of anchoring, tested on OpenNeuro ds004902 (Xiang et al., 2024).
//
//   node scripts/openneuro_anchor.ts <participants.tsv> <results dir>
//
// KSS times are taken as the eyes-open EEG time of each session. Assumed sleep: normal-sleep session after a
// 7.5-h night ending 07:00; sleep-deprivation session after waking at 07:00 the previous day with no sleep.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { priorKss, TPM_DEFAULTS } from '../src/twin/tpm.ts';

const [tsv, out] = [process.argv[2], process.argv[3]];
const [head, ...rows] = readFileSync(tsv, 'utf8').trim().split('\n');
const cols = head.split('\t');
const H = 3_600_000;
const DAY0 = Date.UTC(2026, 0, 6);
const clock = (s: string) => {
  const [h, m, sec] = s.split(':').map(Number);
  return DAY0 + h * H + m * 60_000 + (sec || 0) * 1000;
};

interface P {
  id: string;
  ns: number;
  sd: number;
  offNs: number;
  offSd: number;
  priorSd: number;
}
const people: P[] = [];
for (const r of rows) {
  const v = Object.fromEntries(r.split('\t').map((x, i) => [cols[i], x]));
  if (v.KSS_NS === 'n/a' || v.KSS_SD === 'n/a' || v.EEG_SamplingTime_Open_NS === 'n/a' || v.EEG_SamplingTime_Open_SD === 'n/a') continue;
  const tNs = clock(v.EEG_SamplingTime_Open_NS);
  const tSd = clock(v.EEG_SamplingTime_Open_SD);
  const wakeNs = DAY0 + 7 * H;
  const pNs = priorKss(tNs, { wake: wakeNs, hours: 7.5 }, TPM_DEFAULTS, 0);
  // sleep deprivation: awake since 07:00 the previous day
  const wakeSd = DAY0 - 24 * H + 7 * H;
  const pSd = priorKss(tSd, { wake: wakeSd, hours: 7.5 }, TPM_DEFAULTS, 0);
  people.push({ id: v.participant_id, ns: Number(v.KSS_NS), sd: Number(v.KSS_SD), offNs: Number(v.KSS_NS) - pNs, offSd: Number(v.KSS_SD) - pSd, priorSd: pSd });
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v: number[]) => Math.sqrt(v.reduce((a, b) => a + (b - mean(v)) ** 2, 0) / (v.length - 1));
const pearson = (a: number[], b: number[]) => {
  const ma = mean(a);
  const mb = mean(b);
  return a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0) * b.reduce((s, x) => s + (x - mb) ** 2, 0));
};
const ranks = (v: number[]) => {
  const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
  const r = new Array(v.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j < idx.length && idx[j][0] === idx[i][0]) j++;
    for (let q = i; q < j; q++) r[idx[q][1]] = (i + j + 1) / 2;
    i = j;
  }
  return r as number[];
};
const n = people.length;
const offNs = people.map((p) => p.offNs);
const offSd = people.map((p) => p.offSd);
const r = pearson(offNs, offSd);
const rho = pearson(ranks(offNs), ranks(offSd));
// Fisher-z 95% CI
const z = Math.atanh(r);
const se = 1 / Math.sqrt(n - 3);
const ci = [Math.tanh(z - 1.96 * se), Math.tanh(z + 1.96 * se)];

// predicting KSS after sleep deprivation
const mae = (pred: number[]) => mean(people.map((p, i) => Math.abs(Math.min(9, Math.max(1, pred[i])) - p.sd)));
const meanOffSd = mean(offSd);
const varOff = Math.max(0.01, sd(offNs) ** 2 - 0.75 ** 2);
const shrink = varOff / (varOff + 0.75 ** 2); // Kalman gain of one KSS check-in with rating SD 0.75
const summary = {
  dataset: 'OpenNeuro ds004902 (Xiang et al., 2024, Sci Data 11:427)',
  n,
  offset_ns_mean: mean(offNs),
  offset_ns_sd: sd(offNs),
  offset_sd_mean: meanOffSd,
  offset_sd_sd: sd(offSd),
  pearson_r: r,
  pearson_ci95: ci,
  spearman_rho: rho,
  mae_predicting_sd_kss: {
    rhythm_model_only: mae(people.map((p) => p.priorSd)),
    rhythm_model_plus_group_offset: mae(people.map((p) => p.priorSd + meanOffSd)),
    anchor_full_ns_offset: mae(people.map((p) => p.priorSd + p.offNs)),
    anchor_shrunk_ns_offset: mae(people.map((p) => p.priorSd + shrink * p.offNs)),
    carry_ns_kss_forward: mae(people.map((p) => p.ns)),
  },
  shrinkage_factor: shrink,
  note: 'KSS time = eyes-open EEG time; sleep assumed (normal: 7.5 h ending 07:00; deprivation: awake since 07:00 the previous day). Session order was counterbalanced.',
};
writeFileSync(join(out, 'openneuro_anchor_summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
