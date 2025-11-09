// src/app/constants.js
// Centralised constants, defaults, and shared IDs used across the app.

export const ABSOLUTE_CAP = 100;       // absolute confidence when absolute rules hit
export const BLENDED_CAP  = 99.9;      // blended max to keep absolute visually distinct

export const BARS_PER_DAY = 24;        // 1h bars (raw input cadence)
export const MS_PER_DAY   = 86_400_000;

export const SYNC_ID = "sync-confidence"; // Recharts sync id for cross-chart cursor/zoom

// Default weights for indicators (independent sliders, no conservation)
export const DEFAULT_WEIGHTS = {
  bollinger: 1.0,
  macd: 1.0,
  vsa: 1.0,
  smaStack: 1.5,
  prevLowUp: 1.0,
  rsi10: 1.5,
  rsi20: 1.2,
  rsi30: 1.0,
  // Experimental: deep PI when PI < 0.125
  piDeep: 2.0,
};
