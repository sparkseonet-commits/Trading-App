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
  if (x == null || x === "") return NaN;

  if (typeof x === "number"){
    if (!Number.isFinite(x)) return NaN;
    const v = Math.abs(x);
    if (v > 20000 && v < 90000){
      const excel = (x - 25569) * 86400000;
      if (Number.isFinite(excel)) return Math.trunc(excel);
    }
    if (v >= 1e18) return Math.trunc(x / 1e6);
    if (v >= 1e15) return Math.trunc(x / 1e3);
    if (v >= 1e12) return Math.trunc(x);
    if (v >= 1e10) return Math.trunc(x * 1000);
    return Math.trunc(x);
  }

  if (typeof x === "string"){
    const s = x.trim();
    if (s === "") return NaN;

    const excelMatch = s.match(/^([0-9]{5,}(?:\.[0-9]+)?)(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?$/);
    if (excelMatch){
      const serial = Number(excelMatch[1]);
      if (Number.isFinite(serial)){
        let base = normalizeEpochToMs(serial);
        if (Number.isFinite(base) && excelMatch[2] !== undefined){
          const hh = Number(excelMatch[2]);
          const mm = Number(excelMatch[3]);
          const ss = Number(excelMatch[4]);
          base += ((hh * 60 + mm) * 60 + ss) * 1000;
        }
        if (Number.isFinite(base)) return base;
      }
    }

    const asNum = Number(s);
    if (Number.isFinite(asNum)) return normalizeEpochToMs(asNum);
    const parsed = new Date(s).getTime();
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  if (x instanceof Date){
    const t = x.getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  return NaN;
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
