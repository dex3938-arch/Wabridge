import { useState } from 'react';

// Two-series area chart (received vs sent) drawn as inline SVG — no chart library needed.
export default function AreaChart({ data, height = 220 }) {
  const [hover, setHover] = useState(null);
  const w = 720;
  const h = height;
  const pad = { l: 34, r: 12, t: 14, b: 26 };
  const max = Math.max(4, ...data.map((d) => Math.max(d.in, d.out)));
  const nice = Math.ceil(max / 4) * 4;
  const x = (i) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, data.length - 1);
  const y = (v) => pad.t + (1 - v / nice) * (h - pad.t - pad.b);
  const line = (key) => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  const area = (key) => `${line(key)} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const ticks = [0, nice / 4, nice / 2, (3 * nice) / 4, nice];
  const label = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Messages per day">
        <defs>
          <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0ea5e9" stopOpacity="0.28" />
            <stop offset="1" stopColor="#0ea5e9" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#059669" stopOpacity="0.28" />
            <stop offset="1" stopColor="#059669" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className="stroke-slate-200 dark:stroke-ink-700" strokeDasharray="3 4" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="fill-slate-400 text-[10px] tabular-nums">
              {Math.round(t)}
            </text>
          </g>
        ))}
        <path d={area('out')} fill="url(#gOut)" />
        <path d={area('in')} fill="url(#gIn)" />
        <path d={line('out')} fill="none" stroke="#059669" strokeWidth="2.2" strokeLinejoin="round" />
        <path d={line('in')} fill="none" stroke="#0ea5e9" strokeWidth="2.2" strokeLinejoin="round" />
        {data.map((d, i) =>
          i % 2 === 0 || i === data.length - 1 ? (
            <text key={d.day} x={x(i)} y={h - 6} textAnchor="middle" className="fill-slate-400 text-[10px]">
              {label(d.day)}
            </text>
          ) : null,
        )}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={y(0)} className="stroke-slate-300 dark:stroke-ink-600" />
            <circle cx={x(hover)} cy={y(data[hover].out)} r="4" fill="#059669" stroke="white" strokeWidth="2" />
            <circle cx={x(hover)} cy={y(data[hover].in)} r="4" fill="#0ea5e9" stroke="white" strokeWidth="2" />
          </g>
        )}
        {data.map((d, i) => (
          <rect
            key={d.day}
            x={x(i) - (w - pad.l - pad.r) / data.length / 2}
            y={0}
            width={(w - pad.l - pad.r) / data.length}
            height={h}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute top-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-[var(--shadow-pop)] dark:border-ink-600 dark:bg-ink-800"
          style={{ left: `${(x(hover) / w) * 100}%`, transform: `translateX(${hover > data.length / 2 ? '-110%' : '10%'})` }}
        >
          <p className="mb-1 font-bold">{label(data[hover].day)}</p>
          <p className="flex items-center gap-2"><span className="size-2 rounded-full bg-sky-500" /> Received <b className="ml-auto tabular-nums">{data[hover].in}</b></p>
          <p className="flex items-center gap-2"><span className="size-2 rounded-full bg-brand-500" /> Sent <b className="ml-auto tabular-nums">{data[hover].out}</b></p>
        </div>
      )}
    </div>
  );
}
