# worker/
> L2 | 父级: ../CLAUDE.md

成员清单
visitor.ts: 匿名只读API白名单；时间（含受 share_ai_telemetry 控制的 /v1/time/ai 与白名单 system_tags）、健康与灵感只调用投影RPC，财务只读脱敏投影，订阅只调用公开目录与品牌图。
visitor-finance.ts: 财务结构投影适配；公开日期和通用分类，金额为null。
visitor-inspirations.ts: 公开灵感与 Agent 抓取订阅源；服从 share_inspirations 开关，提供零 JS 语义 HTML5、Markdown 与 JSON，附带 CORS 与 index/follow 响应头。

index.ts: 请求边界；公开投影与灵感抓取路由使用独立匿名客户端，私有路由保留AAL2。
login-guard.ts: 可信来源散列调用内部限流；认证前检查，故障拒绝放行。
auth.ts: 每请求独立 Supabase 客户端、HttpOnly 会话及 TOTP。
data.ts: AAL2 后读取视图、当天时间与微信原话；不把系统小结充作用户输入。
native.ts: 原版API路由；同源Cookie、版本编辑、本人AAL2的WHOOP醒来日实睡汇总及 /v1/time/ai 双轨遥测查询。
native-data.ts: 大类时间、WHOOP/Orca来源和财务投影；新口径只统计工作大类并拆分心流深度与 AI 轻度协同，保留旧nature兼容。
native-files.ts: 私有附件、CSV 两步导入和无公式 XLSX 下载。
native-import.ts: 原版账单表头别名、CSV/TSV 解析与建议。
records.ts: 历史分页、详情、私有附件与人工编辑；通过版本 RPC 写入。
subscriptions.ts: 本人AAL2后的动作封装与私有服务绑定，不转发Cookie或任意目标。
health.ts: 本人AAL2健康适配；读发布副本和导出，写操作进入白名单任务队列。
inspirations.ts: 本人AAL2灵感读写边界；分页、按日与两层标签筛选，及严格两层标签RPC提交。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
