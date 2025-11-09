// src/app/types.d.ts
// Optional typings to improve IntelliSense in JS projects or to migrate to TS later.

export type EpochMs = number;   // Unix epoch in milliseconds
export type EpochSec = number;  // Unix epoch in seconds

export interface Row {
  ts: EpochMs;
  dateISO: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Optional: on-row MVRV-Z value for absolute buy rule */
  mvrvz?: number;
  /** Source date (raw), if provided in CSV */
  date?: string | number;
}

export interface DailyBar {
  ts: EpochMs;   // UTC day open time in ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DailyIndicators {
  dClose: number[];
  dLow: number[];
  dSMA7: number[];
  dSMA30: number[];
  dSMA90: number[];
  dSMA111: number[];
  dSMA350: number[];
  dPiRatio: number[];
  dPiBuy: boolean[];
  /** Already aligned to rows; included here for convenience */
  rMvrvBuy: boolean[];
  dBBlower: number[];
  dMACD: number[];
  dMACDsig: number[];
  dMACDcross: boolean[];
  dRSI: number[];
  dSmaStack: boolean[];
  dPrev30LowUp: boolean[];
}

export interface DailyBundle {
  daily: DailyBar[];
  rowToDay: number[];
}

export interface BuildSignalsOutput {
  series: {
    bbLowerRow: number[];
    rsiRow: number[];
    macdRow: number[];
    macdSigRow: number[];
    macdCross: boolean[];
    sma7Row: number[];
    sma30Row: number[];
    sma90Row: number[];
    smaStack: boolean[];
    prev30LowUp: boolean[];
  };
  absolutes: {
    piBuy: boolean[];
    mvrvzBuy: boolean[];
  };
  features: {
    touchLower: boolean[];
    vsaC: number[];        // 0|1
    piRatioRow: number[];
  };
}

export interface WeightConfig {
  bollinger: number;
  macd: number;
  vsa: number;
  smaStack: number;
  prevLowUp: number;
  rsi10: number;
  rsi20: number;
  rsi30: number;
  piDeep: number;
}

export interface BuyEvent {
  ts: EpochMs;
  confidence: number;
  parts?: Record<string, number>;
}

export interface Display4hBar {
  ts4h: EpochMs;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma7?: number;
  sma30?: number;
  sma90?: number;
  pi?: number;
}
