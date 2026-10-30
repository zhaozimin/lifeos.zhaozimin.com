/**
 * [INPUT]: 依赖周期与金额字段及 format 的中文整数展示
 * [OUTPUT]: 提供到期圆环与金色余额圆环；足额只显示中文月数，不足显示余额缺口
 * [POS]: 卡片右侧的只读指标；两类指标共用圆环绘制，计费状态由服务端决定。
 *   到期圆环常绿；剩余不足 7 天变黄，不足 3 天变红（朱字）；已过期为灰
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Cycle } from "../types";
import { chineseInteger } from "../lib/format";

const SIZE = 52;
const STROKE = 8;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

export type DueTone = "ok" | "mid" | "late" | "end";

export function dueTone(daysLeft: number, ended: boolean): DueTone {
  if (ended || daysLeft < 0) return "end";
  // 常绿；不足 7 天变黄，不足 3 天变红
  if (daysLeft < 3) return "late";
  if (daysLeft < 7) return "mid";
  return "ok";
}

const TONE_COLOR: Record<DueTone, string> = {
  ok: "var(--due-ok)",
  mid: "var(--due-mid)",
  late: "var(--due-late)",
  end: "var(--muted)",
};

function Ring({ ratio, color, shown, label, unit, roundCaps = true, fontSize = "var(--fs-ui)", fontFamily = "var(--font-mono)" }: {
  ratio: number;
  color: string;
  shown: string | number;
  label: string;
  unit?: string;
  roundCaps?: boolean;
  fontSize?: string | number;
  fontFamily?: string;
}) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const dash = C * clamped;
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="shrink-0"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={R}
        fill="none"
        stroke="var(--faint)"
        strokeWidth={STROKE}
      />
      {clamped > 0 ? (
        <circle
          cx="0"
          cy="0"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap={roundCaps ? "round" : "butt"}
          strokeDasharray={`${dash} ${C - dash}`}
          transform={`translate(${SIZE / 2} ${SIZE / 2}) scale(-1 1) rotate(-90)`}
        />
      ) : null}
      <text
        x="50%"
        y={unit ? "43%" : "50%"}
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        fontSize={fontSize}
        fontWeight="600"
        fontFamily={fontFamily}
      >
        {shown}
      </text>
      {unit ? <text x="50%" y="70%" textAnchor="middle" dominantBaseline="central"
        fill={color} fontSize="calc(var(--fs-caption) * 0.7)" fontFamily="var(--font-sans)">{unit}</text> : null}
    </svg>
  );
}

export function CycleRing({
  daysLeft,
  ratio,
  ended,
}: {
  daysLeft: number;
  ratio: number;
  ended: boolean;
}) {
  const tone = dueTone(daysLeft, ended);
  const shown = daysLeft < 0 ? Math.abs(daysLeft) : daysLeft;
  return (
    <Ring
      ratio={ended || daysLeft <= 0 ? 0 : ratio}
      color={TONE_COLOR[tone]}
      shown={shown}
      label={
        ended || daysLeft < 0 ? `已过期 ${shown} 天` : daysLeft === 0 ? "今天" : `还剩 ${shown} 天`
      }
    />
  );
}

export function BalanceRing({ balanceFen, amountFen, cycle, cycleDays }: {
  balanceFen: number | null;
  amountFen: number;
  cycle: Cycle;
  cycleDays: number | null;
}) {
  if (balanceFen == null) return <Ring ratio={0} color="var(--muted)" shown="—" label="余额未设置" />;
  const color = "var(--balance-gold)";
  if (amountFen === 0) return <Ring ratio={1} color={color} shown="∞" label="订阅费为 0，无需抵扣余额" />;
  const sufficient = balanceFen >= amountFen;
  const cycles = Math.floor(balanceFen / amountFen);
  // 只计算余额能购买的完整周期，保留季付和年付的实际付款门槛。
  const months = cycle === "custom"
    ? String(BigInt(cycles) * BigInt(cycleDays ?? 1) / 30n)
    : String(cycles * { monthly: 1, quarterly: 3, yearly: 12 }[cycle]);
  const balance = String(balanceFen / 100);
  const shown = sufficient ? chineseInteger(months) : balance;
  const label = sufficient
    ? cycle === "custom" ? `余额可抵扣 ${cycles} 个周期；按 30 天折算 ${months} 个完整月` : `余额可抵扣 ${months} 个完整月`
    : `余额 ${balance} 元；订阅费 ${amountFen / 100} 元；还差 ${(amountFen - balanceFen) / 100} 元`;
  return <Ring ratio={sufficient ? 1 : balanceFen / amountFen} color={color} shown={shown} label={label}
    unit={sufficient ? undefined : "元"} roundCaps={false}
    fontFamily={sufficient ? "var(--font-sans)" : "var(--font-mono)"}
    fontSize={sufficient ? shown.length > 2 ? 32 / shown.length : "var(--fs-ui)"
      : shown.length > 4 ? 48 / shown.length : "var(--fs-ui)"} />;
}

export function isEnded(daysLeft: number, status: string, displayStatus: string): boolean {
  return daysLeft < 0 || status === "expired" || displayStatus === "expired";
}
