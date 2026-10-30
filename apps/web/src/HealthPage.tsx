/**
 * [INPUT]: 原版控制台、路由 view 参数、全局刷新信号、主题 store 的解析模式与 shell 的 RangePanel/SidebarSlot。
 * [OUTPUT]: 同一LifeOS页面内的健康面板，保留原图表和操作。
 * [POS]: 健康域挂载器；隔离原版样式，数据继续经过本人AAL2。
 *   iframe 自带锁版本 zzm.css，宿主只下发 light/dark，颜色全部由令牌决定。
 *   导航与日期由宿主二级栏承担：路由 /health/:view 驱动 iframe 视图，「周 月 季」驱动最近 7/30/90 天；
 *   iframe 每次渲染回报 health-state，宿主据此同步地址（页内链接切视图时）与面板。
 *   健康接口只按「截止今天的最近 N 天」取数，所以月历只读，显示当前覆盖的日子。
 * 访客 iframe 只请求公开指标，个人自述与设置不挂载。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useRefreshSignal } from './dashboard/components/Layout';
import { RangePanel, type RangeUnit } from './dashboard/components/shell/RangePanel';
import { SidebarSlot } from './dashboard/components/shell/SidebarSlot';
import { dateFromIso } from './dashboard/components/ui/MonthGrid';
import { addDays } from './dashboard/lib/dates';
import { useThemeStore } from './dashboard/store/theme';
import { today as shanghaiToday } from './model';
import {useAccess} from './access';

declare const __HEALTH_REVISION__: string;
const shell = `<!doctype html><html lang="zh-CN" class="zzm-v4"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/health-console/zzm.css?v=${__HEALTH_REVISION__}"><link rel="stylesheet" href="/health-console/styles.css?v=${__HEALTH_REVISION__}"><link rel="stylesheet" href="/health-console/embed.css?v=${__HEALTH_REVISION__}">
<script type="module" src="/health-console/app.js?v=${__HEALTH_REVISION__}"></script></head><body><div id="app"><div class="initial-loading">正在读取身体数据…</div></div>
<div id="toast" role="status" aria-live="polite"></div><dialog id="journal-dialog" aria-labelledby="journal-title"></dialog></body></html>`;

const VIEWS = ['overview', 'trends', 'plans', 'workouts', 'journal', 'settings'];
// 只有总览与趋势按天数取数；其余视图不显示日期面板
const RANGED = new Set(['overview', 'trends']);
type Days = '7' | '30' | '90';
const UNITS: Array<RangeUnit<Days>> = [
  { value: '7', label: '周', title: '最近 7 天' },
  { value: '30', label: '月', title: '最近 30 天' },
  { value: '90', label: '季', title: '最近 90 天' },
];

function HealthRange({ days, onDays }: { days: Days; onDays: (days: Days) => void }) {
  const today = shanghaiToday();
  const start = addDays(today, 1 - Number(days));
  const [month, setMonth] = useState(() => dateFromIso(today) ?? new Date());
  const caption = `${start} 至 ${today}`;
  return (
    <SidebarSlot summary={caption}>
      <RangePanel
        units={UNITS}
        unit={days}
        onUnit={onDays}
        month={month}
        onMonthChange={setMonth}
        selected={[start, today]}
        today={today}
        caption={caption}
        hint={`最近 ${days} 天，截止今天。`}
      />
    </SidebarSlot>
  );
}

export function HealthPage() {
  const {owner}=useAccess();
  const refresh = useRefreshSignal();
  const { view = 'overview' } = useParams();
  const navigate = useNavigate();
  const frame = useRef<HTMLIFrameElement>(null);
  // 宿主请求的视图；iframe 确认前，启动时那次默认「总览」的回报不能把地址拉回去
  const requested = useRef(view);
  const resolved = useThemeStore((s) => s.resolved);
  const [days, setDays] = useState<Days>('30');
  const post = (data: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(data, location.origin);
  const theme = () => post({ type: 'health-theme', theme: useThemeStore.getState().resolved });

  useEffect(() => {
    const message = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      if (e.data?.type === 'health-session-expired') window.dispatchEvent(new Event('lifeos-session-expired'));
      if (e.data?.type === 'health-state') {
        if (requested.current && e.data.view !== requested.current) {
          post({ type: 'health-view', view: requested.current });
        } else {
          requested.current = '';
          if (VIEWS.includes(e.data.view)) navigate(`/health/${e.data.view}`, { replace: true });
        }
        if (['7', '30', '90'].includes(String(e.data.range))) setDays(String(e.data.range) as Days);
      }
    };
    window.addEventListener('message', message);
    return () => window.removeEventListener('message', message);
  }, [navigate]);
  useEffect(theme, [resolved]);
  useEffect(() => { post({ type: 'health-refresh' }); }, [refresh]);
  useEffect(() => {
    requested.current = view;
    post({ type: 'health-view', view });
  }, [view]);

  const visitorShell=shell.replace('class="zzm-v4"','class="zzm-v4" data-access="visitor"');
  return <>
    {RANGED.has(view) && <HealthRange days={days} onDays={(next) => { setDays(next); post({ type: 'health-range', days: Number(next) }); }} />}
    <iframe ref={frame} onLoad={() => { theme(); post({ type: 'health-view', view }); }} srcDoc={owner?shell:visitorShell} title="健康：身体、睡眠、恢复与运动计划"
      className="min-h-0 w-full flex-1 border-0 bg-background" />
  </>;
}
