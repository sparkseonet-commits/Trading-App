// src/charts/BuyTable.jsx
import React from "react";

const formatParts = (parts) => {
  if (!parts || typeof parts !== "object") return null;
  return Object.entries(parts)
    .filter(([, v])=> Number(v) > 0)
    .map(([k, v])=> `${k}: ${Number(v).toFixed(2)}`);
};

export default function BuyTable({ buys = [], formatDate }){
  if (!Array.isArray(buys) || buys.length === 0) {
    return <div className="text-gray-500 text-sm">No buys detected in the current window.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left border-b">
            <th className="py-2 pr-4">Date (1h)</th>
            <th className="py-2 pr-4">Confidence</th>
            <th className="py-2 pr-4">Contributors</th>
          </tr>
        </thead>
        <tbody>
          {buys.map((b, idx)=>(
            <tr key={`${b.ts}-${idx}`} className="border-b hover:bg-gray-50">
              <td className="py-2 pr-4 whitespace-nowrap">{formatDate ? formatDate(b.ts) : b.ts}</td>
              <td className="py-2 pr-4">{Number.isFinite(b.conf) ? Number(b.conf).toFixed(2) : (Number.isFinite(b.confidence) ? Number(b.confidence).toFixed(2) : "")}</td>
              <td className="py-2 pr-4">
                {b.parts ? (
                  <div className="flex flex-wrap gap-2">
                    {formatParts(b.parts)?.map((text)=>(
                      <span key={`${b.ts}-${text}`} className="px-2 py-1 rounded-full bg-green-100 text-green-700">{text}</span>
                    ))}
                  </div>
                ) : (
                  <span className="text-gray-500">Absolute</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
