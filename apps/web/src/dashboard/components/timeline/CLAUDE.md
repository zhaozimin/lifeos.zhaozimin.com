# timeline/
> L2 | 父级: ../CLAUDE.md

成员清单

访客通过readOnly停用拖拽，编辑入口由页面撤除。
TimelineEvent.tsx: 日/周时间轴共享的领域事项适配器；把 UTC 真实 duration 与墙钟起止、标题、备注、选中状态、动态分栏位（full/me）和可选控制柄投射到设计系统 EventFrame，区分 WHOOP 校准与普通来源；超长软标记只前置进既有 meta 行，绝不改动色块与时长。
AiModelMeta.tsx: AI 详情表现层；提供多厂商内联 SVG 标志（Claude/OpenAI/Gemini/Grok）、具体事项右半栏 AI 并行块 AiInlineBlock（含并发脊线与容器查询自适应模型行）、needsAiCallout 截断判定、右侧细节栏联动卡 AiDetailCard 及周视图/关细节栏降级浮层 AiTrackPopover。
DayTimeline.tsx: 单日 24h 墙钟编排；消费记录时区、UTC 当前瞬间与单日 AI 并发切片，在具体事项栏内动态分栏（无 AI 时人类全宽，有 AI 并行时左「我自己」右「AI 并行块」），被缩放截断的 AI 块自动排入右侧细节栏并与短折线双向点亮；关细节栏时降级为鼠标旁浮层，普通日保留五档缩放与调时，DST 切换日停用拖拽。
WeekTimeline.tsx: 一周共享墙钟日历；按记录时区 UTC 日界把跨日时段裁剪进七列，并在列右侧叠加可悬停 AI 并发边带（触发鼠标旁模型与推理强度浮层）与表头峰值徽标，不在高密七列中启用细节栏和直接调时。
useTimelineSegmentInteraction.ts: 单日时间块手势状态机；先消费 DST 直接调时安全判定，普通日让整屏和五档共享选择、双击、长按平移、端点拖动及 UTC 同步预览，非单射日只保留设置入口。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
