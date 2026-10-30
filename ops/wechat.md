<!--
[INPUT]: 独立 SDK 源码、腾讯插件文档与实际绑定状态。
[OUTPUT]: 微信扫码、配对码及会话保存的操作步骤。
[POS]: ops 的微信授权说明；业务轮询与数据库另行验收。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
-->

# 微信扫码绑定

## 选型

采用 `@wechatbot/wechatbot@2.2.0`。
它直接提供 iLink 登录接口，运行时不依赖 OpenClaw。
腾讯官方插件要求完整 OpenClaw，当前仅借鉴其协议边界。
二维码 PNG 使用 `qrcode@1.5.4` 生成。

## VPS 准备

以 root 执行 `bash ops/install-node.sh`。
源码部署到 `/opt/lifeos`，归属 lifeos 用户。
以 lifeos 身份进入 `/opt/lifeos/ops`，执行：

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run prepare:wechat
npm run check
npm test
```

## 开始扫码

在 VPS 的 lifeos 会话执行：

```bash
cd /opt/lifeos/ops
mkdir -p /var/lib/lifeos/wechat
chmod 700 /var/lib/lifeos/wechat
flock -n /var/lib/lifeos/wechat/login.lock node wechat-login.mjs
```

状态文件位于 `/var/lib/lifeos/wechat/login-status.json`。
`qr_ready` 表示私有 PNG 已生成，可复制到本机临时目录展示。
使用手机微信“扫一扫”，并在手机确认绑定。
`scanned` 表示已扫描，仍需手机确认。
若出现 `verify_code_required`，输入手机显示的配对码。
`bound` 表示服务端已确认，SDK 已保存会话。
凭据保存在同一私有目录，文件权限为 0600。
状态输出不包含 token、微信 ID 或消息内容。
二维码过期后，SDK 最多申请三次；每次重新展示最新 PNG。
固定 SDK 默认只等待 15 秒，现场已出现超时退出。
兼容补丁仅将扫码状态请求改为 35 秒，超时继续等待。
补丁先检查版本与源码摘要，可重复执行。
已有会话时默认复用。`--force` 仅用于明确要求重新扫码的场景。

## 当前边界

扫码脚本完成绑定后退出，不启动消息轮询或发送回复。
数据库接通后，业务接收器先存原话，再调用解析器。
同一机器人账号只允许一个消息接收器。
业务收发已由 `lifeos-relay.service` 接管，见 [relay.md](relay.md)。
重新扫码前先停止该服务，授权完成后再启动。

## 来源

- [独立 SDK](https://github.com/corespeed-io/wechatbot/tree/main/nodejs)
- [腾讯官方插件](https://github.com/Tencent/openclaw-weixin)
- [腾讯扫码等待实现](https://github.com/Tencent/openclaw-weixin/blob/main/src/auth/login-qr.ts)
- [Node.js 官方校验清单](https://nodejs.org/dist/v22.23.4/SHASUMS256.txt)
