// src/indicators/vsa.js
// Volume Spread Analysis (simplified, bullish-only detections)
// Uses a rolling window (default 24 bars) to normalise volume via MA±SD.

import { sma, std } from "./math";

/**
 * Compute VSA buy-side signals.
 * @param {number[]} open
 * @param {number[]} high
 * @param {number[]} low
 * @param {number[]} close
 * @param {number[]} volume
 * @param {number}   window  Lookback bars for volume normalisation (default 24 for 24h on 1h data)
 * @returns {{ combined: number[], components: { stopping:number[], noSupply:number[], testBar:number[], shakeout:number[] } }}
 */
export function vsaSignals(open, high, low, close, volume, window = 24) {
  const n = close.length;
  const combined = new Array(n).fill(0);
  const stopping = new Array(n).fill(0);
  const noSupply = new Array(n).fill(0);
  const testBar  = new Array(n).fill(0);
  const shakeout = new Array(n).fill(0);

  const volMA = sma(volume, window);   // e.g., 24-hour lookback for 1h bars
  const volSD = std(volume, window);

  for (let i = 1; i < n; i++) {
    const rng = high[i] - low[i];
    if (!Number.isFinite(rng) || rng <= 0) { combined[i] = 0; continue; }

    const refOpen = Number.isFinite(open[i]) ? open[i] : close[i - 1];
    const body = Math.abs(close[i] - refOpen);
    const mid  = low[i] + rng / 2;

    const isDown = close[i] < refOpen;
    const isUp   = close[i] > refOpen;

    const longLower = (close[i] - low[i]) > 0.6 * rng;
    const narrow    = (body / rng) < 0.35;

    const hv = Number.isFinite(volMA[i]) ? (volume[i] > (volMA[i] + (volSD[i] || 0))) : false;
    const lv = Number.isFinite(volMA[i]) ? (volume[i] < (volMA[i] * 0.7)) : false;

    const sv  = (isDown && hv && close[i] >= mid);                                   // Stopping Volume
    const ns  = (isDown && lv && narrow && (close[i] <= low[i] + 0.25 * rng));       // No Supply
    const tst = (narrow && lv && (close[i] >= low[i] + 0.75 * rng) &&                // Test Bar
                 (close[i - 1] < (Number.isFinite(open[i - 1]) ? open[i - 1] : close[i - 2] ?? close[i - 1])));
    const sho = (hv && longLower && isUp);                                           // Shakeout

    if (sv)  { stopping[i] = 1; }
    if (ns)  { noSupply[i] = 1; }
    if (tst) { testBar[i]  = 1; }
    if (sho) { shakeout[i] = 1; }

    combined[i] = (sv || ns || tst || sho) ? 1 : 0;
  }

  return { combined, components: { stopping, noSupply, testBar, shakeout } };
}
