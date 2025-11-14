// components/LinesSVG.jsx
import React from "react";

export default function LinesSVG({ lines }) {
  return (
    <svg className="absolute inset-0 w-full h-full z-10 pointer-events-none">
      {lines.map((line) => (
        <path
          key={line.id}
          d={line.d}
          stroke="#64748B"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity="0.65"
        />
      ))}
    </svg>
  );
}