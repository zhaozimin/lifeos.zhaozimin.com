# edge/
> L2 | 父级: ../CLAUDE.md

成员清单
auth-limit.ts: Cloudflare原生认证限流；只接收来源散列，不转发到VPS。
index.ts: 内部认证保护与固定VPC服务的HTTP代理；过滤路径、方法和头，禁止公开Worker入口。
package.json: 私有Worker的ES模块边界，不携带依赖或凭据。
wrangler.example.toml: 限流和私有绑定模板；VPC编号必须自行填写。
wrangler.toml: 本机部署配置；由模板填写，Git忽略，不随源码分发。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

部署前复制配置模板：

```sh
cp wrangler.example.toml wrangler.toml
```

填写自己的VPC服务编号和限流namespace_id。
保留workers_dev=false与preview_urls=false。
已有本机配置直接使用，不要覆盖为模板。
