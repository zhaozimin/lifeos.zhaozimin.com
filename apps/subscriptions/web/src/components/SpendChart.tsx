/**
 * [INPUT]: 依赖 summary.curve 的扣款桶
 * [OUTPUT]: 对外提供未来 12 个月预计扣款图。移到某个月份列上显示金额
 * [POS]: components 的统计图，统计页消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useMemo, useRef, useState } from "react";
import { yuan } from "../lib/format";
import {isVisitor} from '../visitor';

export type CurvePoint = { month: string; fen: number; yuan: string };

const WIDTH = 840;
const HEIGHT = 188;
const PAD_X = 20;
const PAD_TOP = 18;
const PAD_BOTTOM = 28;

export function SpendChart({ points }: { points: CurvePoint[] }) {
  const months = fillMonths(points, 12);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{
    month: string;
    yuan: string;
    left: number;
    top: number;
    x: number;
  } | null>(null);

  const coords = useMemo(() => {
    if (months.length === 0) return [];
    const max = Math.max(...months.map((point) => point.fen), 1);
    const innerW = WIDTH - PAD_X * 2;
    const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
    return months.map((point, index) => {
      const x = PAD_X + (months.length === 1 ? innerW / 2 : (index / (months.length - 1)) * innerW);
      const y = PAD_TOP + innerH - (point.fen / max) * innerH;
      return { ...point, x, y };
    });
  }, [months]);

  if (months.length === 0) return null;

  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
  const area = `${line} L${coords[coords.length - 1].x} ${HEIGHT - PAD_BOTTOM} L${coords[0].x} ${HEIGHT - PAD_BOTTOM} Z`;

  function pickMonth(clientX: number) {
    const svg = svgRef.current;
    if (!svg || coords.length === 0) return null;
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * WIDTH;
    let best = coords[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const point of coords) {
      const dist = Math.abs(point.x - x);
      if (dist < bestDist) {
        best = point;
        bestDist = dist;
      }
    }
    return {
      month: best.month,
      yuan: best.yuan,
      x: best.x,
      left: (best.x / WIDTH) * rect.width,
      top: (best.y / HEIGHT) * rect.height,
    };
  }

  return (
    <figure className="chart-wrap mt-6">
      <p className="meta">{isVisitor()?'费用趋势（示意，金额已隐藏）':'未来 12 个月预计扣款'}</p>
      <div className="chart-stage mt-2">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label="未来十二个月预计扣款走势，移到月份上看金额"
        onMouseMove={(event) => setHover(pickMonth(event.clientX))}
        onMouseLeave={() => setHover(null)}
      >
        <path d={area} fill="var(--ink)" fillOpacity="0.06" />
        <path
          d={line}
          fill="none"
          stroke="var(--ink)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hover ? (
          <line
            x1={hover.x}
            x2={hover.x}
            y1={PAD_TOP}
            y2={HEIGHT - PAD_BOTTOM}
            stroke="var(--ink)"
            strokeOpacity="0.28"
            strokeWidth="1"
          />
        ) : null}
        {coords.map((point) => (
          <circle
            key={point.month}
            cx={point.x}
            cy={point.y}
            r={hover?.month === point.month ? 5 : 2.5}
            fill="var(--ink)"
          />
        ))}
        {coords.map((point) => (
          <text
            key={`${point.month}-label`}
            x={point.x}
            y={HEIGHT - 8}
            textAnchor="middle"
            fill={hover?.month === point.month ? "var(--ink)" : "var(--muted)"}
            fontSize="var(--fs-kicker)"
          >
            {tickLabel(point.month)}
          </text>
        ))}
      </svg>
      {hover ? (
        <div
          className="chart-tip"
          style={{
            left: hover.left,
            top: hover.top,
            transform: "translate(-50%, calc(-100% - 10px))",
          }}
        >
          {tickLabel(hover.month)} · <span className="money">{yuan(hover.yuan)}</span>
        </div>
      ) : null}
      </div>
      <figcaption className="caption mt-1">
        按账单日归进日历月。高峰 {peakLabel(months)}。移到月份上看金额。
      </figcaption>
    </figure>
  );
}

function fillMonths(points: CurvePoint[], count: number): CurvePoint[] {
  if (points.length === 0) return [];
  const byMonth = new Map(points.map((point) => [point.month, point]));
  const [year0, month0] = points[0].month.split("-").map(Number);
  const filled: CurvePoint[] = [];
  let year = year0;
  let month = month0;
  for (let i = 0; i < count; i += 1) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    filled.push(byMonth.get(key) ?? { month: key, fen: 0, yuan: "0.00" });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return filled;
}

function tickLabel(month: string): string {
  return `${Number(month.slice(5))}月`;
}

function peakLabel(points: CurvePoint[]): string {
  const peak = points.reduce((best, point) => (point.fen > best.fen ? point : best), points[0]);
  return `${Number(peak.month.slice(5))} 月 ${yuan(peak.yuan)}`;
}
