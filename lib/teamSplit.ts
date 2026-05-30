/**
 * Split detected players into two teams by jersey colour, entirely client-side.
 *
 * Runs a tiny 2-means over sampled RGB swatches. Cluster 0 is normalised to be
 * the "bluer" team so it maps to `home` (the dashboard's blue) consistently
 * across frames. This is a heuristic for the in-browser demo — not robust to
 * lighting, keepers, or referees (that's Stage-2 work).
 */
export type RGB = [number, number, number];

function dist2(a: RGB, b: RGB): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

/** Returns an array of 0 | 1 per input colour: 0 = home (bluer), 1 = away. */
export function splitTeams(colors: RGB[]): number[] {
  const n = colors.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  // Seed centroids with the most- and least-blue swatches.
  let bluest = colors[0];
  let reddest = colors[0];
  let maxBlue = -Infinity;
  let minBlue = Infinity;
  for (const c of colors) {
    const blue = c[2] - c[0];
    if (blue > maxBlue) {
      maxBlue = blue;
      bluest = c;
    }
    if (blue < minBlue) {
      minBlue = blue;
      reddest = c;
    }
  }

  const centroids: [RGB, RGB] = [[...bluest], [...reddest]];
  const assign = new Array<number>(n).fill(0);

  for (let iter = 0; iter < 6; iter++) {
    for (let i = 0; i < n; i++) {
      assign[i] = dist2(colors[i], centroids[0]) <= dist2(colors[i], centroids[1]) ? 0 : 1;
    }
    const sums: [RGB, RGB] = [
      [0, 0, 0],
      [0, 0, 0],
    ];
    const counts = [0, 0];
    for (let i = 0; i < n; i++) {
      const k = assign[i];
      sums[k][0] += colors[i][0];
      sums[k][1] += colors[i][1];
      sums[k][2] += colors[i][2];
      counts[k] += 1;
    }
    for (let k = 0; k < 2; k++) {
      if (counts[k] > 0) {
        centroids[k] = [sums[k][0] / counts[k], sums[k][1] / counts[k], sums[k][2] / counts[k]];
      }
    }
  }

  // Make cluster 0 the bluer one so it consistently maps to "home".
  const blue0 = centroids[0][2] - centroids[0][0];
  const blue1 = centroids[1][2] - centroids[1][0];
  if (blue0 < blue1) {
    for (let i = 0; i < n; i++) assign[i] = assign[i] === 0 ? 1 : 0;
  }
  return assign;
}
