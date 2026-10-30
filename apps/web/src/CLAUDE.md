# src/
> L2 | 父级: ../CLAUDE.md

成员清单
access.ts: 前端角色和API地址；服务端独立验权，降级时重建页面树。
VisitorPages.tsx: 私有模块说明，不显示登录链接；财务和订阅复用原版完整页面。

dashboard/: 本机原版组件、时间轴、财务页面、纸墨朱主题桥和 Cookie 适配。
CloudPages.tsx: 云端历史、原话及 LifeOS 安全页；安全页提供退出入口，页头共用 PageHeader。
SubscriptionsPage.tsx: 原版SubOS宿主，接收全局刷新并下发亮暗模式；本人API要求AAL2，访客只读目录独立传输。
HealthPage.tsx: 健康域宿主；路由 /health/:view 驱动 iframe 视图，二级栏底部「周 月 季」驱动最近 7/30/90 天；iframe 回报 health-state 同步地址与面板。

main.tsx: React 入口；不在浏览器保存会话令牌。
App.tsx: 默认访客与本人双重登录组合根；私有页面按角色挂载。
Auth.tsx: 密码、首次设置与 TOTP 表单。
InboxView.tsx: 原话状态、待澄清与失败列表。
model.ts: 云端契约及上海日期、整数金额和区间计算。
record-model.ts: 编辑契约、精确金额输入与上海墙钟转换。
record-fields.ts: 按记录类型构建表单；只提交实际变化，保留未改时间精度。
RecordsView.tsx: 历史分页与搜索；打开时采用记录偏好的默认类型，各类型共享编辑入口。
RecordEditor.tsx: 云端附加历史页的编辑对话框；版本冲突、草稿保护、修改记录和私有附件。
ui.tsx: 附加页的 Empty 空状态。
style.css: 附加页样式入口；依次载入共享、历史记录、收件箱与登录样式。
styles/: 云端登录与附加历史页样式；限于 cloud-legacy 容器。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
