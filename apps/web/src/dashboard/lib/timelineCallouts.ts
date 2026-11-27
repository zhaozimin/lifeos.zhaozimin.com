/**
 * [INPUT]: 依赖调用方提供的短时段/AI 协作簇分钟边界、实际每分钟像素与细节标签尺寸。
 * [OUTPUT]: 对外提供 23px 可读性判定，以及等高 placeCallouts 与混合高度 placeVariableCallouts 不越界纵向排布纯函数。
 * [POS]: lib 的时间轴可读性算法层；只计算锚点与标签位置，不感知 React、DOM 或视觉样式。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/** 与 timeline.css 的 @container timeos-event (max-height: 23px) 同源。 */
export const TIMELINE_CALLOUT_MAX_HEIGHT = 23;

export interface CalloutInput {
  readonly id: string;
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface CalloutPlacement {
  readonly id: string;
  readonly anchorY: number;
  readonly labelY: number;
}

export function needsCallout(
  durationMinutes: number,
  pixelsPerMinute: number,
): boolean {
  return durationMinutes > 0
    && pixelsPerMinute > 0
    && durationMinutes * pixelsPerMinute <= TIMELINE_CALLOUT_MAX_HEIGHT;
}

export function placeCallouts(
  items: readonly CalloutInput[],
  options: {
    pixelsPerMinute: number;
    canvasHeight: number;
    labelHeight: number;
    labelGap: number;
  },
): CalloutPlacement[] {
  if (items.length === 0) return [];
  const { pixelsPerMinute, canvasHeight, labelHeight, labelGap } = options;
  if (![pixelsPerMinute, canvasHeight, labelHeight].every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError("引导线布局尺寸必须是有限正数。");
  }
  if (!Number.isFinite(labelGap) || labelGap < 0) {
    throw new RangeError("引导线标签间距必须是有限非负数。");
  }

  const anchors = items.map((item) => (
    (item.startMinute + item.endMinute) / 2 * pixelsPerMinute
  ));
  const usableHeight = Math.max(0, canvasHeight - labelHeight);
  const requiredHeight = items.length * labelHeight + (items.length - 1) * labelGap;

  // 画布物理上容不下全部标签时，允许标签互相靠近，但仍均匀铺满且不越界。
  if (requiredHeight > canvasHeight) {
    return items.map((item, index) => ({
      id: item.id,
      anchorY: anchors[index],
      labelY: items.length === 1 ? usableHeight / 2 : index / (items.length - 1) * usableHeight,
    }));
  }

  const positions: number[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const wanted = anchors[index] - labelHeight / 2;
    positions.push(index === 0
      ? wanted
      : Math.max(wanted, positions[index - 1] + labelHeight + labelGap));
  }

  if (positions[positions.length - 1] + labelHeight > canvasHeight) {
    for (let index = positions.length - 1; index >= 0; index -= 1) {
      positions[index] = Math.min(
        positions[index],
        index === positions.length - 1
          ? canvasHeight - labelHeight
          : positions[index + 1] - labelHeight - labelGap,
      );
    }
  }

  for (let index = 0; index < positions.length; index += 1) {
    positions[index] = Math.max(
      positions[index],
      index === 0 ? 0 : positions[index - 1] + labelHeight + labelGap,
    );
  }

  return items.map((item, index) => ({
    id: item.id,
    anchorY: anchors[index],
    labelY: positions[index],
  }));
}

export interface VariableCalloutInput extends CalloutInput {
  readonly height: number;
}

export interface VariableCalloutPlacement extends CalloutPlacement {
  readonly height: number;
}

/**
 * 支持混合高度卡片（人类短时段 30px 胶囊 + AI 并发详情卡）的无重叠纵向排布算法。
 * 与 placeCallouts 同源：三趟扫描（下推 → 底界回推 → 顶界夹紧），严守画布边界。
 */
export function placeVariableCallouts(
  items: readonly VariableCalloutInput[],
  options: {
    pixelsPerMinute: number;
    canvasHeight: number;
    labelGap: number;
  },
): VariableCalloutPlacement[] {
  if (items.length === 0) return [];
  const { pixelsPerMinute, canvasHeight, labelGap } = options;
  if (![pixelsPerMinute, canvasHeight].every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError("引导线布局尺寸必须是有限正数。");
  }
  if (!Number.isFinite(labelGap) || labelGap < 0) {
    throw new RangeError("引导线标签间距必须是有限非负数。");
  }

  const heights = items.map((item) => Math.max(16, item.height));
  const anchors = items.map((item) => (
    (item.startMinute + item.endMinute) / 2 * pixelsPerMinute
  ));
  const totalHeight = heights.reduce((sum, h) => sum + h, 0)
    + Math.max(0, items.length - 1) * labelGap;

  // 画布物理容不下全部展开高度时，按比例收缩间距以保证全部卡片留在画布内。
  if (totalHeight > canvasHeight) {
    const sumHeights = heights.reduce((sum, h) => sum + h, 0);
    const step = items.length > 1 ? (canvasHeight - heights[items.length - 1]) / (items.length - 1) : 0;
    let cursor = 0;
    return items.map((item, index) => {
      const y = sumHeights <= canvasHeight
        ? cursor
        : (items.length === 1 ? Math.max(0, (canvasHeight - heights[0]) / 2) : index * step);
      const effectiveGap = items.length > 1
        ? Math.max(2, (canvasHeight - sumHeights) / (items.length - 1))
        : 0;
      cursor += heights[index] + effectiveGap;
      return {
        id: item.id,
        anchorY: anchors[index],
        labelY: Math.max(0, Math.min(Math.max(0, canvasHeight - heights[index]), y)),
        height: heights[index],
      };
    });
  }

  const positions: number[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const wanted = anchors[i] - heights[i] / 2;
    positions.push(i === 0
      ? wanted
      : Math.max(wanted, positions[i - 1] + heights[i - 1] + labelGap));
  }

  const lastIdx = items.length - 1;
  if (positions[lastIdx] + heights[lastIdx] > canvasHeight) {
    for (let i = lastIdx; i >= 0; i -= 1) {
      positions[i] = Math.min(
        positions[i],
        i === lastIdx
          ? canvasHeight - heights[i]
          : positions[i + 1] - heights[i] - labelGap,
      );
    }
  }

  for (let i = 0; i < items.length; i += 1) {
    positions[i] = Math.max(
      positions[i],
      i === 0 ? 0 : positions[i - 1] + heights[i - 1] + labelGap,
    );
  }

  return items.map((item, index) => ({
    id: item.id,
    anchorY: anchors[index],
    labelY: positions[index],
    height: heights[index],
  }));
}

