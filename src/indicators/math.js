// src/indicators/math.js
// Pure math/indicator helpers with no React/Recharts dependencies.

export const sma = (arr, period) => {
  const n = Array.isArray(arr) ? arr.length : 0;
  const out = new Array(n).fill(NaN);
  if (!n || period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    sum += Number.isFinite(v) ? v : 0;
    if (i >= period) {
      const vOld = arr[i - period];
      sum -= Number.isFinite(vOld) ? vOld : 0;
    }
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
};

export const ema = (arr, period) => {
  const n = Array.isArray(arr) ? arr.length : 0;
  const out = new Array(n).fill(NaN);
  if (!n || period <= 0) return out;
  const k = 2 / (period + 1);
  let prev = NaN;
  for (let i = 0; i < n; i++) {
    const v = Number.isFinite(arr[i]) ? arr[i] : prev;
    prev = Number.isFinite(prev) ? (v * k + prev * (1 - k)) : v;
    out[i] = prev;
  }
  return out;
};

export const std = (arr, period) => {
  const n = Array.isArray(arr) ? arr.length : 0;
  const out = new Array(n).fill(NaN);
  if (!n || period <= 0) return out;
  const ma = sma(arr, period);
  for (let i = period - 1; i < n; i++) {
    let s2 = 0, cnt = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const v = arr[j];
      if (Number.isFinite(v) && Number.isFinite(ma[i])) {
        const d = v - ma[i];
        s2 += d * d;
        cnt++;
      }
    }
    out[i] = cnt ? Math.sqrt(s2 / cnt) : NaN;
  }
  return out;
};

export const rsi = (arr, period = 14) => {
  const n = Array.isArray(arr) ? arr.length : 0;
  const out = new Array(n).fill(NaN);
  if (n < 2) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period && i < n; i++) {
    const ch = arr[i] - arr[i - 1];
    gain += ch > 0 ? ch : 0;
    loss += ch < 0 ? -ch : 0;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period; i < n; i++) {
    if (i > period) {
      const ch = arr[i] - arr[i - 1];
      const g = ch > 0 ? ch : 0;
      const l = ch < 0 ? -ch : 0;
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
    }
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
};

export function macdLine(arr, fast = 12, slow = 26, signal = 9) {
  const macdFast = ema(arr, fast);
  const macdSlow = ema(arr, slow);
  const macd = macdFast.map((v, i) => Number.isFinite(v) && Number.isFinite(macdSlow[i]) ? v - macdSlow[i] : NaN);
  const sig = ema(macd, signal);
  return { macd, signal: sig };
}

export function slope(arr, window = 10) {
  const n = Array.isArray(arr) ? arr.length : 0;
  const out = new Array(n).fill(NaN);
  if (!n || window <= 1) return out;
  for (let i = window - 1; i < n; i++) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    let cnt = 0;
    for (let j = i - window + 1, x = 0; j <= i; j++, x++) {
      const y = arr[j];
      if (!Number.isFinite(y)) continue;
      sx += x; sy += y; sxx += x * x; sxy += x * y; cnt++;
    }
    if (cnt >= 2) {
      const denom = cnt * sxx - sx * sx;
      out[i] = denom !== 0 ? (cnt * sxy - sx * sy) / denom : NaN;
    }
  }
  return out;
}
