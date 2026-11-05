// Real-data checks of two ways to make the prior more accurate, on OpenNeuro ds004902 (Xiang et al., 2024).
// Both comparisons were fixed before looking at the results and are reported whatever they show.
//
//   node scripts/openneuro_prior_check.ts <participants.tsv> <results dir>
//
// (1) Entering your sleep: the app asks for wake time and hours slept. Here the participants' sleep diary
//     (bedtime and get-up time for the normal-sleep night) replaces the default assumption (7.5 h ending
//     07:00). For the sleep-deprivation session the previous wake time is taken as the diary get-up time
//     (default: 07:00), since the diary describes only the normal-sleep night.
// (2) The KSS mapping: the default KSS = 10.6 - 0.6 A (Akerstedt & Folkard) against the mapping refitted
//     to airline data by Ingre et al. (2014), KSS = 9.68 - 0.46 A.
// Outcome: mean absolute error of the prior against the KSS rating in each session (no personal data are
// used by the prior), for people with KSS in both sessions and a complete diary. Writes
// results/openneuro_prior_summary.json (aggregates only).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { priorKss, TPM_DEFAULTS, type TpmParams } from '../src/twin/tpm.ts';

const [tsv, out] = [process.argv[2], process.argv[3]];
const [head, ...rows] = readFileSync(tsv, 'utf8').trim().split('\n');
const cols = head.split('\t');
const H = 3_600_000;
const DAY0 = Date.UTC(2026, 0, 6);
const hours = (s: string) => {
  const [h, m, sec] = s.split(':').map(Number);
  return h + m / 60 + (sec || 0) / 3600;
};

interface Row {
  id: string;
  kssNs: number;
  kssSd: number;
  tNs: number; // clock hour of the eyes-open EEG (KSS time) in each session
  tSd: number;
  diary: { wake: number; sleepH: number } | null;
}

const people: Row[] = [];
for (const r of rows) {
  const v = Object.fromEntries(r.split('\t').map((x, i) => [cols[i], x]));
  if ([v.KSS_NS, v.KSS_SD, v.EEG_SamplingTime_Open_NS, v.EEG_SamplingTime_Open_SD].includes('n/a')) continue;
  let diary: Row['diary'] = null;
  if (v.SleepDiary_item1_NS !== 'n/a' && v.SleepDiary_item2_NS !== 'n/a') {
    const bed = hours(v.SleepDiary_item1_NS);
    const wake = hours(v.SleepDiary_item2_NS);
    const sleepH = (((wake - bed) % 24) + 24) % 24;
    if (sleepH >= 3 && sleepH <= 13) diary = { wake, sleepH };
  }
  people.push({ id: v.participant_id, kssNs: Number(v.KSS_NS), kssSd: Number(v.KSS_SD), tNs: hours(v.EEG_SamplingTime_Open_NS), tSd: hours(v.EEG_SamplingTime_Open_SD), diary });
}

const tpmIngre: TpmParams = { ...TPM_DEFAULTS, kssIntercept: 9.68, kssSlope: 0.46 };

function priors(p: Row, useDiary: boolean, tpm: TpmParams) {
  const wakeH = useDiary && p.diary ? p.diary.wake : 7;
  const sleepH = useDiary && p.diary ? p.diary.sleepH : 7.5;
  // normal sleep: woke at wakeH on DAY0 after sleepH; KSS at tNs (after waking)
  const wakeNs = DAY0 + wakeH * H;
  const tNs = DAY0 + p.tNs * H + (p.tNs < wakeH ? 24 * H : 0);
  const ns = priorKss(tNs, { wake: wakeNs, hours: sleepH }, tpm, 0);
  // sleep deprivation: woke at wakeH on the previous day, no sleep since; KSS at tSd on DAY0
  const wakeSd = DAY0 - 24 * H + wakeH * H;
  const sd = priorKss(DAY0 + p.tSd * H, { wake: wakeSd, hours: sleepH }, tpm, 0);
  return { ns, sd };
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
function bootDiff(a: number[], b: number[], B = 4000): [number, number] {
  let seed = 2024;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const d = a.map((x, i) => x - b[i]);
  const ms: number[] = [];
  for (let k = 0; k < B; k++) {
    let s = 0;
    for (let i = 0; i < d.length; i++) s += d[Math.floor(rnd() * d.length)];
    ms.push(s / d.length);
  }
  ms.sort((x, y) => x - y);
  return [ms[Math.floor(0.025 * B)], ms[Math.floor(0.975 * B)]];
}

const withDiary = people.filter((p) => p.diary);
function evaluate(useDiary: boolean, tpm: TpmParams) {
  const errNs: number[] = [];
  const errSd: number[] = [];
  const predChange: number[] = [];
  for (const p of withDiary) {
    const pr = priors(p, useDiary, tpm);
    errNs.push(Math.abs(pr.ns - p.kssNs));
    errSd.push(Math.abs(pr.sd - p.kssSd));
    predChange.push(pr.sd - pr.ns);
  }
  const both = errNs.map((e, i) => (e + errSd[i]) / 2);
  // share of predictions within 1 KSS point of the rating (the metric used by Knock et al., 2021)
  const within1 = [...errNs, ...errSd].filter((e) => e <= 1).length / (errNs.length + errSd.length);
  return { errNs, errSd, both, predChange, within1 };
}

const variants = {
  default_sleep_default_mapping: evaluate(false, TPM_DEFAULTS),
  diary_sleep_default_mapping: evaluate(true, TPM_DEFAULTS),
  default_sleep_ingre_mapping: evaluate(false, tpmIngre),
  diary_sleep_ingre_mapping: evaluate(true, tpmIngre),
};
const base = variants.default_sleep_default_mapping;

// Does the mapping still matter once the person has rated themselves once? All 33 people with KSS in both
// sessions, default sleep assumption. The offset from the prior in one session, shrunk by the twin's Kalman
// gain for one check-in (offset prior SD 1.2, rating SD 0.75), predicts the rating in the other session.
const gain = 1.2 ** 2 / (1.2 ** 2 + 0.75 ** 2);
function withCheckIn(tpm: TpmParams) {
  const priorOnly: number[] = [];
  const nsToSd: number[] = [];
  const sdToNs: number[] = [];
  for (const p of people) {
    const pr = priors(p, false, tpm);
    priorOnly.push((Math.abs(pr.ns - p.kssNs) + Math.abs(pr.sd - p.kssSd)) / 2);
    const clamp = (x: number) => Math.min(9, Math.max(1, x));
    nsToSd.push(Math.abs(clamp(pr.sd + gain * (p.kssNs - pr.ns)) - p.kssSd));
    sdToNs.push(Math.abs(clamp(pr.ns + gain * (p.kssSd - pr.sd)) - p.kssNs));
  }
  const all = [...nsToSd, ...sdToNs];
  const priorAll: number[] = [];
  for (const p of people) {
    const pr = priors(p, false, tpm);
    priorAll.push(Math.abs(pr.ns - p.kssNs), Math.abs(pr.sd - p.kssSd));
  }
  return {
    priorOnly,
    nsToSd,
    sdToNs,
    both: nsToSd.map((x, i) => (x + sdToNs[i]) / 2),
    within1Checkin: all.filter((e) => e <= 1).length / all.length,
    within1Prior: priorAll.filter((e) => e <= 1).length / priorAll.length,
  };
}
const ciDefault = withCheckIn(TPM_DEFAULTS);
const ciIngre = withCheckIn(tpmIngre);

const summary: Record<string, unknown> = {
  dataset: 'OpenNeuro ds004902 (Xiang et al., 2024, Sci Data 11:427), participants.tsv',
  n_kss_both_sessions: people.length,
  n_with_diary: withDiary.length,
  diary_sleep_hours_mean: mean(withDiary.map((p) => p.diary!.sleepH)),
  diary_wake_hour_mean: mean(withDiary.map((p) => p.diary!.wake)),
  observed_change_mean: mean(withDiary.map((p) => p.kssSd - p.kssNs)),
  variants: Object.fromEntries(
    Object.entries(variants).map(([k, v]) => [
      k,
      {
        mae_normal_sleep: mean(v.errNs),
        mae_sleep_deprivation: mean(v.errSd),
        mae_both: mean(v.both),
        diff_vs_default_both: k === 'default_sleep_default_mapping' ? null : mean(v.both) - mean(base.both),
        diff_ci95: k === 'default_sleep_default_mapping' ? null : bootDiff(v.both, base.both),
        predicted_change_mean: mean(v.predChange),
        share_within_1_kss: v.within1,
      },
    ]),
  ),
  with_one_checkin_all_33: {
    kalman_gain: gain,
    default_mapping: { prior_only_mae: mean(ciDefault.priorOnly), checkin_other_session_mae: mean(ciDefault.both), ns_to_sd_mae: mean(ciDefault.nsToSd), sd_to_ns_mae: mean(ciDefault.sdToNs), prior_share_within_1: ciDefault.within1Prior, checkin_share_within_1: ciDefault.within1Checkin },
    ingre_mapping: { prior_only_mae: mean(ciIngre.priorOnly), checkin_other_session_mae: mean(ciIngre.both), ns_to_sd_mae: mean(ciIngre.nsToSd), sd_to_ns_mae: mean(ciIngre.sdToNs), prior_share_within_1: ciIngre.within1Prior, checkin_share_within_1: ciIngre.within1Checkin },
    ingre_minus_default_with_checkin: mean(ciIngre.both) - mean(ciDefault.both),
    ingre_minus_default_with_checkin_ci95: bootDiff(ciIngre.both, ciDefault.both),
  },
  note: 'MAE of the Three-Process Model prior alone (no personal data) against the KSS rating at the eyes-open EEG time. The diary covers the normal-sleep night only; for the deprivation session its get-up time stands in for the previous wake time. Both comparisons were fixed in advance.',
};
writeFileSync(join(out, 'openneuro_prior_summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
