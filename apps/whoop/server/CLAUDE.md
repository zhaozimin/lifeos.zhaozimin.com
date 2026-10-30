# server/

> L2 | 父级: ../CLAUDE.md

成员清单
visitor.mjs: 白名单指标、校验同步时效的公开计划和自述占位；排除身份、授权、私人正文和偏好。
index.mjs: HTTP 组合入口；校验来源，挂载同步与报告日程。
config.mjs: 配置验证；统一端口、路径与授权回调地址。
http.mjs: HTTP JSON 请求和错误类型；屏蔽上游敏感响应。
store.mjs: SQLite 持久化边界；事务同步，追加报告修订。
whoop.mjs: WHOOP v2 适配；分页、令牌轮换和同步互斥。
analytics.mjs: 生理记录关联和趋势计算；报告可指定分析日期。
guidance.mjs: 本机恢复建议；规则阈值透明，不生成诊断。
calendar.mjs: IANA 当地日历；默认上海 07:00，计算准备与到期时段。
planner.mjs: 当天训练纯引擎；校验本次同步与当天评分，输出等待或训练。
reports.mjs: 晨间发布日程；先拉取再分析，五分钟重试，成功发布后去重。
insights.mjs: 图表序列；生成周汇总、配对样本和两周对照。
demo.mjs: 确定性演示数据；复用真实分析路径，不写数据库。
cloud.mjs: 本人及访客健康发布，睡眠校准与晨间微信队列。
vps.mjs: VPS组合入口；唯一同步进程，先同步再发布并处理异步操作。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
