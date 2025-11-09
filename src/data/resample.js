// src/data/resample.js
// Resampling utilities: daily UTC resample and 4h aggregation for chart display.

export function resampleDaily(rows){
  if (!Array.isArray(rows) || rows.length === 0) return { daily: [], rowToDay: [] };
  const out = [];
  const rowToDay = new Array(rows.length).fill(0);

  const dayKey = (ms) => {
    const d = new Date(ms);
    // UTC midnight
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const dd = d.getUTCDate();
    return Date.UTC(y, m, dd);
  };

  let curKey = dayKey(rows[0].ts);
  let o = rows[0].open, h = rows[0].high, l = rows[0].low, c = rows[0].close, v = 0;
  let dayIndex = 0;

  const push = () => out.push({ ts: curKey, open: o, high: h, low: l, close: c, volume: v });

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const k = dayKey(r.ts);
    if (k !== curKey) {
      push();
      curKey = k; o = r.open; h = r.high; l = r.low; c = r.close; v = 0;
      dayIndex++;
    }
    // map
    rowToDay[i] = dayIndex;
    // update
    if (r.high > h) h = r.high;
    if (r.low  < l) l = r.low;
    c = r.close;
    v += (Number.isFinite(r.volume) ? r.volume : 0);
  }
  push();
  return { daily: out, rowToDay };
}

/**
 * Aggregate 1h rows into 4h buckets for chart display.
 * @param {Array<{ts:number,open:number,high:number,low:number,close:number,volume:number}>} rows
 * @param {Record<string, number[]>} extras  Optional map of extra series aligned to rows
 * @returns {Array} data: array with {ts, open, high, low, close, volume, ...extras}
 */
export function aggregate4h(rows, extras = {}){
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const FOUR_H = 4 * 60 * 60 * 1000;
  const out = [];
  const extraKeys = Object.keys(extras);

  let bucketKey = Math.floor(rows[0].ts / FOUR_H) * FOUR_H;
  let cur = {
    ts: bucketKey,
    open: rows[0].open,
    high: rows[0].high,
    low: rows[0].low,
    close: rows[0].close,
    volume: Number.isFinite(rows[0].volume) ? rows[0].volume : 0,
  };

  const push = () => { if (cur) out.push(cur); };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const k = Math.floor(r.ts / FOUR_H) * FOUR_H;
    if (k !== bucketKey) {
      push();
      bucketKey = k;
      cur = {
        ts: bucketKey,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: Number.isFinite(r.volume) ? r.volume : 0,
      };
    } else {
      if (r.high > cur.high) cur.high = r.high;
      if (r.low  < cur.low)  cur.low = r.low;
      cur.close = r.close;
      cur.volume += Number.isFinite(r.volume) ? r.volume : 0;
    }

    for (const key of extraKeys) {
      const series = extras[key];
      if (!Array.isArray(series)) continue;
      if (series.length <= i) continue;
      cur[key] = series[i];
    }
  }

  push();
  return out;
}
