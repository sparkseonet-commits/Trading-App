// src/charts/MacdChart.jsx
import React, { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
  Area,
} from "recharts";

/**
 * MacdChart
 * - Renders MACD and Signal on the 4h axis, with optional histogram area
 * - Draws BUY markers robustly (unit-normalised, axisId-aligned)
 *
 * Props:
 *  - data: Array<{ ts4h:number, macd:number, signal:number, hist?:number }>
 *  - buys: number[]   // timestamps (sec or ms; 1h or 4h)
 *  - syncId?: string
 *  - height?: number
 *  - xId?: string     // default 'time'
 */
export default function MacdChart({
  data,
  buys,
  syncId = "sync-confidence",
  height = 160,
  xId = "time",
}){
  const xKey = "ts4h";

  const toMs  = (v) => (v && v < 10_000_000_000 ? v * 1000 : v);
  const toSec = (v) => (v && v > 10_000_000_000 ? Math.floor(v / 1000) : v);
  const FOUR_H_MS = 4 * 60 * 60 * 1000;

  const axisLooksLikeSeconds = useMemo(()=>{
    const s = data && data.length ? data[0]?.[xKey] : null;
    return s && s < 10_000_000_000;
  }, [data]);

  const is4hKey = true;

  const buyXs = useMemo(()=>{
    if (!Array.isArray(buys) || !Array.isArray(data) || !data.length) return [];
    const convert = axisLooksLikeSeconds ? toSec : toMs;
    const snap4h = (t) => Math.floor(t / FOUR_H_MS) * FOUR_H_MS;
    return buys
      .filter(Number.isFinite)
      .map(convert)
      .map((t) => (is4hKey ? (axisLooksLikeSeconds ? toSec(snap4h(toMs(t))) : snap4h(t)) : t));
  }, [buys, data, axisLooksLikeSeconds]);

  const firstX = data && data.length ? data[0]?.[xKey] : null;
  const lastX  = data && data.length ? data[data.length-1]?.[xKey] : null;

  const buyXsClean = useMemo(()=>{
    const set = new Set(buyXs.filter((x)=> Number.isFinite(x)));
    return Array.from(set).sort((a,b)=>a-b);
  }, [buyXs]);

  const renderBuyMarkers = () => {
    if (!buyXsClean.length || !Number.isFinite(firstX) || !Number.isFinite(lastX)) return null;
    const halfWidth = axisLooksLikeSeconds ? 15 * 60 : 15 * 60 * 1000; // 15 minutes in axis units

    return buyXsClean.map((x,i)=>{
      const atEdge = (x <= firstX) || (x >= lastX);
      if (atEdge){
        return (
          <ReferenceArea
            key={"macd-buy-area-"+x+"-"+i}
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
          key={"macd-buy-line-"+x+"-"+i}
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
      <LineChart data={data} syncId={syncId}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey={xKey}
          xAxisId={xId}
          domain={["dataMin","dataMax"]}
          allowDataOverflow
        />
        <YAxis allowDataOverflow />
        <Tooltip
          labelFormatter={(v)=> new Date(axisLooksLikeSeconds ? v*1000 : v).toISOString().replace(".000Z","Z")}
          formatter={(val, name)=> [Number.isFinite(val) ? val : val, name]}
        />

        {/* Histogram if present */}
        <Area type="monotone" dataKey="hist" dot={false} isAnimationActive={false} />

        {/* MACD and signal */}
        <Line type="monotone" dataKey="macd"   stroke="#8884d8" dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="signal" stroke="#222222" dot={false} isAnimationActive={false} />

        {/* Zero line */}
        <ReferenceLine y={0} stroke="#cccccc" strokeDasharray="4 3" />

        {/* BUY markers */}
        {renderBuyMarkers()}
      </LineChart>
    </ResponsiveContainer>
  );
}
