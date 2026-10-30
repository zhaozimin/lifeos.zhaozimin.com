# web/src/lib/
> L2 | 父级: ../CLAUDE.md

成员清单
cn.ts: 无外部依赖的 className 拼装，供组合式 UI 组件消费。
format.ts: 中文整数、周期、紧急度、金额、网站主机名和支付标识的展示。不计算剩余天数；访客金额固定打码，自定义周期不显示未知天数。
notify.ts: 浏览器7/3/1天提醒；成功后回执，失败释放，与VPS微信七天提醒独立去重。
refresh.ts: 全应用共用分钟 tick、可见性与 storage 失效广播；订阅数归零时清理监听。
asyncScope.ts: 组件请求身份；同通道新请求、会话关闭或组件卸载使旧提交失效。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
