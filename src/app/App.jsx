import React, { useMemo, useRef, useState, useEffect } from "react";
import Papa from "papaparse";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

/**
 * Crypto Confidence Backtester – robust build (full file)
 * ------------------------------------------------------
 * • Upload CSV: either (a) Binance kline CSV (12 cols, no header),
 *   or (b) headered CSV: date,open,high,low,close,volume[,mvrvz]
 * • Indicators computed on UTC-daily resample and projected to 1h display.
 * • Charts aggregated to 4h for rendering; buy logic remains 1h.
 * • Absolute signals (PI≤0.30, MVRV‑Z≤0) short-circuit to 100.
 * • Sliders are INDEPENDENT (no conservation); blended score normalises
 *   by the sum of currently selected slider weights.
 * • FIX: Avoid Papa's stream path ("readable") by parsing **strings**, not File/Blob directly.
 * • Extra guards to avoid rendering with undefined/empty datasets.
 */

// ---------------- Types ----------------
type Row = {
  date: string | number;
  open: number; high: number; low: number; close: number; volume: number; mvrvz?: number;
};

type ParsedRow = Row & { ts: number; dateISO: string };

type Weights = {
  bollinger: number;
  macd: number;
  vsa: number;
  smaStack: number;
  prevLowUp: number;
  rsi10: number; rsi20: number; rsi30: number;
  piDeep: number; // experimental: PI < 0.125 strong buy
};

const DEFAULT_WEIGHTS: Weights = {
  bollinger: 1.0,
  macd: 1.0,
  vsa: 1.0,
  smaStack: 1.5,
  prevLowUp: 1.0,
  rsi10: 1.5,
  rsi20: 1.2,
  rsi30: 1.0,
  piDeep: 2.0, // default mid-strong influence
};

const ABSOLUTE_CAP = 100;
const BLENDED_CAP = 99.9;
const BARS_PER_DAY = 24; // 1h bars (raw data)
const MS_PER_DAY = 86400000;
const SYNC_ID = "sync-confidence";

// ---------------- Epoch normalizer (handles s/ms/µs/ns) ----------------
function normalizeEpochToMs(x: number | null | undefined): number | null {
  if (x === null || x === undefined) return null;
  if (!Number.isFinite(x as number)) return null;
  const v = Math.abs(x as number);
  if (v >= 1e18) return Math.trunc((x as number) / 1e6);  // nanoseconds → ms
  if (v >= 1e15) return Math.trunc((x as number) / 1e3);  // microseconds → ms
  if (v >= 1e12) return Math.trunc(x as number);          // milliseconds
  if (v >= 1e10) return Math.trunc((x as number) * 1000); // seconds → ms
  return Math.trunc(x as number);
}

// ---------------- Math utils ----------------
const sma = (arr: number[], period: number): number[] => {
  const n = arr.length; const out = new Array(n).fill(NaN);
  if (period <= 1) return arr.slice();
  let acc = 0; for (let i=0;i<n;i++){ acc += arr[i]; if (i>=period) acc -= arr[i-period]; if (i>=period-1) out[i] = acc/period; }
  return out;
};

const ema = (arr: number[], period: number): number[] => {
  const n = arr.length; const out = new Array(n).fill(NaN);
  if (n===0) return out; if (period<=1) return arr.slice();
  const k = 2/(period+1);
  let i0 = 0; while (i0<n && !Number.isFinite(arr[i0])) i0++; // seed from first finite
  if (i0===n) return out; out[i0] = arr[i0];
  for (let i=i0+1;i<n;i++){ const v = Number.isFinite(arr[i])?arr[i]:out[i-1]; out[i] = v*k + out[i-1]*(1-k); }
  return out;
};

const std = (arr: number[], period: number): number[] => {
  const n = arr.length; const out = new Array(n).fill(NaN);
  const mean = sma(arr, period);
  for (let i=period-1;i<n;i++){
    let s = 0; for (let j=i-period+1;j<=i;j++){ const d = arr[j] - mean[i]; s += d*d; }
    out[i] = Math.sqrt(s/period);
  }
  return out;
};

const atr = (high: number[], low: number[], close: number[], period: number): number[] => {
  const n = close.length; const out = new Array(n).fill(NaN);
  if (period <= 0 || n === 0) return out;
  let prevClose = Number.isFinite(close[0]) ? close[0] : NaN;
  let running = 0; let seeded = false; let prevAtr = NaN;
  for (let i=0;i<n;i++){
    const hi = Number.isFinite(high[i]) ? high[i] : NaN;
    const lo = Number.isFinite(low[i]) ? low[i] : NaN;
    const cl = Number.isFinite(close[i]) ? close[i] : prevClose;
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
      if (Number.isFinite(cl)) prevClose = cl;
      continue;
    }
    const trBase = hi - lo;
    const trHigh = Number.isFinite(prevClose) ? Math.abs(hi - prevClose) : trBase;
    const trLow  = Number.isFinite(prevClose) ? Math.abs(lo - prevClose) : trBase;
    const tr = Math.max(trBase, trHigh, trLow);
    if (!seeded){
      running += tr;
      const denom = i + 1;
      out[i] = denom > 0 ? running / denom : NaN;
      if (i + 1 >= period){ seeded = true; prevAtr = out[i]; }
    } else {
      prevAtr = Number.isFinite(prevAtr) ? ((prevAtr * (period - 1)) + tr) / period : tr;
      out[i] = prevAtr;
    }
    if (Number.isFinite(cl)) prevClose = cl;
  }
  return out;
};

// Wilder RSI (14 by default)
const rsi = (arr: number[], period: number): number[] => {
  const n = arr.length; const out = new Array(n).fill(NaN);
  if (n < period + 1 || period < 2) return out;
  const deltas = new Array(n).fill(0);
  for (let i=1;i<n;i++) deltas[i] = arr[i] - arr[i-1];
  let gain = 0; let loss = 0;
  for (let i=1;i<=period;i++){
    const d = deltas[i]; if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  let rs = loss === 0 ? 100 : gain / loss;
  out[period] = 100 - 100 / (1 + rs);
  for (let i=period+1;i<n;i++){
    const d = deltas[i];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    rs = loss === 0 ? 100 : gain / loss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
};

function macdLine(arr: number[], fast=12, slow=26, signal=9){
  const fastE = ema(arr, fast); const slowE = ema(arr, slow);
  const macd = fastE.map((v,i)=> v - slowE[i]);
  const sig = ema(macd, signal);
  return { macd, signal: sig };
}

function slope(arr: number[], window=10){
  const n = arr.length; const out = new Array(n).fill(NaN);
  if (window<2) return out;
  for (let i=window-1;i<n;i++){
    let sumx=0,sumy=0,sumxy=0,sumxx=0, ok=true;
    for (let k=0;k<window;k++){
      const y = arr[i-window+1+k]; if (!Number.isFinite(y)){ ok=false; break; }
      const x = k; sumx+=x; sumy+=y; sumxy+=x*y; sumxx+=x*x;
    }
    if (!ok){ out[i]=NaN; continue; }
    const denom = window*sumxx - sumx*sumx; out[i] = denom===0?NaN:(window*sumxy - sumx*sumy)/denom;
  }
  return out;
}

// ---------------- VSA (enriched) ----------------
const VSA_WINDOW = 24;
const VSA_ACTIVATION = 2.6;
const VSA_WEIGHTS = {
  stopping: 1.6,
  noSupply: 1.1,
  testBar: 1.4,
  shakeout: 2.2,
  climactic: 2.0,
  spring: 2.6,
  demand: 1.7,
  effortResult: 1.2,
} as const;

type VsaComponents = {
  stopping: number[];
  noSupply: number[];
  testBar: number[];
  shakeout: number[];
  climactic: number[];
  spring: number[];
  demand: number[];
  effortResult: number[];
};

type VsaContext = {
  volumeMA: number[];
  volumeSD: number[];
  volumeZ: number[];
  atr: number[];
};

type VsaResult = {
  combined: number[];
  score: number[];
  components: VsaComponents;
  context: VsaContext;
  meta: { weights: typeof VSA_WEIGHTS; activation: number };
};

function vsaSignals(open: number[], high: number[], low: number[], close: number[], volume: number[]): VsaResult {
  const n = close.length;
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

  const volMA = sma(volume, VSA_WINDOW);
  const volSD = std(volume, VSA_WINDOW);
  const atrVals = atr(high, low, close, Math.max(5, Math.round(VSA_WINDOW / 2)));
  const volumeZ = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const hi = high[i];
    const lo = low[i];
    const cl = close[i];
    if (!Number.isFinite(hi) || !Number.isFinite(lo) || !Number.isFinite(cl)) continue;

    const rng = hi - lo;
    if (!Number.isFinite(rng) || rng <= 0) continue;

    const refOpen = Number.isFinite(open[i]) ? open[i] : close[i - 1];
    if (!Number.isFinite(refOpen)) continue;

    const body = Math.abs(cl - refOpen);
    const mid = lo + rng / 2;

    const prevClose = Number.isFinite(close[i - 1]) ? close[i - 1] : NaN;
    const prevOpen = Number.isFinite(open[i - 1]) ? open[i - 1] : prevClose;
    const prevHigh = Number.isFinite(high[i - 1]) ? high[i - 1] : NaN;
    const prevLow = Number.isFinite(low[i - 1]) ? low[i - 1] : NaN;
    const prevRange = Number.isFinite(prevHigh) && Number.isFinite(prevLow) ? prevHigh - prevLow : NaN;

    const isDown = cl < refOpen;
    const isUp = cl > refOpen;

    const longLower = (cl - lo) > 0.55 * rng;
    const narrow = rng > 0 ? (body / rng) < 0.35 : false;
    const ultraNarrow = rng > 0 ? (body / rng) < 0.2 : false;

    const ma = volMA[i];
    const sd = volSD[i];
    const atrVal = atrVals[i];

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
      && Number.isFinite(close[i - 1])
      && Number.isFinite(close[i - 2])
      && Number.isFinite(close[i - 3])
      && close[i - 1] <= close[i - 2]
      && close[i - 2] <= close[i - 3];

    const prevLows: number[] = [];
    if (Number.isFinite(prevLow)) prevLows.push(prevLow);
    if (i >= 2 && Number.isFinite(low[i - 2])) prevLows.push(low[i - 2]);
    const minPrevLow = prevLows.length ? Math.min(...prevLows) : Infinity;
    const madeLowerLow = lo < minPrevLow;

    const sv = isDown && hv && cl >= mid;
    const ns = (isDown || cl <= prevClose) && (lv || ultraLv) && (narrow || ultraNarrow) && cl <= lo + 0.25 * rng;
    const tst = (narrow || ultraNarrow) && (lv || ultraLv) && closingStrong && Number.isFinite(prevOpen) && Number.isFinite(prevClose)
      && prevClose < prevOpen;
    const sho = (hv || ultraHv) && longLower && isUp && Number.isFinite(prevClose) && cl > prevClose;
    const clim = ultraHv && isDown && closingStrong && veryWide;
    const spr = (hv || ultraHv) && madeLowerLow && closingStrong && Number.isFinite(prevClose) && cl > prevClose;
    const dem = (hv || ultraHv) && isUp && closingStrong && downTrend
      && Number.isFinite(prevClose) && cl > prevClose
      && (Number.isFinite(prevRange) ? rng >= prevRange * 0.9 : true);
    const eff = (hv || ultraHv) && isDown && closingStrong && smallResult;

    let sc = 0;
    if (sv) { stopping[i] = 1; sc += VSA_WEIGHTS.stopping; }
    if (ns) { noSupply[i] = 1; sc += VSA_WEIGHTS.noSupply; }
    if (tst) { testBar[i] = 1; sc += VSA_WEIGHTS.testBar; }
    if (sho) { shakeout[i] = 1; sc += VSA_WEIGHTS.shakeout; }
    if (clim) { climactic[i] = 1; sc += VSA_WEIGHTS.climactic; }
    if (spr) { spring[i] = 1; sc += VSA_WEIGHTS.spring; }
    if (dem) { demand[i] = 1; sc += VSA_WEIGHTS.demand; }
    if (eff) { effortResult[i] = 1; sc += VSA_WEIGHTS.effortResult; }

    score[i] = sc;
    combined[i] = sc >= VSA_ACTIVATION ? 1 : 0;
  }

  return {
    combined,
    score,
    components: { stopping, noSupply, testBar, shakeout, climactic, spring, demand, effortResult },
    context: { volumeMA: volMA, volumeSD: volSD, volumeZ, atr: atrVals },
    meta: { weights: VSA_WEIGHTS, activation: VSA_ACTIVATION },
  };
}

// ---------------- Scoring (independent sliders) ----------------
function scoreBar(i: number, ctx: any){
  if (ctx.piBuy[i] || ctx.mvrvzBuy[i]) return { confidence: ABSOLUTE_CAP, parts: null };
  const parts: Record<string, number> = {};
  let raw=0, maxRaw=0;
  const add = (k: string, active: boolean, w: number) => { const v = active? w: 0; raw += v; maxRaw += w; parts[k]=v; };

  add("bollinger", ctx.touchLower[i], ctx.weights.bollinger);
  add("macd", ctx.macdCross[i], ctx.weights.macd);

  const r = ctx.rsi[i];
  if (Number.isFinite(r)){
    if (r<=10) add("rsi", true, ctx.weights.rsi10);
    else if (r<=20) add("rsi", true, ctx.weights.rsi20);
    else if (r<=30) add("rsi", true, ctx.weights.rsi30); else parts["rsi"]=0;
  } else parts["rsi"]=0;

  const vsaStrength = ctx.vsaScore ? ctx.vsaScore[i] : undefined;
  const hasStrength = typeof vsaStrength === "number" && Number.isFinite(vsaStrength);
  const vsaActive = hasStrength ? vsaStrength >= VSA_ACTIVATION : ctx.vsa[i] === 1;
  add("vsa", vsaActive, ctx.weights.vsa);
  add("smaStack", ctx.smaStack[i], ctx.weights.smaStack);
  add("prevLowUp", ctx.prevLowUp[i], ctx.weights.prevLowUp);

  // Experimental PI deep-buy: PI < 0.125
  add("piDeep", ctx.piDeep[i], ctx.weights.piDeep);

  const confidence = maxRaw===0 ? 0 : Math.min(BLENDED_CAP, (raw/maxRaw)*BLENDED_CAP);
  return { confidence, parts };
}

// ---------------- 4h aggregation (OHLCV + last-known indicators) ----------------
function aggregate4h(rows: ParsedRow[], extras: Record<string, number[]>)
{
  if (!rows.length) return [] as any[];
  const FOUR_H = 4*60*60*1000; const out: any[]=[];
  let bucket = Math.floor(rows[0].ts/FOUR_H)*FOUR_H; let cur: any | null = null;
  const push = ()=>{ if (cur) out.push(cur); };
  for (let i=0;i<rows.length;i++){
    const r = rows[i]; const key = Math.floor(r.ts/FOUR_H)*FOUR_H;
    if (!cur || key!==bucket){ push(); bucket = key; cur = { ts:key, open:r.open, high:r.high, low:r.low, close:r.close, volume:r.volume };
    } else { cur.high=Math.max(cur.high,r.high); cur.low=Math.min(cur.low,r.low); cur.close=r.close; cur.volume += r.volume; }
    for (const k of Object.keys(extras)) if (extras[k]) (cur as any)[k] = (extras as any)[k][i];
  }
  push();
  return out;
}

// ---------------- Daily resample (UTC) ----------------
function resampleDaily(rows: ParsedRow[]){
  if (!rows.length) return { daily: [] as any[], rowToDay: [] as number[] };
  const daily: { ts:number, open:number, high:number, low:number, close:number }[] = [];
  const rowToDay: number[] = new Array(rows.length).fill(0);
  let currentKey = Math.floor(rows[0].ts / MS_PER_DAY) * MS_PER_DAY;
  let cur = { ts: currentKey, open: rows[0].open, high: rows[0].high, low: rows[0].low, close: rows[0].close };
  let dayIndex = 0;
  for (let i=0;i<rows.length;i++){
    const dkey = Math.floor(rows[i].ts / MS_PER_DAY) * MS_PER_DAY;
    if (dkey !== currentKey){
      daily.push(cur); dayIndex++; currentKey = dkey; cur = { ts: dkey, open: rows[i].open, high: rows[i].high, low: rows[i].low, close: rows[i].close };
    } else {
      cur.high = Math.max(cur.high, rows[i].high);
      cur.low = Math.min(cur.low, rows[i].low);
      cur.close = rows[i].close;
    }
    rowToDay[i] = dayIndex;
  }
  daily.push(cur);
  return { daily, rowToDay };
}

// ---------------- CSV Parsing (strict + normalized) ----------------
function parseHeadered(data: any[]): ParsedRow[]{
  const out: ParsedRow[]=[]; const MS_PER_DAY_LOCAL = 86400000; const excelToMs = (d:number)=> (d-25569)*MS_PER_DAY_LOCAL;

  const isISOish = (s: string) =>
    /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z)?)?$/i.test(s);
  const isPureUnix = (s: string) =>
    /^\d{10}$/.test(s) || /^\d{13}$/.test(s) || /^\d{16,17}$/.test(s);
  const isExcelSerial = (s: string) =>
    /^\d{5,}(?:\.\d+)?(?:\s+\d{1,2}:\d{2}:\d{2})?$/.test(s);

  for (const d of data){
    if (!d || d.date===undefined || d.date===null || d.date==="") continue;
    let ts: number | null = null;

    if (typeof d.date === "number"){
      ts = normalizeEpochToMs(d.date);
      if (ts && (d.date as number)>20000 && (d.date as number)<90000) ts = excelToMs(d.date as number);
    } else if (typeof d.date === "string"){
      const s = d.date.trim();
      if (isISOish(s)){
        const t = new Date(s).getTime(); if (Number.isFinite(t)) ts=t;
      } else if (isPureUnix(s)){
        ts = normalizeEpochToMs(Number(s));
      } else if (isExcelSerial(s)){
        const [serStr, timeStr] = s.split(/\s+/, 2);
        const serial = Number(serStr);
        if (Number.isFinite(serial)) {
          ts = excelToMs(serial);
          if (timeStr){
            const [hh,mm,ss] = timeStr.split(":").map(v=>parseInt(v||"0",10));
            ts += (((hh*60+mm)*60+ss)*1000);
          }
        }
      } else {
        const t = new Date(s).getTime(); if (Number.isFinite(t)) ts=t;
      }
    }

    if (ts===null || !Number.isFinite(ts)) continue;
    out.push({ ts, dateISO: new Date(ts).toISOString(), open:+d.open, high:+d.high, low:+d.low, close:+d.close, volume:+d.volume, mvrvz:(d.mvrvz!==undefined && d.mvrvz!=="" ? +d.mvrvz : undefined), date: d.date });
  }
  out.sort((a,b)=>a.ts-b.ts); return out;
}

function parseBinance(data: any[][]): ParsedRow[]{
  const out: ParsedRow[]=[];
  for (const row of data){
    if (!row || row.length<6) continue;
    const raw = Number(row[0]);
    const ms = normalizeEpochToMs(raw);
    if (!Number.isFinite(ms as number)) continue;
    out.push({
      ts: ms as number,
      dateISO: new Date(ms as number).toISOString(),
      open:+row[1], high:+row[2], low:+row[3], close:+row[4], volume:+row[5],
      date: raw
    });
  }
  out.sort((a,b)=>a.ts-b.ts); return out;
}

// ---------------- Component ----------------
export default function App(){
  const [rows,setRows] = useState<ParsedRow[]|null>(null);
  const [threshold,setThreshold] = useState(80);
  const [buyWindowHours,setBuyWindowHours] = useState(30*24);
  const [windowDays,setWindowDays] = useState(365); // default 12 months
  const [windowOffsetDays,setWindowOffsetDays] = useState(0); // 0 = end of series
  const [weights,setWeights] = useState<Weights>({...DEFAULT_WEIGHTS});
  const fileRef = useRef<HTMLInputElement>(null); const [fileName,setFileName] = useState("");

  // Independent sliders (no conservation)
  const setWeight = (key: keyof Weights, value: number)=>{
    const clamp = (x:number)=> Math.max(0, Math.min(5, x));
    setWeights(w => ({...w, [key]: clamp(value)}));
  };

  async function parseCSV(file: File){
    if (!file) return;
    setFileName(file.name);
    const text = await file.text(); // Avoid Papa stream path (no File/Blob input)
    // First, parse as arrays (no header) to sniff Binance format
    const sniff = Papa.parse(text, { header:false, dynamicTyping:true, skipEmptyLines:true });
    const first = (sniff.data as any[])[0];
    if (Array.isArray(first) && first.length>=6 && Number.isFinite(Number(first[0]))){
      // Treat as Binance CSV (array rows)
      const asArrays = sniff.data as any[][];
      setRows(parseBinance(asArrays));
      return;
    }
    // Else, parse as headered objects
    const parsed = Papa.parse(text, { header:true, dynamicTyping:true, skipEmptyLines:true });
    setRows(parseHeadered(parsed.data as any[]));
  }

  // ---------------- Compute (full history first, then slice) ----------------
  const computed = useMemo(()=>{
    if (!rows || rows.length===0) return null;

    // Daily resample once
    const { daily, rowToDay } = resampleDaily(rows);
    if (!daily.length) return null;

    const dClose = daily.map(d=>d.close);
    const dLow   = daily.map(d=>d.low);

    // --- Daily indicators ---
    const dSMA7   = sma(dClose, 7);
    const dSMA30  = sma(dClose, 30);
    const dSMA90  = sma(dClose, 90);
    const dSMA111 = sma(dClose,111);
    const dSMA350 = sma(dClose,350);

    // PI & MVRV (absolute)
    const dPiRatio = dSMA111.map((v,i)=> Number.isFinite(v) && Number.isFinite(dSMA350[i]) && dSMA350[i]!==0 ? v/(2*dSMA350[i]) : NaN);
    const dPiBuy   = dPiRatio.map(v=> Number.isFinite(v) && v<=0.30);
    const rMvrvBuy= rows.map(r=> r.mvrvz!==undefined && r.mvrvz<=0); // already row-level

    // Bollinger 20d
    const dBBma = sma(dClose, 20); const dBBsd = std(dClose, 20);
    const dBBlower = dBBma.map((m,i)=> Number.isFinite(m)&&Number.isFinite(dBBsd[i]) ? m - 2*dBBsd[i] : NaN);

    // MACD daily 12/26/9
    const { macd: dMACD, signal: dMACDsig } = macdLine(dClose, 12, 26, 9);
    const dMACDcross = dMACD.map((m,i)=> i>0 && Number.isFinite(m)&&Number.isFinite(dMACDsig[i]) && Number.isFinite(dMACD[i-1])&&Number.isFinite(dMACDsig[i-1]) && m> dMACDsig[i] && dMACD[i-1] <= dMACDsig[i-1]);

    // RSI daily 14
    const dRSI = rsi(dClose, 14);

    // SMA stack persistence: 5 consecutive days
    const condToday = dSMA30.map((v,i)=> Number.isFinite(v)&&Number.isFinite(dSMA90[i])&&Number.isFinite(dSMA7[i]) && v> dSMA90[i] && dSMA7[i] > v);
    const dSmaStack = new Array(daily.length).fill(false); let run=0; const persist=5; for (let i=0;i<daily.length;i++){ run = condToday[i]? run+1:0; if (run>=persist) dSmaStack[i]=true; }

    // Previous 30d low + uptrend (90d SMA slope > 0 on daily)
    const roll=30; const dRollLow = new Array(daily.length).fill(NaN);
    for (let i=roll-1;i<daily.length;i++){ let m=Infinity; for (let j=i-roll+1;j<=i;j++) m=Math.min(m,dLow[j]); dRollLow[i]=m; }
    const slope90 = slope(dSMA90.map(v=> Number.isFinite(v)?v:NaN), 10);
    const up90 = slope90.map(v=> Number.isFinite(v)&&v>0);
    const dTouchPrev30 = dLow.map((v,i)=> i>0 && Number.isFinite(dRollLow[i-1]) && v<=dRollLow[i-1]);
    const dPrev30LowUp = dTouchPrev30.map((t,i)=> t && up90[i]);

    // --- Expand daily arrays to row resolution ---
    const expand = (arr:number[]) => rows.map((_,i)=> arr[rowToDay[i]]);

    const piBuy      = expand(dPiBuy);
    const piRatioRow = expand(dPiRatio);
    const mvrvzBuy   = rMvrvBuy; // already row-aligned
    const bbLowerRow = expand(dBBlower);
    const rsiRow     = expand(dRSI);
    const macdRow    = expand(dMACD);
    const macdSigRow = expand(dMACDsig);
    const macdCross  = expand(dMACDcross).map(Boolean);
    const sma7Row    = expand(dSMA7);
    const sma30Row   = expand(dSMA30);
    const sma90Row   = expand(dSMA90);
    const smaStack   = expand(dSmaStack).map(Boolean);
    const prev30LowUp= expand(dPrev30LowUp).map(Boolean);

    // Bollinger touch (row-level close vs daily lower band)
    const touchLower = rows.map((r,i)=> Number.isFinite(bbLowerRow[i]) && r.close <= bbLowerRow[i]);

    // VSA on raw 1h bars
    const open = rows.map(r=>r.open), high=rows.map(r=>r.high), low=rows.map(r=>r.low), vol=rows.map(r=>r.volume);
    const { combined: vsaCombined, score: vsaScoreFull } = vsaSignals(open,high,low,rows.map(r=>r.close),vol);

    // --- Windowing (pan + zoom) ---
    const firstTs = rows[0].ts; const lastTs = rows[rows.length-1].ts;
    const maxSpanDays = Math.max(1, Math.floor((lastTs-firstTs)/MS_PER_DAY));
    const wndDays = Math.min(windowDays, maxSpanDays);
    const offsetClamped = Math.min(Math.max(0, windowOffsetDays), Math.max(0, maxSpanDays - wndDays));

    const startTs = Math.max(firstTs, lastTs - (offsetClamped + wndDays)*MS_PER_DAY);
    const endTs   = Math.min(lastTs,  startTs + wndDays*MS_PER_DAY);
    const startIdx = rows.findIndex(r=> r.ts >= startTs);
    const endIdx   = rows.findIndex(r=> r.ts > endTs);
    const s = startIdx >= 0 ? startIdx : 0;
    const e = endIdx === -1 ? rows.length : endIdx;

    const visRows = rows.slice(s, e);
    const n = visRows.length;
    const ctx = {
      piBuy: piBuy.slice(s,e), mvrvzBuy: mvrvzBuy.slice(s,e), touchLower: touchLower.slice(s,e),
      macdCross: macdCross.slice(s,e), rsi: rsiRow.slice(s,e), vsa: vsaCombined.slice(s,e),
      vsaScore: vsaScoreFull.slice(s,e),
      smaStack: smaStack.slice(s,e), prevLowUp: prev30LowUp.slice(s,e),
      piDeep: piRatioRow.slice(s,e).map(v=> Number.isFinite(v) && v < 0.125),
      weights
    };

    // Confidence & parts
    const confidence = new Array(n).fill(0) as number[]; const partsArr = new Array(n).fill(null) as any[];
    for (let i=0;i<n;i++){ const { confidence:c, parts } = scoreBar(i, ctx); confidence[i]=c; partsArr[i]=parts; }

    // Buys with cooldown (first cross-up) (should not shift domain)
    const cooldownMs = buyWindowHours*60*60*1000; const buys: any[]=[]; let lastBuyTs = -Infinity;
    for (let i=1;i<n;i++){
      const ts = visRows[i].ts; const cross = confidence[i]>=threshold && confidence[i-1]<threshold; if (cross && ts-lastBuyTs>=cooldownMs){ buys.push({ index:i, ts, conf: confidence[i], parts: partsArr[i] }); lastBuyTs = ts; }
    }

    // Build 4h display aligned with slice using expanded indicators
    const extras = { rsi: rsiRow.slice(s,e), macd: macdRow.slice(s,e), macdSig: macdSigRow.slice(s,e), sma7: sma7Row.slice(s,e), sma30: sma30Row.slice(s,e), sma90: sma90Row.slice(s,e), pi: piRatioRow.slice(s,e) };
    const display4h = aggregate4h(visRows, extras);

    return { visRows, display4h, buys, confidence, firstTs, lastTs, wndDays, offsetClamped };
  }, [rows, windowDays, windowOffsetDays, threshold, buyWindowHours, weights]);

  const buyLines4h = useMemo(()=>{
    if (!computed) return [] as number[]; const FOUR_H = 4*60*60*1000; return computed.buys.map(b=> Math.floor(b.ts/FOUR_H)*FOUR_H);
  }, [computed]);

  // ---------------- UI helpers ----------------
  const formatDateShort = (ts:number)=>{ const d = new Date(ts); const y=d.getUTCFullYear(); const m=String(d.getUTCMonth()+1).padStart(2,'0'); const day=String(d.getUTCDate()).padStart(2,'0'); return `${y}-${m}-${day}`; };
  const formatDate = (ts:number)=> new Date(ts).toISOString().slice(0,16).replace("T"," ");

  // Self-tests to catch regressions (acts as simple test cases)
  useEffect(()=>{
    try {
      // Indicator sanity on simple deterministic series
      const t = Array.from({length:200},(_,i)=> 100+Math.sin(i/7)*2 + (i/500));
      const _r = rsi(t,14); const _m = macdLine(t,12,26,9); if (!_r || !_m.macd || !_m.signal) throw new Error("Indicators failed");
      // Daily resample ordering
      const base = 1700000000000; // fixed epoch
      const demo: ParsedRow[] = [0,1,2,3,4,5].map(h=> ({ ts: base + h*3600000, dateISO: new Date(base + h*3600000).toISOString(), open:1,high:1,low:1,close:1,volume:1, date: base + h*3600000 }));
      const rd = resampleDaily(demo); if (!rd.daily.length) throw new Error("Daily resample produced 0 length");
      // Buy lines test: floor-to-4h aligns with domain
      const FOUR_H = 4*60*60*1000;
      const lines = [0,1,2,3,4,5].map(i=> Math.floor((base + i*FOUR_H)/FOUR_H)*FOUR_H);
      if (new Set(lines).size !== lines.length) throw new Error("Buy lines dedupe failure");
    } catch(err){ console.warn("Self-test failed", err); }
  },[]);

  const hasData = !!computed && Array.isArray(computed.display4h) && computed.display4h.length>0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Crypto Confidence Backtester</h1>
        <div className="flex gap-2 items-center">
          <input id="file" ref={fileRef} type="file" accept=".csv" className="hidden" onChange={async (e)=>{ if (!e.target.files || e.target.files.length===0) return; const f=e.target.files[0]; await parseCSV(f); }}/>
          <button className="px-4 py-2 rounded-xl shadow bg-black text-white" onClick={()=>fileRef.current?.click()}>Choose CSV</button>
          <input type="text" readOnly value={fileName||"No file chosen"} className="px-3 py-2 rounded-xl border bg-white/70 text-sm w-64" />
        </div>
      </header>

      {computed && (
        <div className="text-xs text-gray-700 bg-yellow-50 border border-yellow-200 rounded p-2">
          First: {new Date(computed.firstTs).toISOString()} | Last: {new Date(computed.lastTs).toISOString()}
        </div>
      )}

      <div className="grid md:grid-cols-12 gap-4">
        {/* Sidebar ~1/3 */}
        <aside className="md:col-span-4 space-y-4">
          <div className="p-4 rounded-2xl shadow bg-white/60 border">
            <h2 className="font-semibold mb-2">Scoring Controls</h2>
            <div className="text-sm">Master threshold: <b>{threshold}</b></div>
            <input type="range" min={0} max={100} step={0.1} value={threshold} onChange={e=>setThreshold(parseFloat(e.target.value))} className="w-full"/>
            <div className="mt-3 text-sm">Max buy window (hours): <b>{buyWindowHours}</b></div>
            <input type="range" min={24} max={90*24} step={24} value={buyWindowHours} onChange={e=>setBuyWindowHours(parseInt(e.target.value))} className="w-full"/>
            <p className="text-xs text-gray-600 mt-1">Cooldown between buys (e.g. 720 ≈ 30 days).</p>
            <div className="mt-3 text-sm">Visible window (days): <b>{windowDays}</b></div>
            <input type="range" min={30} max={1100} step={5} value={windowDays} onChange={e=>setWindowDays(parseInt(e.target.value))} className="w-full"/>
            <div className="mt-3 text-sm">Offset from end (days): <b>{windowOffsetDays}</b></div>
            <input type="range" min={0} max={1100} step={5} value={windowOffsetDays} onChange={e=>setWindowOffsetDays(parseInt(e.target.value))} className="w-full"/>
          </div>

          <div className="p-4 rounded-2xl shadow bg-white/60 border">
            <h2 className="font-semibold mb-2">Weights</h2>
            {(["bollinger","macd","vsa","smaStack","prevLowUp"] as (keyof Weights)[]).map(k=> (
              <div key={k} className="mb-3">
                <div className="flex justify-between text-sm"><span>{k}</span><span>{weights[k].toFixed(2)}</span></div>
                <input type="range" min={0} max={5} step={0.05} value={weights[k]} onChange={(e)=>setWeight(k, parseFloat(e.target.value))} className="w-full"/>
              </div>
            ))}
            <div className="text-xs text-gray-600">RSI band weights</div>
            {["rsi10","rsi20","rsi30"].map((k)=> (
              <div key={k} className="mb-2">
                <div className="flex justify-between text-sm"><span>{k}</span><span>{(weights as any)[k].toFixed(2)}</span></div>
                <input type="range" min={0} max={5} step={0.05} value={(weights as any)[k]} onChange={(e)=>setWeight(k as keyof Weights, parseFloat(e.target.value))} className="w-full"/>
              </div>
            ))}
            <div className="text-xs text-gray-600 mt-3">Experimental</div>
            <div className="mb-2">
              <div className="flex justify-between text-sm"><span>PI deep-buy (PI &lt; 0.125)</span><span>{weights.piDeep.toFixed(2)}</span></div>
              <input type="range" min={0} max={5} step={0.05} value={weights.piDeep} onChange={(e)=>setWeight("piDeep", parseFloat(e.target.value))} className="w-full"/>
            </div>
            <p className="text-xs text-gray-600 mt-1">Absolute: PI≤0.30, MVRV‑Z≤0 → confidence 100.</p>
          </div>
        </aside>

        {/* Main area ~2/3 */}
        <main className="md:col-span-8 space-y-4">
          <section className="p-4 rounded-2xl shadow bg-white/60 border">
            <h2 className="font-semibold mb-3">Price</h2>
            {!hasData ? <div className="text-gray-500 text-sm">Upload data to see charts.</div> : (
              <div className="h-[480px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={computed!.display4h} margin={{top:10,right:20,left:10,bottom:10}} syncId={SYNC_ID}>
                    <CartesianGrid strokeDasharray="3 3"/>
                    <XAxis type="number" dataKey="ts" tickFormatter={(v)=>formatDateShort(v as number)} domain={["dataMin","dataMax"]} minTickGap={16}/>
                    <YAxis yAxisId="price" domain={["auto","auto"]}/>
                    <YAxis yAxisId="pi" orientation="right" domain={[0,1]} tickFormatter={(v)=>Number(v).toFixed(2)} allowDecimals/>
                    <Tooltip formatter={(v:any,n:string)=>[typeof v === "number" ? Number(v).toFixed(2) : v, n]} labelFormatter={(l)=>new Date(l as number).toISOString().replace("T"," ").slice(0,16)}/>
                    <Line yAxisId="price" type="monotone" dataKey="close" name="Close (4h)" dot={false} strokeWidth={2}/>
                    <Line yAxisId="price" type="monotone" dataKey="sma7" name="SMA 7d" dot={false} strokeDasharray="4 2"/>
                    <Line yAxisId="price" type="monotone" dataKey="sma30" name="SMA 30d" dot={false} strokeDasharray="3 3"/>
                    <Line yAxisId="price" type="monotone" dataKey="sma90" name="SMA 90d" dot={false} strokeDasharray="6 2"/>
                    <Line yAxisId="pi" type="monotone" dataKey="pi" name="PI (111/(2*350))" dot={false} strokeWidth={1.5} stroke="#ec4899"/>
                    <ReferenceLine yAxisId="pi" y={0.3} stroke="#ec4899" strokeDasharray="4 2" ifOverflow="clip" />
                    {(buyLines4h as number[]).filter(ts=>Number.isFinite(ts)).map((ts,i)=>(
                      <ReferenceLine key={i} xAxisId={0} x={ts} stroke="green" strokeDasharray="6 4" label={{value:"BUY",position:"top",fill:"green"}} ifOverflow="extendDomain"/>
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {hasData && (
            <section className="p-4 rounded-2xl shadow bg-white/60 border">
              <h2 className="font-semibold mb-3">RSI (14d)</h2>
              <div className="h-[160px] mb-3">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={computed!.display4h} margin={{top:5,right:20,left:10,bottom:5}} syncId={SYNC_ID}>
                    <CartesianGrid strokeDasharray="3 3"/>
                    <XAxis type="number" dataKey="ts" tickFormatter={(v)=>formatDateShort(v as number)} domain={["dataMin","dataMax"]} minTickGap={16}/>
                    <YAxis domain={[0,100]}/>
                    <ReferenceLine y={30} stroke="#9ca3af" strokeDasharray="3 3" ifOverflow="clip"/>
                    <ReferenceLine y={70} stroke="#9ca3af" strokeDasharray="3 3" ifOverflow="clip"/>
                    <Tooltip formatter={(v:any)=>[typeof v === "number" ? Number(v).toFixed(2) : v,"RSI (14d)"]} labelFormatter={(l)=>new Date(l as number).toISOString().replace("T"," ").slice(0,16)}/>
                    <Line type="monotone" dataKey="rsi" name="RSI (14d)" dot={false} strokeWidth={1.5}/>
                    {(buyLines4h as number[]).map((ts,i)=>(
                      <ReferenceLine key={i} x={ts} stroke="green" strokeDasharray="6 4" ifOverflow="extendDomain"/>
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <h2 className="font-semibold mb-3">MACD (12/26/9 daily)</h2>
              <div className="h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={computed!.display4h} margin={{top:5,right:20,left:10,bottom:5}} syncId={SYNC_ID}>
                    <CartesianGrid strokeDasharray="3 3"/>
                    <XAxis type="number" dataKey="ts" tickFormatter={(v)=>formatDateShort(v as number)} domain={["dataMin","dataMax"]} minTickGap={16}/>
                    <YAxis domain={["auto","auto"]}/>
                    <Tooltip labelFormatter={(l)=>new Date(l as number).toISOString().replace("T"," ").slice(0,16)}/>
                    <Line type="monotone" dataKey="macd" name="MACD" dot={false} strokeWidth={1.5}/>
                    <Line type="monotone" dataKey="macdSig" name="Signal" dot={false} strokeWidth={1.2} strokeDasharray="4 2"/>
                    {(buyLines4h as number[]).map((ts,i)=>(
                      <ReferenceLine key={i} x={ts} stroke="green" strokeDasharray="6 4" ifOverflow="extendDomain"/>
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {hasData && (
            <section className="p-4 rounded-2xl shadow bg-white/60 border">
              <h2 className="font-semibold mb-3">Buy Signals</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left border-b"><th className="py-2 pr-4">Date (1h)</th><th className="py-2 pr-4">Confidence</th><th className="py-2 pr-4">Contributors</th></tr>
                  </thead>
                  <tbody>
                    {computed!.buys.map((b: any, idx: number)=> (
                      <tr key={idx} className="border-b hover:bg-gray-50">
                        <td className="py-2 pr-4 whitespace-nowrap">{formatDate(b.ts)}</td>
                        <td className="py-2 pr-4">{b.conf.toFixed(2)}</td>
                        <td className="py-2 pr-4">{b.parts ? (
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(b.parts).filter(([,v])=> (v as number)>0).map(([k,v])=> (
                              <span key={k} className="px-2 py-1 rounded-full bg-green-100 text-green-700">{k}: {(v as number).toFixed(2)}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-500">Absolute</span>
                        )}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <footer className="text-xs text-gray-500">Hover charts to see synced cursor. Green dashed lines = BUY. Adjust threshold, weights, cooldown, window size and offset to explore entries. PI line shows the 111/(2*350) ratio on right axis; dashed 0.30 line is the absolute rule. Experimental PI deep-buy fires when PI &lt; 0.125 (weighted by its slider).</footer>
        </main>
      </div>
    </div>
  );
}
