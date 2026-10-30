# apps/relay/src/channel/
> L2 | 父级: ../CLAUDE.md

成员清单

http.ts: iLink HTTP 边界；统一认证头、超时与安全错误，不打印请求内容。
checkpoint.ts: 私有游标文件；原子替换与落盘同步，不保存业务账本。
wechat.ts: 微信适配器；本人白名单、消息归一化、数据库确认后推进游标。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
