// src/charts/BuyTable.jsx
import React from "react";

/**
 * BuyTable
 * - Simple presentational table showing detected BUY events.
 *
 * Props:
 *  - buys: Array<{ ts:number, confidence?:number, parts?:Record<string,number> }>
 *  - title?: string
 *  - maxRows?: number   // show only the most recent N
 */
export default function BuyTable({ buys = [], title = "Buy Signals", maxRows = 50 }){
  const fmtISO = (t)=> {
    if (!Number.isFinite(t)) return "";
    const ms = t < 10_000_000_000 ? t * 1000 : t;
    return new Date(ms).toISOString().replace(".000Z","Z");
  };

  const rows = Array.isArray(buys) ? [...buys].sort((a,b)=> (a.ts - b.ts)).slice(-maxRows).reverse() : [];

  return (
    <div className="buy-table">
      <h3 style={{ margin: "8px 0" }}>{title}</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>#</th>
              <th style={th}>Time (UTC)</th>
              <th style={th}>Confidence</th>
              <th style={th}>Parts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b, i)=>{
              const conf = Number.isFinite(b.confidence) ? b.confidence.toFixed(2) : "";
              const parts = b.parts && typeof b.parts === "object"
                ? Object.entries(b.parts).filter(([k,v])=> v>0).map(([k,v])=> `${k}:${v}`).join(", ")
                : "";
              return (
                <tr key={b.ts + "-" + i}>
                  <td style={td}>{i+1}</td>
                  <td style={td}>{fmtISO(b.ts)}</td>
                  <td style={td}>{conf}</td>
                  <td style={td}>{parts}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={4} style={td}>No buys in view.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th = {
  textAlign: "left",
  borderBottom: "1px solid #ddd",
  padding: "6px 8px",
  whiteSpace: "nowrap",
};

const td = {
  borderBottom: "1px solid #f0f0f0",
  padding: "6px 8px",
  fontSize: 13,
};
