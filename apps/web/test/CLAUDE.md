# test/
> L2 | 父级: ../CLAUDE.md

成员清单
visitor.test.ts: 公开路由、本人Cookie隔离及财务、银行卡和写入拒绝。
ui-preview.test.ts: 演示会话隔离、版本冲突和正式投影兼容性。
finance-range.test.ts: 财务自定义区间含首尾、反向跨年及单日闰日筛选口径。

model.test.ts: 跨日区间、去重覆盖率、币种隔离、未来时段与快照时间边界。
subscriptions.test.ts: 订阅固定目标、白名单、请求保真和私有响应回归。
login-guard.test.ts: 认证前限流、伪造来源无效和保护故障拒绝。
security.test.ts: 未登录、AAL1、异主、跨站和 Cookie 边界。
data.test.ts: 日聚合分页、明细上限与原话字段隔离。
records.test.ts: 人工编辑的金额、墙钟、微秒保留、跨日扣减和版本冲突。

native.test.ts: 原版投影、UTC精度、跨日扣减、CSV预览及无公式XLSX。
time-groups.test.ts: 本人大类统计；工作独立、WHOOP清醒扣除一次和设备来源。
original-dates.test.mjs: 复用本机日期原语与时区边界测试。
original-timeline.test.mjs: 复用本机时间轴裁剪、空白和DST测试。
original-timeline_interaction.test.mjs: 复用缩放、吸附、平移及端点约束测试。
original-timeline_callouts.test.mjs: 复用极短时段细节栏排布测试。
health-ui.test.mjs: 健康子目录资源闭合与模块内容版本一致性，防止旧缓存继续执行。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
