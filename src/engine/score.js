// src/engine/score.js
// Confidence scoring for a single bar, using independent weights and caps.

import { ABSOLUTE_CAP, BLENDED_CAP } from "../app/constants";

/**
 * Score a single bar i using the provided context.
 *
 * Context must include (arrays are already window-sliced s..e):
 *  - piBuy[], mvrvzBuy[]                  // absolute overrides
 *  - touchLower[]                         // Bollinger lower touch (row vs daily band)
 *  - macdCross[]                          // daily MACD cross expanded to rows (boolean)
 *  - rsi[]                                // daily RSI expanded to rows (numeric)
 *  - vsa[]                                // 1h VSA combined (0|1)
 *  - smaStack[]                           // daily SMA stack (boolean)
 *  - prevLowUp[]                          // previous 30d low touch + uptrend (boolean)
 *  - piDeep[]                             // PI < 0.125 (boolean)
 *  - weights{ bollinger, macd, vsa, smaStack, prevLowUp, rsi10, rsi20, rsi30, piDeep }
 */
export function scoreBar(i, ctx){
  // Absolute overrides
  if (ctx.piBuy[i] || ctx.mvrvzBuy[i]) return { confidence: ABSOLUTE_CAP, parts: null };

  const parts = {}; let raw = 0; let maxRaw = 0;
  const add = (k, active, w) => { const v = active ? w : 0; raw += v; maxRaw += w; parts[k] = v; };

  // Component contributions
  add("bollinger", ctx.touchLower[i], ctx.weights.bollinger);
  add("macd",      ctx.macdCross[i],  ctx.weights.macd);

  const r = ctx.rsi[i];
  if (Number.isFinite(r)){
    if (r <= 10)      add("rsi", true, ctx.weights.rsi10);
    else if (r <= 20) add("rsi", true, ctx.weights.rsi20);
    else if (r <= 30) add("rsi", true, ctx.weights.rsi30);
    else parts["rsi"] = 0;
  } else {
    parts["rsi"] = 0;
  }

  add("vsa",       ctx.vsa[i] === 1,  ctx.weights.vsa);
  add("smaStack",  ctx.smaStack[i],   ctx.weights.smaStack);
  add("prevLowUp", ctx.prevLowUp[i],  ctx.weights.prevLowUp);

  // Experimental deep PI (PI < 0.125)
  add("piDeep",    ctx.piDeep[i],     ctx.weights.piDeep);

  const confidence = maxRaw === 0 ? 0 : Math.min(BLENDED_CAP, (raw / maxRaw) * BLENDED_CAP);
  return { confidence, parts };
}
