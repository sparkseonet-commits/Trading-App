// src/charts/PriceChart.jsx
import React, { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

const FOUR_H_MS = 4 * 60 * 60 * 1000;
const TEN_BILLION = 10_000_000_000;

const formatDateShort = (ts) => {
  if (!Number.isFinite(ts)) return "";
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const toMs = (v) => (v && v < TEN_BILLION ? v * 1000 : v);
const toSec = (v) => (v && v > TEN_BILLION ? Math.floor(v / 1000) : v);

export default function PriceChart({ data = [], buyLines = [], syncId, height = 480 }){
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
    <div className="h-[480px]">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 10 }} syncId={syncId}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="ts"
            tickFormatter={(v)=> formatDateShort(axisLooksLikeSeconds ? v * 1000 : v)}
            domain={["dataMin", "dataMax"]}
            minTickGap={16}
          />
          <YAxis yAxisId="price" domain={["auto", "auto"]} />
          <YAxis
            yAxisId="pi"
            orientation="right"
            domain={[0, 1]}
            tickFormatter={(v)=> Number(v).toFixed(2)}
            allowDecimals
          />
          <Tooltip
            formatter={(v, n)=> [typeof v === "number" ? Number(v).toFixed(2) : v, n]}
            labelFormatter={(l)=>{
              const ms = axisLooksLikeSeconds ? l * 1000 : l;
              return new Date(ms).toISOString().replace("T", " ").slice(0, 16);
            }}
          />
          <Line yAxisId="price" type="monotone" dataKey="close" name="Close (4h)" dot={false} strokeWidth={2} />
          <Line yAxisId="price" type="monotone" dataKey="sma7" name="SMA 7d" dot={false} strokeDasharray="4 2" />
          <Line yAxisId="price" type="monotone" dataKey="sma30" name="SMA 30d" dot={false} strokeDasharray="3 3" />
          <Line yAxisId="price" type="monotone" dataKey="sma90" name="SMA 90d" dot={false} strokeDasharray="6 2" />
          <Line yAxisId="pi" type="monotone" dataKey="pi" name="PI (111/(2*350))" dot={false} strokeWidth={1.5} stroke="#ec4899" />
          <ReferenceLine yAxisId="pi" y={0.3} stroke="#ec4899" strokeDasharray="4 2" ifOverflow="clip" />
          {buyXs.map((ts, i)=>(
            <ReferenceLine
              key={`price-buy-${ts}-${i}`}
              xAxisId={0}
              x={ts}
              stroke="green"
              strokeDasharray="6 4"
              label={{ value: "BUY", position: "top", fill: "green" }}
              ifOverflow="extendDomain"
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
