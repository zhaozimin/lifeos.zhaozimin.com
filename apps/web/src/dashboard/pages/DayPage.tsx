/**
 * [INPUT]: 依赖所见版本号和可取消的时段/统计/configuration API（含超长软标记阈值）、Layout 软刷新信号、记录时区与 UTC 当前瞬间、timeline 缩放/交互真源、日/周时间轴组件及共享编辑确认原语。
 * [OUTPUT]: 大类分布、来源筛选、日周时间轴、常显视图切换和本人版本编辑。
 * [POS]: pages 的时间账浏览核心；同时向时间轴下发墙钟当前分钟、绝对当前瞬间与服务端超长阈值（配置未到手即传 null），最后写入权、局部回填和手势几何下沉到领域模块。
 * 访客保留日周切换、浏览和缩放；页头与月历共用同一视图状态。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useOutletContext } from "react-router";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, History, Trash2 } from "lucide-react";
import { api, ApiError, isAbortError } from "../api/client";
import { addDays, isoDate, isoMinute, rangeForWeek, recordNow, shiftMinutes } from "../lib/dates";
import { deriveDayGaps } from "../lib/timeline";
import { TIMELINE_FIT_ZOOM_ID } from "../lib/timelineInteraction";
import type { TimelineZoomSelection } from "../lib/timelineInteraction";
import { formatMinutes, NATURE_COLOR, NATURE_LABEL, NATURE_ORDER } from "../lib/nature";
import {timeGroupColor} from '../lib/time-groups';
import type { ApiErrorBody, AuditEvent, Category, Configuration, Gap, RangeSummary, Segment } from "../types";
import { useThemeStore } from "../store/theme";
import { useTimeViewStore } from "../store/timeView";
import { RevisionHistoryModal } from "../components/RevisionHistoryModal";
import { AlertDialog } from "../components/ui/AlertDialog";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { PageHeader } from "../components/ui/PageHeader";
import { Modal } from "../components/ui/Modal";
import { RangePanel, type RangeUnit } from "../components/shell/RangePanel";
import { SidebarSlot } from "../components/shell/SidebarSlot";
import { dateFromIso } from "../components/ui/MonthGrid";
import { Autocomplete } from "../components/ui/Autocomplete";
import { Select } from "../components/ui/Select";
import { SegmentedSwitch } from "../components/ui/SegmentedSwitch";
import { TextArea, TextInput } from "../components/ui/TextInput";
import { DayTimeline } from "../components/timeline/DayTimeline";
import { WeekTimeline } from "../components/timeline/WeekTimeline";
import type { LayoutOutletContext } from "../components/Layout";

type Draft = {
  id?: string;
  revision?: number;
  title: string;
  categoryName: string;
  projectName: string;
  startedAt: string;
  endedAt: string;
  deductionMinutes: string;
  deductionNote: string;
  note: string;
};

const emptyDraft: Draft = { title: "", categoryName: "未归类", projectName: "", startedAt: "", endedAt: "", deductionMinutes: "0", deductionNote: "", note: "" };
type SegmentFormError = { message: string; conflicts: NonNullable<ApiErrorBody["conflicts"]> };

const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function dayLabel(day: string) {
  return `${day} · ${WEEKDAY[new Date(`${day}T12:00:00`).getDay()]}`;
}

function rangeLabel(from: string, to: string) {
  return `${from} – ${to}`;
}

const DAY_UNITS: Array<RangeUnit<"day" | "week">> = [
  { value: "day", label: "日", title: "按日查看" },
  { value: "week", label: "周", title: "按周查看" },
];
const VIEW_OPTIONS = [
  { value: "day", label: "日视图" },
  { value: "week", label: "周视图" },
] satisfies Array<{ value: "day" | "week"; label: string }>;

function blankDraft(recordTimeZone: string, day: string, gap?: Gap): Draft {
  const now = recordNow(recordTimeZone);
  const today = isoDate(now);
  if (gap) return { ...emptyDraft, startedAt: gap.start, endedAt: gap.end };
  if (day !== today) return { ...emptyDraft, startedAt: `${day}T09:00`, endedAt: `${day}T10:00` };
  // 走 shiftMinutes 而非本地 setMinutes：now 是墙钟载体，本地字段读写会在
  // 浏览器时区的 DST 缺失小时里把「一小时前」抹平成零长度草稿。
  return { ...emptyDraft, startedAt: isoMinute(shiftMinutes(now, -60)), endedAt: isoMinute(now) };
}

// 时间轴的日期面板：投放到二级栏底部；点一天＝跳到那一天或那一周
function DayRangePanel({ today, anchorDay, range }: { today: string; anchorDay: string; range: [string, string] }) {
  const viewMode = useTimeViewStore((s) => s.viewMode);
  const setViewMode = useTimeViewStore((s) => s.setViewMode);
  const pinDay = useTimeViewStore((s) => s.pinDay);
  const [month, setMonth] = useState(() => dateFromIso(anchorDay) ?? new Date());
  // 页头「上一天 / 下一天」跨月时，月历跟着翻过去
  useEffect(() => {
    const date = dateFromIso(anchorDay);
    if (date) setMonth((current) => (current.getFullYear() === date.getFullYear() && current.getMonth() === date.getMonth() ? current : date));
  }, [anchorDay]);
  const caption = viewMode === "day" ? dayLabel(range[0]) : rangeLabel(range[0], range[1]);
  return (
    <SidebarSlot summary={caption}>
      <RangePanel
        units={DAY_UNITS}
        unit={viewMode}
        onUnit={setViewMode}
        month={month}
        onMonthChange={setMonth}
        selected={range}
        today={today}
        onSelect={(day) => pinDay(day, today)}
        caption={caption}
        hint={viewMode === "day" ? "点日期，跳到那一天。" : "点日期，跳到那一周。"}
      />
    </SidebarSlot>
  );
}

import {useAccess} from '../../access';
export function DayPage({ recordTimeZone }: { recordTimeZone: string }) {
  const {owner}=useAccess();
  const { refreshKey } = useOutletContext<LayoutOutletContext>();
  const [instant, setInstant] = useState(() => new Date());
  const tick = useMemo(() => recordNow(recordTimeZone, instant), [instant, recordTimeZone]);
  const today = isoDate(tick);
  const resolvedTheme = useThemeStore((state) => state.resolved);
  const nowMinute = isoMinute(tick);
  const nowUtc = instant.toISOString();
  // 日期、视图与来源是时间域共享状态：二级栏的迷你月历和来源筛选读写同一份
  const pinnedDay = useTimeViewStore((s) => s.pinnedDay);
  const pinDay = useTimeViewStore((s) => s.pinDay);
  const viewMode = useTimeViewStore((s) => s.viewMode);
  const source = useTimeViewStore((s) => s.source);
  const setViewMode = useTimeViewStore((s) => s.setViewMode);
  const setVisibleRange = useTimeViewStore((s) => s.setVisibleRange);
  const anchorDay = pinnedDay ?? today;
  const [zoomId, setZoomId] = useState<TimelineZoomSelection>(TIMELINE_FIT_ZOOM_ID);
  const [calloutsEnabled, setCalloutsEnabled] = useState(true);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [summary, setSummary] = useState<RangeSummary | null>(null);
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<SegmentFormError | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Segment | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEvents, setHistoryEvents] = useState<AuditEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const loadGeneration = useRef(0);
  const summaryGeneration = useRef(0);
  const range = useMemo<[string, string]>(() => (
    viewMode === "day"
      ? [anchorDay, anchorDay]
      : rangeForWeek(anchorDay, configuration?.settings.weekStart || "monday")
  ), [anchorDay, configuration?.settings.weekStart, viewMode]);
  useEffect(() => setVisibleRange(range), [range, setVisibleRange]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError("");
    try {
      const config = await api.configuration({ signal });
      const nextRange: [string, string] = viewMode === "day"
        ? [anchorDay, anchorDay]
        : rangeForWeek(anchorDay, config.settings.weekStart);
      const result = await api.segments(
        { from: `${nextRange[0]}T00:00`, to: `${addDays(nextRange[1], 1)}T00:00` },
        { signal },
      );
      if (signal?.aborted || generation !== loadGeneration.current) return;
      setConfiguration(config);
      setSegments(result.segments);
    } catch (caught) {
      if (!isAbortError(caught) && generation === loadGeneration.current) {
        setError(caught instanceof Error ? caught.message : "加载时间账失败。");
      }
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [anchorDay, viewMode]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);
  useEffect(() => {
    setInstant(new Date());
    const timer = window.setInterval(() => setInstant(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [recordTimeZone]);

  const loadSummary = useCallback(async (
    signal?: AbortSignal,
    failureMessage = "统计摘要加载失败，请稍后重试。",
  ) => {
    const generation = ++summaryGeneration.current;
    try {
      const nextSummary = await api.summary(range[0], range[1], { signal });
      if (!signal?.aborted && generation === summaryGeneration.current) setSummary(nextSummary);
    } catch (caught) {
      if (!isAbortError(caught) && generation === summaryGeneration.current) setError(failureMessage);
    }
  }, [range]);

  const liveMinute = range[0] <= today && today <= range[1] ? nowMinute : "";
  useEffect(() => {
    const controller = new AbortController();
    void loadSummary(controller.signal);
    return () => controller.abort();
  }, [liveMinute, loadSummary, refreshKey]);

  const gaps = useMemo(
    () => viewMode === "day"
      ? deriveDayGaps(segments, anchorDay, nowMinute, { timeZone: recordTimeZone, nowUtc })
      : [],
    [segments, anchorDay, nowMinute, nowUtc, recordTimeZone, viewMode],
  );
  const filtered = useMemo(
    () => source === "all" ? segments : segments.filter((item) => item.source === source),
    [segments, source],
  );
  const distributionTotal = summary?.byNature.reduce((sum, item) => sum + item.grossMinutes, 0) || 0;
  const distribution = summary?.groupOnly ? summary.byCategory.map(item=>({name:item.name,minutes:item.grossMinutes,color:timeGroupColor(item.name, resolvedTheme)}))
    : NATURE_ORDER.map(nature=>({name:NATURE_LABEL[nature],minutes:summary?.byNature.find(item=>item.nature===nature)?.grossMinutes||0,color:NATURE_COLOR[nature]}));

  const navigate = (amount: number) => {
    pinDay(addDays(anchorDay, amount * (viewMode === "week" ? 7 : 1)), today);
  };

  const showHistory = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError("");
    try {
      setHistoryEvents(await api.auditEvents());
    } catch (caught) {
      setHistoryError(caught instanceof Error ? caught.message : "修改痕迹读取失败。");
    } finally {
      setHistoryLoading(false);
    }
  };

  const edit = (segment: Segment) => {
    if(!owner)return;
    setDraftError(null);
    setDraft({
      id: segment.id, revision: segment.revision, title: segment.title, categoryName: segment.category.name,
      projectName: segment.projectName || "", startedAt: segment.startedAt, endedAt: segment.endedAt || "",
      deductionMinutes: String(segment.deductionMinutes), deductionNote: segment.deductionNote || "", note: segment.note || "",
    });
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim() || !draft.categoryName || !draft.startedAt) {
      setDraftError({ message: "请填写事项、分类和开始时间。", conflicts: [] });
      return;
    }
    setSaving(true);
    setDraftError(null);
    const body: Record<string, unknown> = {
      revision: draft.revision, title: draft.title.trim(), categoryName: draft.categoryName,
      projectName: draft.projectName || null, startedAt: draft.startedAt,
      endedAt: draft.endedAt || null, deductionMinutes: Number(draft.deductionMinutes || 0),
      deductionNote: draft.deductionNote || null, note: draft.note || null,
    };
    if (!draft.id) body.source = "manual";
    try {
      if (draft.id) await api.updateSegment(draft.id, body);
      else await api.createSegment(body);
      setDraft(null);
      await load();
      await loadSummary(undefined, "时段已保存，但统计摘要刷新失败；重新载入页面即可恢复。");
    } catch (caught) {
      const body = caught instanceof ApiError && caught.body && typeof caught.body === "object"
        ? caught.body as ApiErrorBody
        : null;
      setDraftError({
        message: caught instanceof ApiError ? caught.message : "保存时段失败。",
        conflicts: body?.conflicts || [],
      });
    } finally {
      setSaving(false);
    }
  };

  const updateSegmentTime = useCallback(async (
    segment: Segment,
    changes: { startedAt?: string; endedAt?: string },
  ): Promise<Segment> => {
    setError("");
    try {
      const result = await api.updateSegment(segment.id, { ...changes, revision: segment.revision });
      setSegments((current) => current.map((item) => (
        item.id === result.segment.id ? result.segment : item
      )));
      void loadSummary(undefined, "时段已保存，但统计摘要刷新失败；重新载入页面即可恢复。");
      return result.segment;
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : "调整时段失败。";
      await load();
      setError(message);
      throw caught;
    }
  }, [load, loadSummary]);

  const remove = async () => {
    if (!deleteTarget) return;
    const removedId = deleteTarget.id;
    setSaving(true);
    setDeleteError("");
    try {
      await api.deleteSegment(removedId, "在今日页确认删除", deleteTarget.revision);
      setSegments((current) => current.filter((item) => item.id !== removedId));
      setDeleteTarget(null);
      void loadSummary(undefined, "时段已删除，但统计摘要刷新失败；时间轴记录不受影响。");
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "删除失败。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <DayRangePanel today={today} anchorDay={anchorDay} range={range} />
      <PageHeader
        label={`Time · ${viewMode === "day" ? "Day" : "Week"}`}
        title="时间流向"
        note={viewMode === "day" ? dayLabel(range[0]) : rangeLabel(range[0], range[1])}
        actions={<>
          <SegmentedSwitch
            ariaLabel="时间视图"
            value={viewMode}
            onChange={setViewMode}
            options={VIEW_OPTIONS}
          />
          <Button variant="icon" size="sm" aria-label="上一周期" onClick={() => navigate(-1)}>
            <ChevronLeft size={14} strokeWidth={1.5} />
          </Button>
          <Button variant="outline" size="sm" leading={<CalendarDays size={14} strokeWidth={1.5} />} onClick={() => pinDay(today, today)}>
            今天
          </Button>
          <Button variant="icon" size="sm" aria-label="下一周期" onClick={() => navigate(1)}>
            <ChevronRight size={14} strokeWidth={1.5} />
          </Button>
          {owner&&<><Button variant="ghost" size="sm" leading={<History size={14} strokeWidth={1.5} />} onClick={() => void showHistory()}>
            修改痕迹
          </Button>
          <Button
            size="sm"
            leading={<CalendarPlus size={14} strokeWidth={1.5} />}
            onClick={() => { setDraftError(null); setDraft(blankDraft(recordTimeZone, anchorDay, gaps[0])); }}
          >
            补录时段
          </Button></>}
        </>}
      />
      {error && <p role="alert" className="text-[13px] leading-5 text-zzm-accent-ink">{error}</p>}
      <Card padding="none" className="flex flex-none flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] leading-5">
            <span><i className="text-xs not-italic text-muted-foreground">{summary?.groupOnly ? '工作时间' : '有效创作'}</i> <strong className="ml-1 tabular-nums">{formatMinutes(summary?.effectiveWorkMinutes || 0)}</strong></span>
            <span><i className="text-xs not-italic text-muted-foreground">已记录</i> <strong className="ml-1 tabular-nums">{formatMinutes(summary?.recordedMinutes || 0)}</strong></span>
            <span><i className="text-xs not-italic text-muted-foreground">覆盖率</i> <strong className="ml-1 tabular-nums">{((summary?.coverage || 0) * 100).toFixed(1)}%</strong></span>
            <span><i className="text-xs not-italic text-muted-foreground">空白</i> <strong className="ml-1 tabular-nums">{formatMinutes(summary?.gapMinutes || 0)}</strong></span>
          </div>
          <div className="flex h-2 min-w-40 flex-1 overflow-hidden rounded-[2px] bg-zzm-chip" aria-label={summary?.groupOnly ? '大类时间分配' : '性质时间分配'}>
            {distributionTotal > 0 && distribution.map((item) => {
              const minutes = item.minutes;
              return minutes > 0 ? (
                <span
                  key={item.name}
                  style={{
                    width: `${minutes / distributionTotal * 100}%`,
                    background: item.color,
                  }}
                  title={`${item.name} · ${formatMinutes(minutes)}`}
                />
              ) : null;
            })}
          </div>
          <div className="flex flex-wrap gap-3 text-[12px] leading-4 text-zzm-muted">
            {distribution.filter(item=>!summary?.groupOnly || item.minutes>0).map((item) => (
              <span key={item.name} className="inline-flex items-center gap-1.5">
                <i className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                {item.name}
              </span>
            ))}
          </div>
      </Card>
      <Card padding="none" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading && <div aria-label="正在读取时间账" className="grid gap-3 p-5"><div className="zzm-skel h-5 w-48" /><div className="zzm-skel h-64" /></div>}
        {!loading && viewMode === "day" && (
          <DayTimeline
            day={range[0]}
            segments={filtered}
            allSegments={segments}
            gaps={owner?gaps:[]}
            readOnly={!owner}
            nowMinute={nowMinute}
            nowUtc={nowUtc}
            recordTimeZone={recordTimeZone}
            overlongSegmentMinutes={configuration?.overlongSegmentMinutes ?? null}
            natureColors={NATURE_COLOR}
            zoomId={zoomId}
            calloutsEnabled={calloutsEnabled}
            onZoomChange={setZoomId}
            onCalloutsEnabledChange={setCalloutsEnabled}
            onEdit={edit}
            onFillGap={(gap) => { setDraftError(null); setDraft(blankDraft(recordTimeZone, anchorDay, gap)); }}
            onTimeChange={updateSegmentTime}
          />
        )}
        {!loading && viewMode === "week" && (
          <WeekTimeline
            from={range[0]}
            to={range[1]}
            segments={filtered}
            nowMinute={nowMinute}
            nowUtc={nowUtc}
            recordTimeZone={recordTimeZone}
            natureColors={NATURE_COLOR}
            overlongSegmentMinutes={configuration?.overlongSegmentMinutes ?? null}
            zoomId={zoomId}
            onZoomChange={setZoomId}
            onEdit={edit}
          />
        )}
      </Card>

      <SegmentModal
        draft={draft}
        categories={configuration?.categories || []}
        projects={configuration?.projects || []}
        saving={saving}
        error={draftError}
        onChange={setDraft}
        onClose={() => { setDraft(null); setDraftError(null); }}
        onSave={save}
        onDelete={(segmentId) => {
          const segment = segments.find((item) => item.id === segmentId);
          if (!segment) return;
          setDeleteError("");
          setDraft(null);
          setDeleteTarget(segment);
        }}
      />
      <AlertDialog open={!!deleteTarget} title="删除这条时段？" description={deleteTarget ? `${deleteTarget.title} · ${deleteTarget.startedAt.slice(11)}–${deleteTarget.endedAt?.slice(11) || "进行中"}。删除后统计会立即排除，v1 不提供恢复入口。` : ""} error={deleteError} tone="destructive" confirmLabel="确认删除" busy={saving} onConfirm={remove} onCancel={() => { setDeleteTarget(null); setDeleteError(""); }} />
      <RevisionHistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} events={historyEvents} loading={historyLoading} error={historyError} entityType="segment" />
    </div>
  );
}

function SegmentModal({ draft, categories, projects, saving, error, onChange, onClose, onSave, onDelete }: { draft: Draft | null; categories: Category[]; projects: Configuration["projects"]; saving: boolean; error: SegmentFormError | null; onChange: Dispatch<SetStateAction<Draft | null>>; onClose: () => void; onSave: () => void; onDelete: (segmentId: string) => void }) {
  const field = (key: keyof Draft, value: string) => onChange((current) => current ? { ...current, [key]: value } : null);
  const footer = <div className="flex w-full items-center justify-between gap-3">
    {/* 删除先进确认窗，朱键留给那里；表单里只放幽灵键 */}
    <div>{draft?.id && <Button variant="ghost" leading={<Trash2 size={14} strokeWidth={1.5} />} onClick={() => onDelete(draft.id!)}>删除</Button>}</div>
    <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>取消</Button><Button loading={saving} onClick={onSave}>保存</Button></div>
  </div>;
  const errorContent = error ? <><p>{error.message}</p>{error.conflicts.length > 0 && <ul className="mt-1 list-disc pl-5">{error.conflicts.map((conflict) => <li key={conflict.id}>{conflict.title} · {conflict.startedAt.slice(11)}–{conflict.endedAt?.slice(11) || "进行中"}</li>)}</ul>}</> : undefined;
  return <Modal open={!!draft} onClose={onClose} title={draft?.id ? "编辑时段" : "补录时段"} description="所有时间按分钟保存；服务端会检查重叠、顺序和未来时间。" error={errorContent} footer={footer}>
    {draft && <div className="grid gap-4 sm:grid-cols-2">
      <TextInput containerClassName="sm:col-span-2" label="事项" value={draft.title} onChange={(event) => field("title", event.target.value)} />
      <Select label="分类" value={draft.categoryName} onChange={(event) => field("categoryName", event.target.value)} options={categories.map((category) => ({ value: category.name, label: category.name }))} />
      <Autocomplete ariaLabel="项目" label="项目" value={draft.projectName} onChange={(value) => field("projectName", value)} options={[{ value: "", label: "无项目" }, ...projects.map((project) => ({ value: project.name, label: project.name }))]} searchable={projects.length > 6} />
      <TextInput label="开始" type="datetime-local" value={draft.startedAt} onChange={(event) => field("startedAt", event.target.value)} />
      <TextInput label="结束" type="datetime-local" value={draft.endedAt} onChange={(event) => field("endedAt", event.target.value)} hint="留空表示进行中。" />
      <TextInput label="扣除分钟" type="number" min="0" value={draft.deductionMinutes} onChange={(event) => field("deductionMinutes", event.target.value)} className="tabular-nums" />
      <TextInput label="扣除说明" value={draft.deductionNote} onChange={(event) => field("deductionNote", event.target.value)} />
      <TextArea containerClassName="sm:col-span-2" label="备注" value={draft.note} onChange={(event) => field("note", event.target.value)} />
    </div>}
  </Modal>;
}
