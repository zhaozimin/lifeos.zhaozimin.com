# worker/
> L2 | 父级: ../CLAUDE.md

成员清单
visitor.ts: 匿名只读API白名单；时间和健康只调用投影RPC，财务只读脱敏投影，订阅只调用公开目录与品牌图。
visitor-finance.ts: 财务结构投影适配；公开日期和通用分类，金额为null。

index.ts: 请求边界；公开投影使用独立匿名客户端，私有路由保留AAL2。
login-guard.ts: 可信来源散列调用内部限流；认证前检查，故障拒绝放行。
auth.ts: 每请求独立 Supabase 客户端、HttpOnly 会话及 TOTP。
data.ts: AAL2 后读取视图、当天时间与微信原话；不把系统小结充作用户输入。
native.ts: 原版API路由；同源Cookie、版本编辑及本人AAL2的WHOOP醒来日实睡汇总。
native-data.ts: 大类时间、WHOOP来源和财务投影；新口径只统计工作大类，保留旧nature兼容。
native-files.ts: 私有附件、CSV 两步导入和无公式 XLSX 下载。
native-import.ts: 原版账单表头别名、CSV/TSV 解析与建议。
records.ts: 历史分页、详情、私有附件与人工编辑；通过版本 RPC 写入。
subscriptions.ts: 本人AAL2后的动作封装与私有服务绑定，不转发Cookie或任意目标。
health.ts: 本人AAL2健康适配；读发布副本和导出，写操作进入白名单任务队列。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
