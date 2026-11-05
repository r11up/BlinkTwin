// Bayesian linear regression with known noise variance. BlinkTwin uses it to learn, per person,
// how a passive feature (reaction time, eye closure) maps onto that person's KSS ratings.
// It starts from a population prior and moves towards the individual as check-ins arrive.

export interface Blr {
  mean: number[]; // regression weights, first entry is the intercept
  cov: number[][]; // posterior covariance of the weights
  noiseVar: number; // residual variance of the target given the weights
  n: number; // number of personal observations absorbed
}

export function blrInit(mean: number[], priorSd: number[], noiseSd: number): Blr {
  const k = mean.length;
  const cov = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? priorSd[i] ** 2 : 0)));
  return { mean: [...mean], cov, noiseVar: noiseSd ** 2, n: 0 };
}

function covTimes(cov: number[][], x: number[]): number[] {
  return cov.map((row) => row.reduce((s, v, j) => s + v * x[j], 0));
}

function dot(a: number[], b: number[]): number {
  return a.reduce((s, v, i) => s + v * b[i], 0);
}

/** Predictive mean and variance of the target for features x (x[0] must be 1 for the intercept). */
export function blrPredict(m: Blr, x: number[]): { mean: number; variance: number } {
  const px = covTimes(m.cov, x);
  return { mean: dot(m.mean, x), variance: m.noiseVar + dot(x, px) };
}

export function blrUpdate(m: Blr, x: number[], y: number): Blr {
  const px = covTimes(m.cov, x);
  const s = dot(x, px) + m.noiseVar;
  const gain = px.map((v) => v / s);
  const resid = y - dot(m.mean, x);
  const mean = m.mean.map((w, i) => w + gain[i] * resid);
  const cov = m.cov.map((row, i) => row.map((v, j) => v - gain[i] * px[j]));
  return { mean, cov, noiseVar: m.noiseVar, n: m.n + 1 };
}
