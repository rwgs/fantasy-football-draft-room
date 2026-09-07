/**
 * A seeded generator, so the same seed replays the same draft.
 *
 * A mock draft you cannot replay is hard to learn anything from: change one
 * dial, run it again, and you want the difference to come from the dial rather
 * than from new dice.
 */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next(): number {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A normal draw, by the Box-Muller transform. */
export function gaussian(rng: () => number, mean = 0, sd = 1): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** The normal cumulative distribution, by the Abramowitz and Stegun formula. */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

/**
 * The log of the upper tail, `log P(X > z)`, for a standard normal.
 *
 * `normalCdf` is an approximation with a fixed absolute error, so once the tail
 * it is reporting is smaller than that error the answer is noise, and past
 * roughly nine standard deviations it underflows to zero outright. A player who
 * has fallen well past his ADP lives exactly there, and the only thing asked of
 * two such tails is their ratio, which survives in logs long after either one
 * has stopped being representable.
 *
 * Above the crossover the tail comes from the Mills ratio as a continued
 * fraction, which converges quickly for positive `z`; below it the direct
 * subtraction still has plenty of significant digits to give.
 */
export function logNormalTail(z: number): number {
  if (z < 2) return Math.log(1 - normalCdf(z));
  let r = 0;
  for (let k = 64; k >= 1; k -= 1) r = k / (z + r);
  // -z^2/2 - log(sqrt(2*pi)) is log of the density; the fraction is Q/density.
  return -0.5 * z * z - 0.9189385332046727 + Math.log(1 / (z + r));
}
