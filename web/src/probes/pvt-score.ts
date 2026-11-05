// Scoring for the brief psychomotor vigilance test (PVT-B; Basner, Mollicone & Dinges, 2011):
// 3 minutes, inter-stimulus intervals of 1-4 s, lapses are reaction times above 355 ms, false starts are
// responses with no stimulus on screen or faster than 100 ms.

export const PVT_B = {
  durationMs: 180_000,
  isiMinMs: 1_000,
  isiMaxMs: 4_000,
  lapseMs: 355,
  falseStartMs: 100,
};

export interface PvtSummary {
  n: number;
  medianRt: number;
  meanSpeed: number; // mean of 1000/RT, responses per second
  lapses: number;
  falseStarts: number;
}

export function scorePvt(rtsMs: number[], prematureResponses: number, cfg = PVT_B): PvtSummary {
  const tooFast = rtsMs.filter((r) => r < cfg.falseStartMs).length;
  const valid = rtsMs.filter((r) => r >= cfg.falseStartMs);
  const sorted = [...valid].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const medianRt = sorted.length === 0 ? NaN : sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    n: valid.length,
    medianRt,
    meanSpeed: valid.length ? valid.reduce((s, r) => s + 1000 / r, 0) / valid.length : NaN,
    lapses: valid.filter((r) => r > cfg.lapseMs).length,
    falseStarts: prematureResponses + tooFast,
  };
}
