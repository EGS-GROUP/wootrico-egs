import { useEffect, useRef, useState } from 'react';
import type { StatsBucket } from '../lib/system-api';

/**
 * Lightweight grouped-bar chart (pure SVG, no chart lib) showing the flow of
 * messages received from WhatsApp vs sent via Chatwoot over time. Measures its
 * container so the SVG fills the full width (viewBox == pixel size → no
 * letterboxing / off-center scaling).
 */
export function FlowChart({
  buckets,
  range,
}: {
  buckets: StatsBucket[];
  range: '24h' | '7d';
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

  const H = 240;
  const padL = 36;
  const padR = 14;
  const padT = 12;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const max = Math.max(1, ...buckets.map((b) => Math.max(b.received, b.sent)));
  const niceMax = niceCeil(max);
  const n = Math.max(1, buckets.length);
  const slot = plotW / n;
  const barW = Math.max(2, Math.min(16, slot / 2 - 1.5));

  const y = (v: number) => padT + plotH - (v / niceMax) * plotH;

  const labelEvery = Math.max(1, Math.ceil(n / 6));

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    yy: padT + plotH - f * plotH,
    val: Math.round(niceMax * f),
  }));

  function fmtX(iso: string): string {
    const d = new Date(iso);
    return range === '7d'
      ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtFull(iso: string): string {
    const d = new Date(iso);
    return range === '7d'
      ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div ref={wrapRef} className="w-full">
      <div className="mb-3 flex flex-wrap items-center gap-5 text-xs text-neutral-400">
        <span className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-400" /> Recebidas (WhatsApp)
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-violet-400" /> Enviadas (Chatwoot)
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" className="block">
        {/* gridlines + y labels */}
        {gridLines.map((g, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={W - padR}
              y1={g.yy}
              y2={g.yy}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
            <text x={padL - 8} y={g.yy + 3} textAnchor="end" className="fill-neutral-600" fontSize={10}>
              {g.val}
            </text>
          </g>
        ))}

        {/* bars */}
        {buckets.map((b, i) => {
          const cx = padL + i * slot + slot / 2;
          const x1 = cx - barW - 1;
          const x2 = cx + 1;
          return (
            <g key={b.at}>
              <rect
                x={x1}
                y={y(b.received)}
                width={barW}
                height={Math.max(0, padT + plotH - y(b.received))}
                rx={1.5}
                className="fill-emerald-400"
                opacity={0.85}
              >
                <title>{`${fmtFull(b.at)} · recebidas: ${b.received}`}</title>
              </rect>
              <rect
                x={x2}
                y={y(b.sent)}
                width={barW}
                height={Math.max(0, padT + plotH - y(b.sent))}
                rx={1.5}
                className="fill-violet-400"
                opacity={0.85}
              >
                <title>{`${fmtFull(b.at)} · enviadas: ${b.sent}`}</title>
              </rect>
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 9} textAnchor="middle" className="fill-neutral-600" fontSize={10}>
                  {fmtX(b.at)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function niceCeil(v: number): number {
  if (v <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}
