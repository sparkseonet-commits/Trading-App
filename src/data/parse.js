// src/data/parse.js
// CSV/array parsing utilities (headered CSV and Binance kline arrays).

function lcKeys(obj){
  const out = {};
  for (const k in obj){
    if (!Object.prototype.hasOwnProperty.call(obj,k)) continue;
    out[k.toLowerCase().trim()] = obj[k];
  }
  return out;
}

export function normalizeEpochToMs(x){
  if (x == null || x === '') return NaN;
  let v = +x;
  if (!Number.isFinite(v)) {
    // Try Date parse
    const d = new Date(x);
    return isNaN(d.getTime()) ? NaN : d.getTime();
  }
  // Excel serial (rough): days since 1899-12-30
  if (v > 60 && v < 60000) {
    const ms = (v - 25569) * 86400000;
    if (ms > 0) return ms;
  }
  // seconds vs ms vs micro/nano
  if (v < 1e11) return v * 1000;        // seconds
  if (v < 1e13) return v;               // milliseconds
  if (v < 1e16) return Math.floor(v / 1000); // microseconds
  return Math.floor(v / 1e6);           // nanoseconds
}

export function parseHeadered(data){
  // data: array of objects with keys (case-insensitive):
  // date|time|timestamp, open, high, low, close, volume[, mvrvz]
  const rows = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;
    const d = lcKeys(raw);

    // find a date-ish key
    const dateKey = ['date','time','timestamp','open time','opentime','ts'].find(k=> d[k] != null);
    const ts = normalizeEpochToMs(d[dateKey]);

    // parse prices (support alt variants)
    const open  = +(d.open  ?? d.o);
    const high  = +(d.high  ?? d.h);
    const low   = +(d.low   ?? d.l);
    const close = +(d.close ?? d.c);
    const volume = +(d.volume ?? d.vol ?? d.v ?? d['volume(usdt)'] ?? d['volume (usdt)']);

    if (!Number.isFinite(ts) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
      continue;
    }
    rows.push({
      ts,
      dateISO: new Date(ts).toISOString().replace('.000Z','Z'),
      open, high, low, close,
      volume: Number.isFinite(volume) ? volume : 0,
      mvrvz: d.mvrvz !== undefined ? +d.mvrvz : undefined,
      date: d[dateKey]
    });
  }
  rows.sort((a,b)=>a.ts-b.ts);
  return rows;
}

export function parseBinance(data){
  // data: array of arrays [openTime, open, high, low, close, volume, ...]
  const rows = [];
  for (const rec of data) {
    if (!rec || rec.length < 6) continue;
    const ts = normalizeEpochToMs(rec[0]);
    const open = +rec[1], high = +rec[2], low = +rec[3], close = +rec[4], volume = +rec[5];
    if (!Number.isFinite(ts) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) continue;
    rows.push({
      ts,
      dateISO: new Date(ts).toISOString().replace('.000Z','Z'),
      open, high, low, close,
      volume: Number.isFinite(volume) ? volume : 0
    });
  }
  rows.sort((a,b)=>a.ts-b.ts);
  return rows;
}
