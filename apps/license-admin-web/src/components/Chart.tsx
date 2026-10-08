import { useEffect, useRef, useState } from 'react';

function niceCeil(v: number): number {
  if (v <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** Single-series daily bar chart (pure SVG, no chart lib). */
export function BarChart({
  data,
  color = 'fill-blue-400',
}: {
  data: { day: string; count: number }[];
  color?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setW(Math.max(320, Math.round(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 200;
  const padL = 32;
  const padR = 12;
  const padT = 12;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const max = Math.max(1, ...data.map((d) => d.count));
  const niceMax = niceCeil(max);
  const n = Math.max(1, data.length);
  const slot = plotW / n;
  const barW = Math.max(2, Math.min(18, slot - 3));
  const y = (v: number) => padT + plotH - (v / niceMax) * plotH;
  const labelEvery = Math.max(1, Math.ceil(n / 7));
  const gridLines = [0, 0.5, 1].map((f) => ({ yy: padT + plotH - f * plotH, val: Math.round(niceMax * f) }));
  const fmtX = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

  return (
    <div ref={wrapRef} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" className="block">
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={g.yy} y2={g.yy} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
            <text x={padL - 6} y={g.yy + 3} textAnchor="end" className="fill-neutral-600" fontSize={10}>
              {g.val}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + i * slot + slot / 2;
          return (
            <g key={d.day}>
              <rect
                x={cx - barW / 2}
                y={y(d.count)}
                width={barW}
                height={Math.max(0, padT + plotH - y(d.count))}
                rx={1.5}
                className={color}
                opacity={0.85}
              >
                <title>{`${fmtX(d.day)} · ${d.count}`}</title>
              </rect>
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" className="fill-neutral-600" fontSize={10}>
                  {fmtX(d.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
