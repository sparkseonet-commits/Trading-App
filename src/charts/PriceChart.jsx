// src/charts/PriceChart.jsx
import React, { useMemo } from "react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
} from "recharts";

/**
 * PriceChart
 * - Renders 4h-aggregated price (close) with SMA overlays and PI on right axis
 * - Draws BUY markers robustly (unit-normalised to XAxis, proper xAxisId, z-order front)
 *
 * Props:
 *  - data: Array<{ ts4h:number, close:number, sma7?:number, sma30?:number, sma90?:number, pi?:number }>
 *  - buys: number[]            // buy timestamps (any unit: sec/ms); 1h or 4h, we normalise below
 *  - syncId?: string
 *  - height?: number
 *  - yPriceId?: string         // defaults 'price'
 *  - xId?: string              // defaults 'time'
 */
export default function PriceChart({
  data,
  buys,
  syncId = "sync-confidence",
  height = 260,
  yPriceId = "price",
  xId = "time",
}){
  const xKey = "ts4h";

  // Helpers to normalise units
  const toMs  = (v) => (v && v < 10_000_000_000 ? v * 1000 : v);               // seconds -> ms
  const toSec = (v) => (v && v > 10_000_000_000 ? Math.floor(v / 1000) : v);   // ms -> sec
  const FOUR_H_MS = 4 * 60 * 60 * 1000;

  // Detect axis unit (sec vs ms) from first datum
  const axisLooksLikeSeconds = useMemo(()=>{
    const s = data && data.length ? data[0]?.[xKey] : null;
    return s && s < 10_000_000_000;
  }, [data]);

  // Is the xKey a 4h bucket? Yes, for ts4h.
  const is4hKey = true;

  // Normalise BUY x-positions to axis units and (if needed) snap to 4h buckets
  const buyXs = useMemo(()=>{
    if (!Array.isArray(buys) || !Array.isArray(data) || !data.length) return [];
    const convert = axisLooksLikeSeconds ? toSec : toMs;
    const snap4h = (t) => Math.floor(t / FOUR_H_MS) * FOUR_H_MS;
    return buys
      .filter(Number.isFinite)
      .map(convert)
      .map((t) => (is4hKey ? (axisLooksLikeSeconds ? toSec(snap4h(toMs(t))) : snap4h(t)) : t));
  }, [buys, data, axisLooksLikeSeconds]);

  // Domain edges for area fallback
  const firstX = data && data.length ? data[0]?.[xKey] : null;
  const lastX  = data && data.length ? data[data.length-1]?.[xKey] : null;

  // Build unique, in-domain, sorted x's
  const buyXsClean = useMemo(()=>{
    const set = new Set(buyXs.filter((x)=> Number.isFinite(x)));
    const arr = Array.from(set).sort((a,b)=>a-b);
    return arr;
  }, [buyXs]);

  const renderBuyMarkers = () => {
    if (!buyXsClean.length || !Number.isFinite(firstX) || !Number.isFinite(lastX)) return null;
    const halfWidth = axisLooksLikeSeconds ? 15 * 60 : 15 * 60 * 1000; // 15 minutes, in axis units

    return buyXsClean.map((x,i)=>{
      const atEdge = (x <= firstX) || (x >= lastX);
      if (atEdge){
        // Use a thin band at edges to avoid potential clamping artefacts
        return (
          <ReferenceArea
            key={"buy-area-"+x+"-"+i}
            xAxisId={xId}
            x1={x - halfWidth}
            x2={x + halfWidth}
            ifOverflow="visible"
            fill="rgba(0,128,0,0.25)"
            strokeOpacity={0}
          />
        );
      }
      return (
        <ReferenceLine
          key={"buy-line-"+x+"-"+i}
          xAxisId={xId}
          x={x}
          ifOverflow="visible"
          isFront
          stroke="green"
          strokeDasharray="6 4"
        />
      );
    });
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} syncId={syncId}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey={xKey}
          xAxisId={xId}
          domain={["dataMin","dataMax"]}
          allowDataOverflow
        />
        <YAxis
          yAxisId={yPriceId}
          orientation="left"
          tickFormatter={(v)=> (Number.isFinite(v) ? v.toFixed(0) : "")}
          allowDataOverflow
        />
        <YAxis
          yAxisId="pi"
          orientation="right"
          domain={[0, 1]}
          tickFormatter={(v)=> (Number.isFinite(v) ? v.toFixed(2) : "")}
        />
        <Tooltip
          labelFormatter={(v)=> new Date(axisLooksLikeSeconds ? v*1000 : v).toISOString().replace(".000Z","Z")}
          formatter={(val, name)=> [Number.isFinite(val) ? val : val, name]}
        />

        {/* Close price */}
        <Line
          yAxisId={yPriceId}
          type="monotone"
          dataKey="close"
          stroke="#8884d8"
          dot={false}
          isAnimationActive={false}
        />

        {/* SMA overlays (optional) */}
        <Line yAxisId={yPriceId} type="monotone" dataKey="sma7"  stroke="#999" dot={false} isAnimationActive={false} />
        <Line yAxisId={yPriceId} type="monotone" dataKey="sma30" stroke="#555" dot={false} isAnimationActive={false} />
        <Line yAxisId={yPriceId} type="monotone" dataKey="sma90" stroke="#111" dot={false} isAnimationActive={false} />

        {/* PI on right axis if present */}
        <Line yAxisId="pi" type="monotone" dataKey="pi" stroke="#22aa22" dot={false} isAnimationActive={false} />

        {/* BUY markers */}
        {renderBuyMarkers()}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
