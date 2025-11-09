import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import Papa from "papaparse";

import {
  ABSOLUTE_CAP,
  BARS_PER_DAY,
  DEFAULT_WEIGHTS,
  MS_PER_DAY,
  SYNC_ID,
} from "./constants";

import { parseHeadered, parseBinance } from "../data/parse";
import { resampleDaily, aggregate4h } from "../data/resample";
import { computeDailyIndicators, expandDaily } from "../indicators/daily";
import { buildSignals } from "../engine/signals";
import { scoreBar } from "../engine/score";

import PriceChart from "../charts/PriceChart";
import RsiChart from "../charts/RsiChart";
import MacdChart from "../charts/MacdChart";
import BuyTable from "../charts/BuyTable";

export default function App(){
  const [rows, setRows] = useState([]);
  const [threshold, setThreshold] = useState(80);
  const [buyWindowHours, setBuyWindowHours] = useState(30 * 24);
  const [windowDays, setWindowDays] = useState(365);
  const [windowOffsetDays, setWindowOffsetDays] = useState(0);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");

  const setWeight = (key, value) => {
    const clamp = (x) => Math.max(0, Math.min(5, x));
    setWeights((w)=> ({ ...w, [key]: clamp(value) }));
  };

  const parseCSV = useCallback(async (file)=>{
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    try {
      const text = await file.text();
      const sniff = Papa.parse(text, { header: false, dynamicTyping: true, skipEmptyLines: true });
      const first = Array.isArray(sniff.data) ? sniff.data[0] : null;
      if (Array.isArray(first) && first.length >= 6 && Number.isFinite(Number(first[0]))){
        const parsedRows = parseBinance(sniff.data);
        if (!parsedRows.length) {
          throw new Error("No valid rows found in Binance format");
        }
        setRows(parsedRows);
        return;
      }
      const parsed = Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true });
      if (parsed.errors && parsed.errors.length){
        throw new Error(parsed.errors[0]?.message || "CSV parsing error");
      }
      const parsedRows = parseHeadered(parsed.data);
      if (!parsedRows.length){
        throw new Error("No valid rows found in CSV");
      }
      setRows(parsedRows);
    } catch (err) {
      console.error("Failed to parse CSV", err); // eslint-disable-line no-console
      setRows([]);
      setParseError(err instanceof Error ? err.message : "Failed to parse CSV file");
    }
  }, []);

  const computed = useMemo(()=>{
    if (!rows.length) return null;

    const { daily, rowToDay } = resampleDaily(rows);
    if (!daily.length) return null;

    const dailyIndicators = computeDailyIndicators(daily, rows);
    const expand = (arr) => expandDaily(arr, rowToDay);

    const expanded = {
      dBBlowerRow: expand(dailyIndicators.dBBlower),
      dRSIRow: expand(dailyIndicators.dRSI),
      dMACDRow: expand(dailyIndicators.dMACD),
      dMACDSigRow: expand(dailyIndicators.dMACDsig),
      dMACDCrossRow: expand(dailyIndicators.dMACDCross).map(Boolean),
      dSMA7Row: expand(dailyIndicators.dSMA7),
      dSMA30Row: expand(dailyIndicators.dSMA30),
      dSMA90Row: expand(dailyIndicators.dSMA90),
      dSmaStackRow: expand(dailyIndicators.dSmaStack).map(Boolean),
      dPrev30LowUpRow: expand(dailyIndicators.dPrev30LowUp).map(Boolean),
      dPiBuyRow: expand(dailyIndicators.dPiBuy),
      dPiRatioRow: expand(dailyIndicators.dPiRatio),
      rMvrvBuyRow: dailyIndicators.rMvrvBuy,
    };

    const signals = buildSignals(rows, expanded);
    if (!signals) return null;

    const firstTs = rows[0].ts;
    const lastTs = rows[rows.length - 1].ts;
    const maxSpanDays = Math.max(1, Math.floor((lastTs - firstTs) / MS_PER_DAY));
    const wndDays = Math.min(windowDays, maxSpanDays);
    const offsetClamped = Math.min(Math.max(0, windowOffsetDays), Math.max(0, maxSpanDays - wndDays));

    const startTs = Math.max(firstTs, lastTs - (offsetClamped + wndDays) * MS_PER_DAY);
    const endTs = Math.min(lastTs, startTs + wndDays * MS_PER_DAY);
    const startIdx = rows.findIndex((r)=> r.ts >= startTs);
    const endIdx = rows.findIndex((r)=> r.ts > endTs);
    const s = startIdx >= 0 ? startIdx : 0;
    const e = endIdx === -1 ? rows.length : endIdx;

    const visRows = rows.slice(s, e);
    if (!visRows.length) return null;

    const n = visRows.length;

    const ctx = {
      piBuy: signals.absolutes.piBuy.slice(s, e),
      mvrvzBuy: signals.absolutes.mvrvzBuy.slice(s, e),
      touchLower: signals.features.touchLower.slice(s, e),
      macdCross: signals.series.macdCross.slice(s, e),
      rsi: signals.series.rsi.slice(s, e),
      vsa: signals.features.vsa.slice(s, e),
      smaStack: signals.series.smaStack.slice(s, e),
      prevLowUp: signals.series.prevLowUp.slice(s, e),
      piDeep: signals.features.piRatio.slice(s, e).map((v)=> Number.isFinite(v) && v < 0.125),
      weights,
    };

    const confidence = new Array(n).fill(0);
    const partsArr = new Array(n).fill(null);

    for (let i = 0; i < n; i++){
      const { confidence: conf, parts } = scoreBar(i, ctx);
      confidence[i] = conf;
      partsArr[i] = parts;
    }

    const cooldownMs = buyWindowHours * 60 * 60 * 1000;
    const buys = [];
    let lastBuyTs = -Infinity;
    for (let i = 1; i < n; i++){
      const ts = visRows[i].ts;
      const crossed = confidence[i] >= threshold && confidence[i - 1] < threshold;
      if (!crossed) continue;
      if (ts - lastBuyTs < cooldownMs) continue;
      buys.push({ index: i, ts, conf: confidence[i], parts: partsArr[i] });
      lastBuyTs = ts;
    }

    const extras = {
      rsi: signals.series.rsi.slice(s, e),
      macd: signals.series.macd.slice(s, e),
      macdSig: signals.series.macdSig.slice(s, e),
      sma7: signals.series.sma7.slice(s, e),
      sma30: signals.series.sma30.slice(s, e),
      sma90: signals.series.sma90.slice(s, e),
      pi: signals.features.piRatio.slice(s, e),
    };
    const display4h = aggregate4h(visRows, extras);

    const buyLines4h = Array.from(new Set(buys.map((b)=> Math.floor(b.ts / (4 * 60 * 60 * 1000)) * (4 * 60 * 60 * 1000)))).sort((a, b)=> a - b);

    return {
      visRows,
      display4h,
      buys,
      confidence,
      firstTs,
      lastTs,
      wndDays,
      offsetClamped,
      buyLines4h,
    };
  }, [rows, windowDays, windowOffsetDays, threshold, buyWindowHours, weights]);

  const hasData = !!(computed && Array.isArray(computed.display4h) && computed.display4h.length > 0);

  const formatDate = useCallback((ts)=> new Date(ts).toISOString().slice(0, 16).replace("T", " "), []);

  useEffect(()=>{
    try {
      const t = Array.from({ length: 200 }, (_, i)=> 100 + Math.sin(i / 7) * 2 + (i / 500));
      if (!Array.isArray(t) || !t.length) throw new Error("Test series missing");
      const dummyRows = t.map((v, i)=> ({ ts: 1700000000000 + i * 3600000, open: v, high: v, low: v, close: v, volume: 1 }));
      const agg = aggregate4h(dummyRows);
      if (!agg.length) throw new Error("Aggregate 4h failed");
    } catch (err) {
      console.warn("Self-test failed", err); // eslint-disable-line no-console
    }
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Crypto Confidence Backtester</h1>
        <div className="flex gap-2 items-center">
          <input
            id="file"
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={async (e)=>{
              if (!e.target.files || !e.target.files.length) return;
              const f = e.target.files[0];
              await parseCSV(f);
            }}
          />
          <button
            className="px-4 py-2 rounded-xl shadow bg-black text-white"
            onClick={()=> fileRef.current?.click()}
            type="button"
          >
            Choose CSV
          </button>
          <input
            type="text"
            readOnly
            value={fileName || "No file chosen"}
            className="px-3 py-2 rounded-xl border bg-white/70 text-sm w-64"
          />
        </div>
      </header>

      {parseError && (
        <div className="text-sm text-red-700 bg-red-100 border border-red-200 rounded p-3">
          Failed to load CSV: {parseError}
        </div>
      )}

      {computed && (
        <div className="text-xs text-gray-700 bg-yellow-50 border border-yellow-200 rounded p-2">
          First: {new Date(computed.firstTs).toISOString()} | Last: {new Date(computed.lastTs).toISOString()}
        </div>
      )}

      <div className="grid md:grid-cols-12 gap-4">
        <aside className="md:col-span-4 space-y-4">
          <div className="p-4 rounded-2xl shadow bg-white/60 border">
            <h2 className="font-semibold mb-2">Scoring Controls</h2>
            <div className="text-sm">Master threshold: <b>{threshold}</b></div>
            <input
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={threshold}
              onChange={(e)=> setThreshold(parseFloat(e.target.value))}
              className="w-full"
            />
            <div className="mt-3 text-sm">Max buy window (hours): <b>{buyWindowHours}</b></div>
            <input
              type="range"
              min={24}
              max={90 * BARS_PER_DAY}
              step={24}
              value={buyWindowHours}
              onChange={(e)=> setBuyWindowHours(parseInt(e.target.value, 10))}
              className="w-full"
            />
            <p className="text-xs text-gray-600 mt-1">Cooldown between buys (e.g. 720 ≈ 30 days).</p>
            <div className="mt-3 text-sm">Visible window (days): <b>{windowDays}</b></div>
            <input
              type="range"
              min={30}
              max={1100}
              step={5}
              value={windowDays}
              onChange={(e)=> setWindowDays(parseInt(e.target.value, 10))}
              className="w-full"
            />
            <div className="mt-3 text-sm">Offset from end (days): <b>{windowOffsetDays}</b></div>
            <input
              type="range"
              min={0}
              max={1100}
              step={5}
              value={windowOffsetDays}
              onChange={(e)=> setWindowOffsetDays(parseInt(e.target.value, 10))}
              className="w-full"
            />
          </div>
          <div className="p-4 rounded-2xl shadow bg-white/60 border">
            <h2 className="font-semibold mb-2">Weights</h2>
            {["bollinger", "macd", "vsa", "smaStack", "prevLowUp"].map((k)=>(
              <div key={k} className="mb-3">
                <div className="flex justify-between text-sm"><span>{k}</span><span>{weights[k].toFixed(2)}</span></div>
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={0.05}
                  value={weights[k]}
                  onChange={(e)=> setWeight(k, parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
            ))}
            <div className="text-xs text-gray-600">RSI band weights</div>
            {["rsi10", "rsi20", "rsi30"].map((k)=>(
              <div key={k} className="mb-2">
                <div className="flex justify-between text-sm"><span>{k}</span><span>{weights[k].toFixed(2)}</span></div>
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={0.05}
                  value={weights[k]}
                  onChange={(e)=> setWeight(k, parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
            ))}
            <div className="text-xs text-gray-600 mt-3">Experimental</div>
            <div className="mb-2">
              <div className="flex justify-between text-sm"><span>PI deep-buy (PI &lt; 0.125)</span><span>{weights.piDeep.toFixed(2)}</span></div>
              <input
                type="range"
                min={0}
                max={5}
                step={0.05}
                value={weights.piDeep}
                onChange={(e)=> setWeight("piDeep", parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
            <p className="text-xs text-gray-600 mt-1">Absolute: PI≤0.30, MVRV‑Z≤0 → confidence {ABSOLUTE_CAP}.</p>
          </div>
        </aside>

        <main className="md:col-span-8 space-y-4">
          <section className="p-4 rounded-2xl shadow bg-white/60 border">
            <h2 className="font-semibold mb-3">Price</h2>
            {!hasData ? (
              <div className="text-gray-500 text-sm">Upload data to see charts.</div>
            ) : (
              <PriceChart data={computed.display4h} buyLines={computed.buyLines4h} syncId={SYNC_ID} />
            )}
          </section>

          {hasData && (
            <section className="p-4 rounded-2xl shadow bg-white/60 border">
              <h2 className="font-semibold mb-3">RSI (14d)</h2>
              <RsiChart data={computed.display4h} buyLines={computed.buyLines4h} syncId={SYNC_ID} />

              <h2 className="font-semibold mb-3">MACD (12/26/9 daily)</h2>
              <MacdChart data={computed.display4h} buyLines={computed.buyLines4h} syncId={SYNC_ID} />
            </section>
          )}

          {hasData && (
            <section className="p-4 rounded-2xl shadow bg-white/60 border">
              <h2 className="font-semibold mb-3">Buy Signals</h2>
              <BuyTable buys={computed.buys} formatDate={formatDate} />
            </section>
          )}

          <footer className="text-xs text-gray-500">
            Hover charts to see synced cursor. Green dashed lines = BUY. Adjust threshold, weights, cooldown, window size and offset
            to explore entries. PI line shows the 111/(2*350) ratio on right axis; dashed 0.30 line is the absolute rule. Experimental
            PI deep-buy fires when PI &lt; 0.125 (weighted by its slider).
          </footer>
        </main>
      </div>
    </div>
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
