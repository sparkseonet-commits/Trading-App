// src/engine/signals.js
// Row-level (1h) signal construction using expanded daily indicators and raw rows.

import { vsaSignals } from "../indicators/vsa";

/**
 * Build per-row boolean/series signals used by scoring and chart display.
 * @param {Array<{ts:number,open:number,high:number,low:number,close:number,volume:number}>} rows
 * @param {{
 *   dBBlowerRow:number[], dRSIRow:number[], dMACDRow:number[], dMACDSigRow:number[], dMACDCrossRow:boolean[],
 *   dSMA7Row:number[], dSMA30Row:number[], dSMA90Row:number[],
 *   dSmaStackRow:boolean[], dPrev30LowUpRow:boolean[],
 *   dPiBuyRow:boolean[], dPiRatioRow:number[],
 *   rMvrvBuyRow:boolean[]
 * }} dailyToRow
 */
export function buildSignals(rows, dailyToRow){
  const n = rows.length;
  if (!n) return null;

  const bbLowerRow   = dailyToRow.dBBlowerRow;
  const rsiRow       = dailyToRow.dRSIRow;
  const macdRow      = dailyToRow.dMACDRow;
  const macdSigRow   = dailyToRow.dMACDSigRow;
  const macdCross    = dailyToRow.dMACDCrossRow.map(Boolean);
  const sma7Row      = dailyToRow.dSMA7Row;
  const sma30Row     = dailyToRow.dSMA30Row;
  const sma90Row     = dailyToRow.dSMA90Row;
  const smaStack     = dailyToRow.dSmaStackRow.map(Boolean);
  const prevLowUp    = dailyToRow.dPrev30LowUpRow.map(Boolean);
  const piBuy        = dailyToRow.dPiBuyRow;           // absolute
  const piRatioRow   = dailyToRow.dPiRatioRow;
  const mvrvzBuy     = dailyToRow.rMvrvBuyRow;         // absolute

  // Bollinger touch (row-level close vs daily lower band)
  const touchLower = rows.map((r,i)=> Number.isFinite(bbLowerRow[i]) && r.close <= bbLowerRow[i]);

  // VSA on raw 1h bars
  const open = rows.map(r=>r.open), high = rows.map(r=>r.high), low = rows.map(r=>r.low), vol = rows.map(r=>r.volume);
  const { combined: vsaC, score: vsaScore } = vsaSignals(open, high, low, rows.map(r=>r.close), vol);

  return {
    series: {
      rsi: rsiRow,
      macd: macdRow,
      macdSig: macdSigRow,
      macdCross,
      sma7: sma7Row,
      sma30: sma30Row,
      sma90: sma90Row,
      smaStack,
      prevLowUp,
    },
    features: {
      touchLower,
      vsa: vsaC,
      piRatio: piRatioRow,
    },
    absolutes: {
      piBuy,
      mvrvzBuy,
    },
  };
}
