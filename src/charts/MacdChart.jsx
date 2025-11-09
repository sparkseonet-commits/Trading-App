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
  ResponsiveContainer,
} from "recharts";

const FOUR_H_MS = 4 * 60 * 60 * 1000;
const TEN_BILLION = 10_000_000_000;

const toMs = (v) => (v && v < TEN_BILLION ? v * 1000 : v);
const toSec = (v) => (v && v > TEN_BILLION ? Math.floor(v / 1000) : v);

export default function MacdChart({ data = [], buyLines = [], syncId, height = 160 }){
  const axisLooksLikeSeconds = useMemo(()=>{
    const first = data && data.length ? data[0]?.ts : null;
    return first && first < TEN_BILLION;
  }, [data]);

  const buyXs = useMemo(()=>{
    if (!Array.isArray(buyLines)) return [];
    const convert = axisLooksLikeSeconds ? toSec : toMs;
    return buyLines
      .filter(Number.isFinite)
      .map(convert)
      .map((t)=> {
        const snapped = Math.floor(toMs(t) / FOUR_H_MS) * FOUR_H_MS;
        return axisLooksLikeSeconds ? toSec(snapped) : snapped;
      });
  }, [buyLines, axisLooksLikeSeconds]);

  return (
    <div className="h-[160px]">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }} syncId={syncId}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="ts"
            domain={["dataMin", "dataMax"]}
            minTickGap={16}
            tickFormatter={(v)=>{
              const ms = axisLooksLikeSeconds ? v * 1000 : v;
              const d = new Date(ms);
              return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
            }}
          />
          <YAxis domain={["auto", "auto"]} />
          <Tooltip
            labelFormatter={(l)=>{
              const ms = axisLooksLikeSeconds ? l * 1000 : l;
              return new Date(ms).toISOString().replace("T", " ").slice(0, 16);
            }}
          />
          <Line type="monotone" dataKey="macd" name="MACD" dot={false} strokeWidth={1.5} />
          <Line type="monotone" dataKey="macdSig" name="Signal" dot={false} strokeWidth={1.2} strokeDasharray="4 2" />
          <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" ifOverflow="clip" />
          {buyXs.map((ts, i)=>(
            <ReferenceLine
              key={`macd-buy-${ts}-${i}`}
              x={ts}
              stroke="green"
              strokeDasharray="6 4"
              ifOverflow="extendDomain"
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
