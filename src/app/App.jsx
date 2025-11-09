// src/app/App.jsx
import React, { useCallback, useMemo, useState } from "react";
import Papa from "papaparse";
import "./app.css";

import { MS_PER_DAY, SYNC_ID, DEFAULT_WEIGHTS } from "./constants";
import { parseHeadered, parseBinance } from "../data/parse";
import { resampleDaily, aggregate4h } from "../data/resample";
import { computeDailyIndicators, expandDaily } from "../indicators/daily";
import { buildSignals } from "../engine/signals";
import { scoreBar } from "../engine/score";

import PriceChart from "../charts/PriceChart";
import RsiChart from "../charts/RsiChart";
import MacdChart from "../charts/MacdChart";
import BuyTable from "../charts/BuyTable";

// ---------------------------------------------------------------------------
// Error boundary to avoid white screen on unexpected runtime errors.
class ErrorBoundary extends React.Component {
  constructor(props){
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(error){
    return { hasError: true, message: String(error?.message || error) };
  }
  componentDidCatch(error, info){
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary:", error, info);
  }
  render(){
    if (this.state.hasError){
      return (
        <div style={{ padding: 16, color: "#991b1b", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12 }}>
          <b>Something went wrong while rendering.</b>
          <div style={{ marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", whiteSpace: "pre-wrap" }}>
            {this.state.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// CSV parsing hook (headered vs Binance array format)
function useParsedRows(format){
  const [rows, setRows] = useState([]);
  const [filename, setFilename] = useState("");
  const [lastError, setLastError] = useState(null);

  const onFile = useCallback(async (file)=>{
    if (!file) return;
    setFilename(file.name);
    try {
      const text = await file.text();
      const baseConfig = { dynamicTyping: true, skipEmptyLines: true };
      if (format === "headered"){
        const parsed = Papa.parse(text, { ...baseConfig, header: true });
        setRows(parseHeadered(parsed.data));
      } else {
        const parsed = Papa.parse(text, { ...baseConfig, header: false });
        setRows(parseBinance(parsed.data));
      }
      setLastError(null);
    } catch (err){
      // eslint-disable-next-line no-console
      console.error("CSV parse error", err);
      setRows([]);
      setLastError(String(err?.message || err));
    }
  }, [format]);

  return { rows, onFile, filename, lastError };
}

// ---------------------------------------------------------------------------
// Utility: sample arbitrary series to 4h buckets (using last value in bucket)
function sampleTo4h(tsSeries, valSeries){
  const FOUR_H = 4 * 60 * 60 * 1000;
  const out = [];
  if (!Array.isArray(tsSeries) || !Array.isArray(valSeries) || !tsSeries.length) return out;
  let bucket = Math.floor(tsSeries[0] / FOUR_H) * FOUR_H;
  let last = valSeries[0];
  for (let i = 0; i < tsSeries.length; i++){
    const t = tsSeries[i];
    const k = Math.floor(t / FOUR_H) * FOUR_H;
    if (k !== bucket){
      out.push({ ts4h: bucket, value: last });
      bucket = k;
    }
    last = valSeries[i];
  }
  out.push({ ts4h: bucket, value: last });
  return out;
}

function mergeSeries(base, overlay, combiner){
  if (!Array.isArray(base) || !base.length) return overlay && overlay.length ? overlay.map((o)=> combiner({}, o)) : [];
  if (!Array.isArray(overlay) || !overlay.length) return base.slice();
  const map = new Map(overlay.map((o)=> [o.ts4h, o]));
  return base.map((b)=> {
    const match = map.get(b.ts4h);
    return match ? combiner(b, match) : { ...b };
  });
}

const toOverlay = (series, key) =>
  Array.isArray(series)
    ? series.map((item)=> ({ ts4h: item.ts4h, [key]: item.value ?? item[key] ?? item }))
    : [];

// ---------------------------------------------------------------------------
export default function App(){
  const [format, setFormat] = useState("binance");
  const { rows, onFile, filename, lastError } = useParsedRows(format);

  const [threshold, setThreshold] = useState(80);
  const [maxBuyWindowH, setMaxBuyWindowH] = useState(720);
  const [cooldownH, setCooldownH] = useState(720);
  const [visibleDays, setVisibleDays] = useState(365);
  const [offsetDays, setOffsetDays] = useState(0);
  const [weights, setWeights] = useState(() => ({ ...DEFAULT_WEIGHTS }));
  const setWeightValue = useCallback((key, value)=>{
    const clamped = Math.max(0, Math.min(5, value));
    setWeights((w)=> ({ ...w, [key]: clamped }));
  }, []);
  const setWeight = useCallback((key)=> (value)=> setWeightValue(key, value), [setWeightValue]);

  // Daily bundle (resample once, compute indicators once)
  const dailyBundle = useMemo(()=>{
    if (!rows.length) return null;
    const { daily, rowToDay } = resampleDaily(rows);
    if (!daily.length) return null;
    const d = computeDailyIndicators(daily, rows);
    const expand = (arr) => expandDaily(arr, rowToDay);
    return {
      daily,
      rowToDay,
      dBBlowerRow:   expand(d.dBBlower),
      dRSIRow:       expand(d.dRSI),
      dMACDRow:      expand(d.dMACD),
      dMACDSigRow:   expand(d.dMACDsig),
      dMACDCrossRow: expand(d.dMACDCross).map(Boolean),
      dSMA7Row:      expand(d.dSMA7),
      dSMA30Row:     expand(d.dSMA30),
      dSMA90Row:     expand(d.dSMA90),
      dSmaStackRow:  expand(d.dSmaStack).map(Boolean),
      dPrev30LowUpRow: expand(d.dPrev30LowUp).map(Boolean),
      dPiBuyRow:     expand(d.dPiBuy),
      dPiRatioRow:   expand(d.dPiRatio),
      rMvrvBuyRow:   d.rMvrvBuy,
    };
  }, [rows]);

  // Row-level signals (VSA + expanded daily context)
  const sig = useMemo(()=>{
    if (!rows.length || !dailyBundle) return null;
    return buildSignals(rows, {
      dBBlowerRow: dailyBundle.dBBlowerRow,
      dRSIRow: dailyBundle.dRSIRow,
      dMACDRow: dailyBundle.dMACDRow,
      dMACDSigRow: dailyBundle.dMACDSigRow,
      dMACDCrossRow: dailyBundle.dMACDCrossRow,
      dSMA7Row: dailyBundle.dSMA7Row,
      dSMA30Row: dailyBundle.dSMA30Row,
      dSMA90Row: dailyBundle.dSMA90Row,
      dSmaStackRow: dailyBundle.dSmaStackRow,
      dPrev30LowUpRow: dailyBundle.dPrev30LowUpRow,
      dPiBuyRow: dailyBundle.dPiBuyRow,
      dPiRatioRow: dailyBundle.dPiRatioRow,
      rMvrvBuyRow: dailyBundle.rMvrvBuyRow,
    });
  }, [rows, dailyBundle]);

  // Windowing + scoring + aggregation for charts
  const view = useMemo(()=>{
    if (!rows.length || !sig) return null;

    const firstTs = rows[0].ts;
    const lastTs = rows[rows.length - 1].ts;
    const maxSpanDays = Math.max(1, Math.floor((lastTs - firstTs) / MS_PER_DAY));
    const wndDays = Math.min(visibleDays, maxSpanDays);
    const offsetClamped = Math.min(Math.max(0, offsetDays), Math.max(0, maxSpanDays - wndDays));

    const startTs = Math.max(firstTs, lastTs - (offsetClamped + wndDays) * MS_PER_DAY);
    const endTs = Math.min(lastTs, startTs + wndDays * MS_PER_DAY);

    const startIdx = rows.findIndex((r)=> r.ts >= startTs);
    const s = startIdx >= 0 ? startIdx : 0;
    const endIdx = rows.findIndex((r)=> r.ts > endTs);
    const e = endIdx === -1 ? rows.length : endIdx;

    const visRows = rows.slice(s, e);
    if (!visRows.length) return null;

    const n = visRows.length;
    const piRatioSlice = sig.features.piRatioRow.slice(s, e);
    const ctx = {
      piBuy: sig.absolutes.piBuy.slice(s, e),
      mvrvzBuy: sig.absolutes.mvrvzBuy.slice(s, e),
      touchLower: sig.features.touchLower.slice(s, e),
      macdCross: sig.series.macdCross.slice(s, e),
      rsi: sig.series.rsiRow.slice(s, e),
      vsa: sig.features.vsaC.slice(s, e),
      smaStack: sig.series.smaStack.slice(s, e),
      prevLowUp: sig.series.prev30LowUp.slice(s, e),
      piDeep: piRatioSlice.map((v)=> Number.isFinite(v) && v < 0.125),
      weights,
    };

    const conf = new Array(n).fill(0);
    const partsArr = new Array(n).fill(null);
    for (let i = 0; i < n; i++){
      const { confidence, parts } = scoreBar(i, ctx);
      conf[i] = confidence;
      partsArr[i] = parts || undefined;
    }

    const windowMs = maxBuyWindowH * 60 * 60 * 1000;
    const cooldownMs = cooldownH * 60 * 60 * 1000;
    const buys = [];
    let lastBuyTs = -Infinity;
    for (let i = 1; i < n; i++){
      const ts = visRows[i].ts;
      const crossedUp = conf[i] >= threshold && conf[i - 1] < threshold;
      if (!crossedUp) continue;
      const cutoff = ts + windowMs;
      let isPeak = true;
      for (let j = i + 1; j < n && visRows[j].ts <= cutoff; j++){
        if (conf[j] > conf[i]) { isPeak = false; break; }
      }
      if (isPeak && ts - lastBuyTs >= cooldownMs){
        buys.push({ ts, confidence: conf[i], parts: partsArr[i] });
        lastBuyTs = ts;
      }
    }

    const { data: base4h } = aggregate4h(visRows);
    const tsSlice = visRows.map((r)=> r.ts);

    const sample = (vals) => sampleTo4h(tsSlice, vals).map((p)=> ({ ts4h: p.ts4h, value: p.value }));

    const sma7 = sample(sig.series.sma7Row.slice(s, e));
    const sma30 = sample(sig.series.sma30Row.slice(s, e));
    const sma90 = sample(sig.series.sma90Row.slice(s, e));
    const pi4h = sample(piRatioSlice);

    let display4h = base4h.slice();
    display4h = mergeSeries(display4h, toOverlay(sma7, "sma7"), (a,b)=> ({ ...a, ...b }));
    display4h = mergeSeries(display4h, toOverlay(sma30, "sma30"), (a,b)=> ({ ...a, ...b }));
    display4h = mergeSeries(display4h, toOverlay(sma90, "sma90"), (a,b)=> ({ ...a, ...b }));
    display4h = mergeSeries(display4h, toOverlay(pi4h, "pi"), (a,b)=> ({ ...a, ...b }));

    const rsi4h = sample(sig.series.rsiRow.slice(s, e)).map((p)=> ({ ts4h: p.ts4h, rsi: p.value }));
    const macdBase = sample(sig.series.macdRow.slice(s, e)).map((p)=> ({ ts4h: p.ts4h, macd: p.value }));
    const macdSig = sample(sig.series.macdSigRow.slice(s, e)).map((p)=> ({ ts4h: p.ts4h, signal: p.value }));
    let macd4h = mergeSeries(macdBase, macdSig, (a,b)=> ({ ...a, signal: b.signal }));
    macd4h = macd4h.map((item)=> ({
      ...item,
      hist: Number.isFinite(item.macd) && Number.isFinite(item.signal)
        ? item.macd - item.signal
        : undefined,
    }));

    const FOUR_H = 4 * 60 * 60 * 1000;
    const buyLines4h = Array.from(new Set(buys.map((b)=> Math.floor(b.ts / FOUR_H) * FOUR_H))).sort((a,b)=> a - b);

    return {
      firstTs,
      lastTs,
      visRows,
      conf,
      buys,
      display4h,
      buyLines4h,
      rsi4h,
      macd4h,
      pi4h,
    };
  }, [rows, sig, visibleDays, offsetDays, threshold, maxBuyWindowH, cooldownH, weights]);

  return (
    <ErrorBoundary>
      <div className="page">
        <header className="top">
          <div>
            <h2>Crypto Confidence Backtester</h2>
            <div className="toggle">
              <label>
                <input
                  type="radio"
                  checked={format === "headered"}
                  onChange={()=> setFormat("headered")}
                />
                <span style={{ marginLeft: 6 }}>Headered CSV</span>
              </label>
              <label>
                <input
                  type="radio"
                  checked={format === "binance"}
                  onChange={()=> setFormat("binance")}
                />
                <span style={{ marginLeft: 6 }}>Binance Kline CSV</span>
              </label>
            </div>
          </div>
          <div className="upload">
            <label className="button">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e)=> onFile(e.target.files?.[0]) }
                style={{ display: "none" }}
              />
              <span>Choose CSV</span>
            </label>
            {filename && <div className="filename">{filename}</div>}
          </div>
        </header>

        {rows.length > 0 && (
          <div className="meta">
            First: {new Date(rows[0].ts).toISOString()} | Last: {new Date(rows[rows.length - 1].ts).toISOString()}
          </div>
        )}

        <div className="grid">
          <section className="panel">
            <h3>Scoring Controls</h3>
            <Slider label={`Master threshold: ${threshold}`} min={1} max={100} step={1} value={threshold} setValue={setThreshold} />
            <Slider label={`Max buy window (hours): ${maxBuyWindowH}`} min={1} max={1440} step={1} value={maxBuyWindowH} setValue={setMaxBuyWindowH} />
            <p className="muted">Cooldown between buys (e.g. 720 ≈ 30 days).</p>
            <Slider label={`Cooldown between buys (hours): ${cooldownH}`} min={1} max={1440} step={1} value={cooldownH} setValue={setCooldownH} />
            <Slider label={`Visible window (days): ${visibleDays}`} min={7} max={720} step={1} value={visibleDays} setValue={setVisibleDays} />
            <Slider label={`Offset from end (days): ${offsetDays}`} min={0} max={365} step={1} value={offsetDays} setValue={setOffsetDays} />
          </section>

          <section className="panel">
            <h3>Price</h3>
            {view ? (
              <PriceChart
                data={mergeSeries(view.display4h, toOverlay(view.pi4h, "pi"), (a,b)=> ({ ...a, ...b }))}
                buys={view.buyLines4h}
                syncId={SYNC_ID}
              />
            ) : (
              <div className="muted">Load a CSV to see charts.</div>
            )}
          </section>

          <section className="panel">
            <h3>Weights</h3>
            <Slider label={`bollinger (${weights.bollinger.toFixed(2)})`} min={0} max={5} step={0.05} value={weights.bollinger} setValue={setWeight("bollinger")} />
            <Slider label={`macd (${weights.macd.toFixed(2)})`} min={0} max={5} step={0.05} value={weights.macd} setValue={setWeight("macd")} />
            <Slider label={`vsa (${weights.vsa.toFixed(2)})`} min={0} max={5} step={0.05} value={weights.vsa} setValue={setWeight("vsa")} />
            <Slider label={`smaStack (${weights.smaStack.toFixed(2)})`} min={0} max={5} step={0.05} value={weights.smaStack} setValue={setWeight("smaStack")} />
            <Slider label={`prevLowUp (${weights.prevLowUp.toFixed(2)})`} min={0} max={5} step={0.05} value={weights.prevLowUp} setValue={setWeight("prevLowUp")} />
            <div className="subtle">RSI band weights</div>
            <Slider label={`rsi10 (${weights.rsi10.toFixed(2)})`} min={0} max={5} step={0.05} value={weights.rsi10} setValue={setWeight("rsi10")} />
            <Slider label={`rsi20 (${weights.rsi20.toFixed(2)})`} min={0} max={5} step={0.05} value={weights.rsi20} setValue={setWeight("rsi20")} />
            <Slider label={`rsi30 (${weights.rsi30.toFixed(2)})`} min={0} max={5} step={0.05} value={weights.rsi30} setValue={setWeight("rsi30")} />
            <div className="subtle">Experimental</div>
            <Slider label={`PI deep-buy (PI < 0.125): ${weights.piDeep.toFixed(2)}`} min={0} max={5} step={0.05} value={weights.piDeep} setValue={setWeight("piDeep")} />
            <p className="muted">Absolute: PI ≤ 0.30, MVRV-Z ≤ 0 → confidence 100.</p>
          </section>

          <section className="panel">
            <h3>RSI (14d)</h3>
            {view ? (
              <RsiChart data={view.rsi4h} buys={view.buyLines4h} syncId={SYNC_ID} />
            ) : (
              <div className="muted">Upload data to see RSI.</div>
            )}
          </section>

          <section className="panel">
            <h3>MACD</h3>
            {view ? (
              <MacdChart data={view.macd4h} buys={view.buyLines4h} syncId={SYNC_ID} />
            ) : (
              <div className="muted">Upload data to see MACD.</div>
            )}
          </section>
        </div>

        <section className="panel">
          <h3>Buy Signals</h3>
          {view ? (
            <BuyTable buys={view.buys} />
          ) : (
            <div className="muted" style={{ padding: 8 }}>
              {lastError ? `Error: ${lastError}` : "Load a CSV to see results."}
            </div>
          )}
        </section>
      </div>
    </ErrorBoundary>
  );
}

function Slider({ label, value, setValue, min = 0, max = 100, step = 1 }){
  return (
    <label className="slider">
      <div className="label">{label}</div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e)=> setValue(Number(e.target.value))}
      />
    </label>
  );
}
