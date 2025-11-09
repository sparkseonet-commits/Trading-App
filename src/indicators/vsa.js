// src/indicators/vsa.js
// Volume Spread Analysis – enriched bullish detection suite.
// Normalises volume with MA±SD and blends multiple contextual patterns
// into a composite confidence score while still surfacing a boolean trigger
// for legacy consumers.

import { atr, sma, std } from "./math";

const DEFAULT_WINDOW = 24;
const ACTIVATION_SCORE = 2.6; // minimum composite score required to flip the legacy boolean trigger
const WEIGHTS = {
  stopping: 1.6,
  noSupply: 1.1,
  testBar: 1.4,
  shakeout: 2.2,
  climactic: 2.0,
  spring: 2.6,
  demand: 1.7,
  effortResult: 1.2,
};

/**
 * Compute enriched VSA buy-side signals.
 * @param {number[]} open
 * @param {number[]} high
 * @param {number[]} low
 * @param {number[]} close
 * @param {number[]} volume
 * @param {number}   window  Lookback bars for volume normalisation (default 24 for 24h on 1h data)
 * @returns {{
 *   combined: number[],
 *   score: number[],
 *   components: {
 *     stopping:number[], noSupply:number[], testBar:number[], shakeout:number[],
 *     climactic:number[], spring:number[], demand:number[], effortResult:number[]
 *   },
 *   context: { volumeMA:number[], volumeSD:number[], volumeZ:number[], atr:number[] },
 *   meta: { weights: typeof WEIGHTS, activation: number }
 * }}
 */
export function vsaSignals(open, high, low, close, volume, window = DEFAULT_WINDOW) {
  const n = Array.isArray(close) ? close.length : 0;
  const combined = new Array(n).fill(0);
  const score = new Array(n).fill(0);

  const stopping = new Array(n).fill(0);
  const noSupply = new Array(n).fill(0);
  const testBar = new Array(n).fill(0);
  const shakeout = new Array(n).fill(0);
  const climactic = new Array(n).fill(0);
  const spring = new Array(n).fill(0);
  const demand = new Array(n).fill(0);
  const effortResult = new Array(n).fill(0);

  const volMA = sma(volume, window);
  const volSD = std(volume, window);
  const atrPeriod = Math.max(5, Math.round(window / 2));
  const atrVals = atr(high, low, close, atrPeriod);
  const volumeZ = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const hi = high?.[i];
    const lo = low?.[i];
    const cl = close?.[i];
    if (!Number.isFinite(hi) || !Number.isFinite(lo) || !Number.isFinite(cl)) continue;

    const rng = hi - lo;
    if (!Number.isFinite(rng) || rng <= 0) continue;

    const refOpen = Number.isFinite(open?.[i]) ? open[i] : close?.[i - 1];
    if (!Number.isFinite(refOpen)) continue;

    const body = Math.abs(cl - refOpen);
    const mid = lo + rng / 2;

    const prevClose = Number.isFinite(close?.[i - 1]) ? close[i - 1] : NaN;
    const prevOpen = Number.isFinite(open?.[i - 1]) ? open[i - 1] : prevClose;
    const prevHigh = Number.isFinite(high?.[i - 1]) ? high[i - 1] : NaN;
    const prevLow = Number.isFinite(low?.[i - 1]) ? low[i - 1] : NaN;
    const prevRange = Number.isFinite(prevHigh) && Number.isFinite(prevLow) ? prevHigh - prevLow : NaN;

    const isDown = cl < refOpen;
    const isUp = cl > refOpen;

    const longLower = (cl - lo) > 0.55 * rng;
    const narrow = rng > 0 ? (body / rng) < 0.35 : false;
    const ultraNarrow = rng > 0 ? (body / rng) < 0.2 : false;

    const ma = volMA?.[i];
    const sd = volSD?.[i];
    const atrVal = atrVals?.[i];

    const hv = Number.isFinite(ma) ? volume[i] >= (ma + (sd || 0) * 0.5) : false;
    const ultraHv = Number.isFinite(ma) ? volume[i] >= (ma + (sd || 0) * 1.5) : false;
    const lv = Number.isFinite(ma) ? volume[i] <= ma * 0.75 : false;
    const ultraLv = Number.isFinite(ma) ? volume[i] <= ma * 0.55 : false;

    const z = Number.isFinite(ma) && Number.isFinite(sd) && sd > 0
      ? (volume[i] - ma) / sd
      : (Number.isFinite(ma) && ma !== 0 ? (volume[i] / ma) - 1 : 0);
    volumeZ[i] = Number.isFinite(z) ? z : 0;

    const veryWide = Number.isFinite(atrVal) ? rng >= atrVal * 1.4 : rng > 0;
    const closingStrong = cl >= lo + 0.65 * rng;
    const smallResult = Number.isFinite(prevClose)
      ? Math.abs(cl - prevClose) <= (Number.isFinite(atrVal) ? atrVal * 0.3 : rng * 0.3)
      : false;

    const downTrend = i >= 3
      && Number.isFinite(close?.[i - 1])
      && Number.isFinite(close?.[i - 2])
      && Number.isFinite(close?.[i - 3])
      && close[i - 1] <= close[i - 2]
      && close[i - 2] <= close[i - 3];

    const prevLows = [];
    if (Number.isFinite(prevLow)) prevLows.push(prevLow);
    if (Number.isFinite(low?.[i - 2])) prevLows.push(low[i - 2]);
    const minPrevLow = prevLows.length ? Math.min(...prevLows) : Infinity;
    const madeLowerLow = lo < minPrevLow;

    const sv = isDown && hv && cl >= mid; // Stopping Volume
    const ns = (isDown || cl <= prevClose) && (lv || ultraLv) && (narrow || ultraNarrow) && cl <= lo + 0.25 * rng; // No Supply
    const tst = (narrow || ultraNarrow) && (lv || ultraLv) && closingStrong && Number.isFinite(prevOpen) && Number.isFinite(prevClose)
      && prevClose < prevOpen; // Successful Test
    const sho = (hv || ultraHv) && longLower && isUp && Number.isFinite(prevClose) && cl > prevClose; // Shakeout
    const clim = ultraHv && isDown && closingStrong && veryWide; // Climactic action
    const spr = (hv || ultraHv) && madeLowerLow && closingStrong && Number.isFinite(prevClose) && cl > prevClose; // Spring/Bear trap
    const dem = (hv || ultraHv) && isUp && closingStrong && downTrend
      && Number.isFinite(prevClose) && cl > prevClose
      && (Number.isFinite(prevRange) ? rng >= prevRange * 0.9 : true); // Demand bar
    const eff = (hv || ultraHv) && isDown && closingStrong && smallResult; // Effort vs Result absorption

    let sc = 0;
    if (sv) { stopping[i] = 1; sc += WEIGHTS.stopping; }
    if (ns) { noSupply[i] = 1; sc += WEIGHTS.noSupply; }
    if (tst) { testBar[i] = 1; sc += WEIGHTS.testBar; }
    if (sho) { shakeout[i] = 1; sc += WEIGHTS.shakeout; }
    if (clim) { climactic[i] = 1; sc += WEIGHTS.climactic; }
    if (spr) { spring[i] = 1; sc += WEIGHTS.spring; }
    if (dem) { demand[i] = 1; sc += WEIGHTS.demand; }
    if (eff) { effortResult[i] = 1; sc += WEIGHTS.effortResult; }

    score[i] = sc;
    combined[i] = sc >= ACTIVATION_SCORE ? 1 : 0;
  }

  return {
    combined,
    score,
    components: { stopping, noSupply, testBar, shakeout, climactic, spring, demand, effortResult },
    context: { volumeMA: volMA, volumeSD: volSD, volumeZ, atr: atrVals },
    meta: { weights: WEIGHTS, activation: ACTIVATION_SCORE },
  };
}
