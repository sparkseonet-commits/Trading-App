// src/indicators/daily.js
// Daily timeframe indicators computed on UTC-daily resample and optionally expanded to row resolution.

import { sma, std, rsi, macdLine, slope } from "./math";

/**
 * Compute daily indicators from daily OHLC arrays.
 * @param {Array<{ts:number,open:number,high:number,low:number,close:number}>} daily
 * @param {Array<{mvrvz?:number}>} rows  Row-level array (for mvrvz absolute buy)
 */
export function computeDailyIndicators(daily, rows) {
  const n = daily.length;
  const dClose = daily.map(d => d.close);
  const dLow   = daily.map(d => d.low);

  // SMAs
  const dSMA7   = sma(dClose, 7);
  const dSMA30  = sma(dClose, 30);
  const dSMA90  = sma(dClose, 90);
  const dSMA111 = sma(dClose, 111);
  const dSMA350 = sma(dClose, 350);

  // PI ratio & absolute PI buy (PI ≤ 0.30)
  const dPiRatio = dSMA111.map((v,i)=> (Number.isFinite(v) && Number.isFinite(dSMA350[i]) && dSMA350[i] !== 0)
    ? v / (2 * dSMA350[i]) : NaN);
  const dPiBuy   = dPiRatio.map(v=> Number.isFinite(v) && v <= 0.30);

  // Absolute MVRV-Z buy at row level (already provided in rows)
  const rMvrvBuy = Array.isArray(rows) ? rows.map(r => (r.mvrvz !== undefined && r.mvrvz <= 0)) : [];

  // Bollinger Bands (20d) — lower band only is used downstream
  const dBBma    = sma(dClose, 20);
  const dBBsd    = std(dClose, 20);
  const dBBlower = dBBma.map((m,i)=> (Number.isFinite(m) && Number.isFinite(dBBsd[i])) ? (m - 2 * dBBsd[i]) : NaN);

  // MACD daily 12/26/9 and bullish cross
  const { macd: dMACD, signal: dMACDsig } = macdLine(dClose, 12, 26, 9);
  const dMACDcross = dMACD.map((m,i)=> (i>0 && Number.isFinite(m) && Number.isFinite(dMACDsig[i]) &&
                                        Number.isFinite(dMACD[i-1]) && Number.isFinite(dMACDsig[i-1]) &&
                                        m > dMACDsig[i] && dMACD[i-1] <= dMACDsig[i-1]));

  // RSI daily (14)
  const dRSI = rsi(dClose, 14);

  // SMA stack persistence: 5 consecutive days of (SMA30 > SMA90 && SMA7 > SMA30)
  const condToday = dSMA30.map((v,i)=> (Number.isFinite(v) && Number.isFinite(dSMA90[i]) && Number.isFinite(dSMA7[i]) &&
                                        v > dSMA90[i] && dSMA7[i] > v));
  const dSmaStack = new Array(n).fill(false);
  let run = 0, persist = 5;
  for (let i=0;i<n;i++){
    run = condToday[i] ? run + 1 : 0;
    if (run >= persist) dSmaStack[i] = true;
  }

  // Previous 30d low + uptrend (90d SMA slope > 0 on daily)
  const roll = 30;
  const dRollLow = new Array(n).fill(NaN);
  for (let i=roll-1;i<n;i++){
    let m = Infinity;
    for (let j=i-roll+1;j<=i;j++){ const l = dLow[j]; if (Number.isFinite(l)) m = Math.min(m, l); }
    dRollLow[i] = m;
  }
  const slope90 = slope(dSMA90.map(v=> Number.isFinite(v) ? v : NaN), 10);
  const up90    = slope90.map(v=> Number.isFinite(v) && v > 0);
  const dTouchPrev30 = dLow.map((v,i)=> i>0 && Number.isFinite(dRollLow[i-1]) && Number.isFinite(v) && v <= dRollLow[i-1]);
  const dPrev30LowUp = dTouchPrev30.map((t,i)=> !!(t && up90[i]));

  return {
    dClose, dLow,
    dSMA7, dSMA30, dSMA90, dSMA111, dSMA350,
    dPiRatio, dPiBuy, rMvrvBuy,
    dBBlower,
    dMACD, dMACDsig, dMACDcross,
    dRSI,
    dSmaStack,
    dPrev30LowUp
  };
}

/**
 * Expand a daily array to row resolution using rowToDay index map.
 * @param {number[]} arrDaily
 * @param {number[]} rowToDay    // same length as rows
 * @returns {number[]} expanded array aligned to rows
 */
export function expandDaily(arrDaily, rowToDay) {
  return rowToDay.map((dIdx)=> arrDaily[dIdx]);
}
