/**
 * [INPUT]: 依赖 aiTrack 的 AiActivityCluster/AiConcurrencyBand/AiDayTouchpoint/AiBandSessionItem 模型与推理强度格式化纯函数，以及 nature 的时长格式化。
 * [OUTPUT]: 对外提供 AiModelLogo（多厂商内联 SVG 标志）、estimateAiClusterCardHeight、needsAiCallout、AiInlineBlock（具体事项右半栏 AI 并行块）、AiDetailCard（右侧细节栏联动卡）与 AiTrackPopover（周视图/关细节栏时的鼠标旁浮层）。
 * [POS]: components/timeline 的 AI 详情表现层；被 DayTimeline 与 WeekTimeline 共用，严守纸墨朱视觉语言。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import {
  formatMinuteClock,
  formatModelDisplayName,
  formatProviderName,
  formatReasoningEffort,
} from "../../lib/aiTrack";
import type {
  AiActivityCluster,
  AiBandSessionItem,
  AiConcurrencyBand,
  AiDayTouchpoint,
} from "../../lib/aiTrack";
import { formatMinutes } from "../../lib/nature";

type BrandKind = "claude" | "openai" | "gemini" | "grok" | "generic";

function resolveBrand(model: string | null | undefined, provider: string): BrandKind {
  const m = (model || "").toLowerCase();
  const p = provider.toLowerCase();
  if (m.includes("claude") || p === "claude") return "claude";
  if (m.startsWith("gpt") || m.includes("codex") || /^o[134](?:-|$)/.test(m) || p === "codex" || p === "openai") {
    return "openai";
  }
  if (m.includes("gemini") || p === "antigravity" || p === "gemini" || p === "google") return "gemini";
  if (m.includes("grok") || p === "grok" || p === "xai") return "grok";
  return "generic";
}

/**
 * 轻量内联品牌 Logo（15×15，零外部图片请求，支持浅色/暗色主题）。
 */
export function AiModelLogo({
  model,
  provider,
  size = 14,
}: {
  model: string | null | undefined;
  provider: string;
  size?: number;
}) {
  const brand = resolveBrand(model, provider);

  if (brand === "claude") {
    return (
      <span className="timeos-ai-logo timeos-ai-logo--claude" aria-hidden="true">
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <path
            d="M8 1.4v13.2M2.3 4.7l11.4 6.6M13.7 4.7L2.3 11.3M4.7 2.3l6.6 11.4M11.3 2.3L4.7 13.7"
            stroke="currentColor"
            strokeWidth="1.55"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }

  if (brand === "openai") {
    return (
      <span className="timeos-ai-logo timeos-ai-logo--openai" aria-hidden="true">
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.35" />
          <path
            d="M8 1.8a3.2 3.2 0 0 1 2.9 4.5M13.4 4.9a3.2 3.2 0 0 1-1.7 4.9M13.4 11.1a3.2 3.2 0 0 1-5.1.8M8 14.2a3.2 3.2 0 0 1-2.9-4.5M2.6 11.1a3.2 3.2 0 0 1 1.7-4.9M2.6 4.9a3.2 3.2 0 0 1 5.1-.8"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }

  if (brand === "gemini") {
    return (
      <span className="timeos-ai-logo timeos-ai-logo--gemini" aria-hidden="true">
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <path
            d="M8 1.2C8.55 5.15 10.85 7.45 14.8 8C10.85 8.55 8.55 10.85 8 14.8C7.45 10.85 5.15 8.55 1.2 8C5.15 7.45 7.45 5.15 8 1.2Z"
            fill="currentColor"
          />
        </svg>
      </span>
    );
  }

  if (brand === "grok") {
    return (
      <span className="timeos-ai-logo timeos-ai-logo--grok" aria-hidden="true">
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.45" />
          <path d="M4.2 12.2L12.6 3.2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  return (
    <span className="timeos-ai-logo timeos-ai-logo--generic" aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5.5 8h5M8 5.5v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

const COMPACT_MAX_ROWS = 3;

/**
 * 估算右侧细节栏 AI 卡片在默认静息态的像素高度，供 placeVariableCallouts 避免重叠。
 */
export function estimateAiClusterCardHeight(cluster: AiActivityCluster): number {
  const visibleRows = Math.min(cluster.sessions.length, COMPACT_MAX_ROWS);
  const hasMoreBadge = cluster.sessions.length > COMPACT_MAX_ROWS ? 16 : 0;
  return 28 + Math.max(1, visibleRows) * 22 + hasMoreBadge + 10;
}

/**
 * 判断具体事项右半栏的 AI 块在当前缩放高度下是否无法完整展示全部并发模型明细；
 * 无法完整展示时由右侧「细节」栏承接完整卡片并拉出短折线。
 */
export function needsAiCallout(cluster: AiActivityCluster, blockHeightPx: number): boolean {
  const requiredInlineHeight = 32 + Math.max(1, cluster.sessions.length) * 22 + 24;
  return blockHeightPx < requiredInlineHeight;
}

function uniqueBrandSessions(sessions: readonly AiBandSessionItem[]): AiBandSessionItem[] {
  const seen = new Set<BrandKind>();
  const picked: AiBandSessionItem[] = [];
  for (const item of sessions) {
    const brand = resolveBrand(item.model, item.provider);
    if (seen.has(brand)) continue;
    seen.add(brand);
    picked.push(item);
    if (picked.length >= 4) break;
  }
  return picked;
}

function findBandAtMinute(
  bands: readonly AiConcurrencyBand[],
  minute: number,
): AiConcurrencyBand | null {
  if (bands.length === 0) return null;
  let nearest = bands[0];
  let bestDist = Infinity;
  for (const band of bands) {
    if (minute >= band.startMinute && minute <= band.endMinute) return band;
    const center = (band.startMinute + band.endMinute) / 2;
    const dist = Math.abs(minute - center);
    if (dist < bestDist) {
      bestDist = dist;
      nearest = band;
    }
  }
  return nearest;
}

function AiSessionRow({
  item,
  liveState,
}: {
  item: AiBandSessionItem;
  liveState?: "live" | "dim" | "idle";
}) {
  const modelName = formatModelDisplayName(item.model, item.provider);
  const effort = formatReasoningEffort(item.reasoningEffort);
  return (
    <div className="timeos-ai-model-row" data-live={liveState && liveState !== "idle" ? liveState : undefined}>
      <div className="timeos-ai-model-row__main">
        <AiModelLogo model={item.model} provider={item.provider} />
        <span className="timeos-ai-model-row__model" title={item.model || item.provider}>
          {modelName}
        </span>
        {effort && (
          <span className="timeos-ai-effort-pill" data-tier={effort.tier} title={`推理强度：${effort.label}`}>
            {effort.label}
          </span>
        )}
        {item.turnCount > 1 && (
          <span className="timeos-ai-model-row__count">×{item.turnCount}</span>
        )}
      </div>
      <span className="timeos-ai-model-row__project" title={item.projectLabel}>
        {item.projectLabel}
      </span>
    </div>
  );
}

/* ============================================================
 *  具体事项右半栏：AI 并行块（左侧并发强度脊线 + 触点 + 自适应模型明细）
 * ============================================================ */
export function AiInlineBlock({
  cluster,
  bands,
  touchpoints,
  activeBand = null,
  highlighted = false,
  pinned = false,
  style,
  onBandHover,
  onClusterLeave,
  onFocus,
  onBlur,
  onClick,
}: {
  cluster: AiActivityCluster;
  bands: readonly AiConcurrencyBand[];
  touchpoints: readonly AiDayTouchpoint[];
  activeBand?: AiConcurrencyBand | null;
  highlighted?: boolean;
  pinned?: boolean;
  style?: CSSProperties;
  onBandHover?: (band: AiConcurrencyBand | null, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onClusterLeave?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onClick?: () => void;
}) {
  const isLiveBand = Boolean(activeBand && activeBand.clusterId === cluster.id);
  const liveKeys = isLiveBand && activeBand
    ? new Set(activeBand.sessions.map((s) => s.key))
    : null;
  const displayConc = isLiveBand && activeBand ? activeBand.concurrency : cluster.peakConcurrency;
  const displayLevel = isLiveBand && activeBand ? activeBand.level : cluster.level;
  const displayStart = isLiveBand && activeBand ? activeBand.startMinute : cluster.startMinute;
  const displayEnd = isLiveBand && activeBand ? activeBand.endMinute : cluster.endMinute;
  const displayAgentMin = Math.max(
    1,
    Math.round(isLiveBand && activeBand ? activeBand.agentMinutes : cluster.agentMinutes),
  );
  const span = Math.max(0.01, cluster.endMinute - cluster.startMinute);
  const brandIcons = uniqueBrandSessions(cluster.sessions);
  const primaryProject = cluster.projects[0] || "AI 并行";
  const projectSummary = cluster.projects.length > 1
    ? `${primaryProject} 等${cluster.projects.length}项`
    : primaryProject;
  const isCruise = cluster.touchpointCount === 0;
  const isMobileOnly = cluster.mobileTouchCount > 0 && cluster.mobileTouchCount === cluster.touchpointCount;
  const modeLabel = isCruise
    ? "后台放飞"
    : isMobileOnly
      ? "手机遥控"
      : "AI 并行";

  const handlePointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!onBandHover) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.height > 0
      ? Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
      : 0.5;
    const minute = cluster.startMinute + ratio * (cluster.endMinute - cluster.startMinute);
    onBandHover(findBandAtMinute(bands, minute), event);
  };

  return (
    <div
      className="timeos-ai-block"
      data-level={displayLevel}
      data-highlighted={highlighted || undefined}
      data-pinned={pinned || undefined}
      style={style}
    >
      {/* 左侧并发强度脊线：按时间比例映射该簇内各阶并发条带与本机/手机触点 */}
      <div className="timeos-ai-block__spine" aria-hidden="true">
        {bands.map((band) => {
          const topPct = ((band.startMinute - cluster.startMinute) / span) * 100;
          const heightPct = Math.max(2, ((band.endMinute - band.startMinute) / span) * 100);
          const isExact = activeBand?.id === band.id;
          return (
            <span
              key={band.id}
              className="timeos-ai-block__slice"
              data-level={band.level}
              data-active={isExact || undefined}
              style={{ top: `${topPct}%`, height: `${heightPct}%` }}
            />
          );
        })}
        {touchpoints.map((tp) => {
          const topPct = Math.min(98, Math.max(2, ((tp.minute - cluster.startMinute) / span) * 100));
          const originLabel = tp.deviceOrigin === "mobile" ? "手机遥控" : "本机指令";
          return (
            <span
              key={tp.id}
              className="timeos-ai-block__dot"
              data-origin={tp.deviceOrigin}
              data-active={highlighted || undefined}
              style={{ top: `${topPct}%` }}
              title={`${tp.timeLabel} · ${originLabel} · ${formatProviderName(tp.provider)}`}
            />
          );
        })}
      </div>

      <button
        type="button"
        className="timeos-ai-block__surface"
        aria-label={`AI 并行 ${formatMinuteClock(displayStart)} 至 ${formatMinuteClock(displayEnd)}，并发 ×${displayConc}，${cluster.projects.join("、")}`}
        aria-pressed={pinned || undefined}
        onPointerEnter={handlePointer}
        onPointerMove={handlePointer}
        onPointerLeave={onClusterLeave}
        onFocus={onFocus}
        onBlur={onBlur}
        onClick={onClick}
      >
        <div className="timeos-ai-block__head">
          <span className="timeos-ai-callout-card__badge" data-level={displayLevel}>
            ×{displayConc}
          </span>
          <span className="timeos-ai-block__logos" aria-hidden="true">
            {brandIcons.map((item) => (
              <AiModelLogo key={item.key} model={item.model} provider={item.provider} size={13} />
            ))}
          </span>
          <strong className="timeos-ai-block__title">{projectSummary}</strong>
          <span className="timeos-ai-block__mode" data-cruise={isCruise ? "true" : undefined}>
            {modeLabel}
          </span>
          <span className="timeos-ai-block__time tabular-nums">
            {formatMinuteClock(displayStart)}–{formatMinuteClock(displayEnd)}
          </span>
          <span className="timeos-ai-block__compute tabular-nums">
            工时 {formatMinutes(displayAgentMin)}
          </span>
        </div>

        <div className="timeos-ai-block__sub tabular-nums">
          <span>{formatMinuteClock(displayStart)}–{formatMinuteClock(displayEnd)}</span>
          <span>·</span>
          <span>{modeLabel}</span>
          <span>·</span>
          <span>{cluster.sessions.length} 个模型</span>
          {cluster.touchpointCount > 0 && (
            <>
              <span>·</span>
              <span>交互 {cluster.touchpointCount}</span>
            </>
          )}
        </div>

        <div className="timeos-ai-block__rows">
          {cluster.sessions.map((item) => (
            <AiSessionRow
              key={item.key}
              item={item}
              liveState={liveKeys ? (liveKeys.has(item.key) ? "live" : "dim") : "idle"}
            />
          ))}
        </div>

        <div className="timeos-ai-block__foot tabular-nums">
          <span>工具 {cluster.toolCallCount} 次</span>
          <span>
            交互 {cluster.touchpointCount} 次
            {cluster.mobileTouchCount > 0 ? `（手机 ${cluster.mobileTouchCount}）` : ""}
          </span>
          {cluster.waitHumanMinutes >= 1 && (
            <span>已剔除等待 {formatMinutes(Math.round(cluster.waitHumanMinutes))}</span>
          )}
        </div>
      </button>
    </div>
  );
}

export function AiDetailCard({
  cluster,
  activeBand = null,
  highlighted = false,
  pinned = false,
  style,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  onClick,
}: {
  cluster: AiActivityCluster;
  activeBand?: AiConcurrencyBand | null;
  highlighted?: boolean;
  pinned?: boolean;
  style?: CSSProperties;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onClick?: () => void;
}) {
  const isLiveBand = Boolean(activeBand && activeBand.clusterId === cluster.id);
  const liveKeys = isLiveBand && activeBand
    ? new Set(activeBand.sessions.map((s) => s.key))
    : null;
  const displayStart = isLiveBand && activeBand ? activeBand.startMinute : cluster.startMinute;
  const displayEnd = isLiveBand && activeBand ? activeBand.endMinute : cluster.endMinute;
  const displayConc = isLiveBand && activeBand ? activeBand.concurrency : cluster.peakConcurrency;
  const displayLevel = isLiveBand && activeBand ? activeBand.level : cluster.level;
  const displayAgentMin = Math.max(
    1,
    Math.round(isLiveBand && activeBand ? activeBand.agentMinutes : cluster.agentMinutes),
  );
  const isCruise = cluster.touchpointCount === 0;
  const isMobileOnly = cluster.mobileTouchCount > 0 && cluster.mobileTouchCount === cluster.touchpointCount;
  const expanded = highlighted || pinned;
  const visibleSessions = expanded
    ? cluster.sessions
    : cluster.sessions.slice(0, COMPACT_MAX_ROWS);
  const hiddenCount = cluster.sessions.length - visibleSessions.length;

  return (
    <button
      type="button"
      className="timeos-ai-callout-card"
      data-level={displayLevel}
      data-highlighted={highlighted || undefined}
      data-pinned={pinned || undefined}
      style={style}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      onClick={onClick}
      aria-label={`Orca AI ${formatMinuteClock(displayStart)} 至 ${formatMinuteClock(displayEnd)}，并发 ×${displayConc}，${cluster.projects.join("、")}`}
    >
      <div className="timeos-ai-callout-card__head">
        <span className="timeos-ai-callout-card__badge" data-level={displayLevel}>
          ×{displayConc}
        </span>
        <strong className="timeos-ai-callout-card__time tabular-nums">
          {formatMinuteClock(displayStart)}–{formatMinuteClock(displayEnd)}
        </strong>
        {isCruise && (
          <span className="timeos-ai-callout-card__tag timeos-ai-callout-card__tag--cruise">后台放飞</span>
        )}
        {!isCruise && isMobileOnly && (
          <span className="timeos-ai-callout-card__tag">手机遥控</span>
        )}
        <span className="timeos-ai-callout-card__compute tabular-nums">
          工时 {formatMinutes(displayAgentMin)}
        </span>
      </div>

      <div className="timeos-ai-callout-card__rows">
        {visibleSessions.map((item) => (
          <AiSessionRow
            key={item.key}
            item={item}
            liveState={liveKeys ? (liveKeys.has(item.key) ? "live" : "dim") : "idle"}
          />
        ))}
        {hiddenCount > 0 && (
          <div className="timeos-ai-callout-card__more">
            +{hiddenCount} 个并发任务 · 悬停查看全部
          </div>
        )}
      </div>

      {expanded && (
        <div className="timeos-ai-callout-card__foot tabular-nums">
          <span>工具 {cluster.toolCallCount} 次</span>
          <span>
            交互 {cluster.touchpointCount} 次
            {cluster.mobileTouchCount > 0 ? `（手机 ${cluster.mobileTouchCount}）` : ""}
          </span>
          {cluster.waitHumanMinutes >= 1 && (
            <span>已剔除等待 {formatMinutes(Math.round(cluster.waitHumanMinutes))}</span>
          )}
        </div>
      )}
    </button>
  );
}

/**
 * 周视图或单日关闭「细节栏」时，在鼠标旁边平滑弹出的 AI 交互简介浮层（复用同一套模型 Logo + 推理强度行）。
 */
export function AiTrackPopover({
  band,
  cluster,
  x,
  y,
}: {
  band: AiConcurrencyBand;
  cluster?: AiActivityCluster | null;
  x: number;
  y: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x + 16, top: y - 20 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = x + 16 + rect.width <= vw - 12
      ? x + 16
      : Math.max(12, x - rect.width - 16);
    const top = Math.max(12, Math.min(vh - rect.height - 12, y - 24));
    setPos({ left, top });
  }, [x, y, band.id]);

  if (typeof document === "undefined") return null;

  const durationMin = Math.max(1, Math.round(band.endMinute - band.startMinute));
  const isCruise = cluster ? cluster.touchpointCount === 0 : band.touchpointCount === 0;
  return createPortal(
    <div
      ref={ref}
      className="timeos-ai-popover"
      data-level={band.level}
      style={{ left: pos.left, top: pos.top }}
      role="tooltip"
    >
      <div className="timeos-ai-callout-card__head">
        <span className="timeos-ai-callout-card__badge" data-level={band.level}>
          ×{band.concurrency} 并发
        </span>
        <strong className="timeos-ai-callout-card__time tabular-nums">
          {formatMinuteClock(band.startMinute)}–{formatMinuteClock(band.endMinute)}
        </strong>
        {isCruise && (
          <span className="timeos-ai-callout-card__tag timeos-ai-callout-card__tag--cruise">后台放飞</span>
        )}
        <span className="timeos-ai-callout-card__compute tabular-nums">
          {formatMinutes(durationMin)} · 工时 {formatMinutes(Math.max(1, Math.round(band.agentMinutes)))}
        </span>
      </div>

      <div className="timeos-ai-callout-card__rows">
        {band.sessions.map((item) => (
          <AiSessionRow key={item.key} item={item} liveState="live" />
        ))}
      </div>

      <div className="timeos-ai-callout-card__foot tabular-nums">
        <span>工具 {band.toolCallCount} 次</span>
        <span>
          交互 {band.touchpointCount} 次
          {band.mobileTouchCount > 0 ? `（手机 ${band.mobileTouchCount}）` : ""}
        </span>
        {band.waitHumanMinutes >= 1 && (
          <span>已剔除等待 {formatMinutes(Math.round(band.waitHumanMinutes))}</span>
        )}
      </div>
    </div>,
    document.body,
  );
}
