<!--
[INPUT]: 官方 CLI 文档、安装脚本与已验证的 VPS 状态。
[OUTPUT]: 安装、Google 授权和无界面验收步骤。
[POS]: ops 的运行说明；安装事实以 docs/部署记录.md 为准。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
-->

# Antigravity CLI 运维

本文IP为文档示例；执行前替换为自己的VPS地址。
生产地址只保留在本机私有配置。

## 安装

在 VPS 上以 root 执行已审阅的脚本：

```bash
bash ops/install-antigravity.sh
```

脚本创建 `lifeos` 普通用户。
官方安装器把原生二进制写入 `/home/lifeos/.local/bin/agy`。
该二进制不依赖 Node.js。传话筒的 Node.js 环境另行安装。
脚本可重复执行，不删除已有 CLI 或登录凭据。
安装器摘要变化时，先审阅，再更新脚本中的 SHA256。
官方 CLI 会自动更新，部署后必须记录实际版本。

## Google 授权

在本机终端进入 VPS 的专用用户：

```bash
ssh -t root@203.0.113.10 'runuser -l lifeos -w SSH_CONNECTION,SSH_CLIENT,SSH_TTY,TERM -c "cd /var/lib/lifeos/parser-workspace && exec /home/lifeos/.local/bin/agy --model gemini-3.8-flash-high"'
```

按 CLI 引导选择个人 Google 账号。
保留 SSH 环境变量，使 CLI 识别远程授权模式。
在本人浏览器完成官方授权，再回到终端完成 CLI 提示。
SSH 远程授权流程以安装版本实际输出为准。
授权码、刷新令牌与凭据文件不得写入仓库或部署记录。
凭据存放在 `lifeos` 主目录，不复制本机登录文件。
安装脚本将 `.gemini` 与 CLI 登录目录权限设为 0700。
首次设置仅信任 `/var/lib/lifeos/parser-workspace`。
运行目录不存凭据、源码或原话。
完成首次设置后退出交互界面，再执行无界面验收。

## 无界面验收

在 VPS 上执行：

```bash
runuser -l lifeos -c 'cd /var/lib/lifeos/parser-workspace && exec /home/lifeos/.local/bin/agy -p "只回复 ok，不调用工具。" --model gemini-3.8-flash-high --output-format json --print-timeout 60s'
```

要求进程正常退出，JSON 的 `status` 为 `SUCCESS`。
用户指定 Gemini 3.8；使用 CLI 已列出的 `gemini-3.8-flash-high`。
`response` 必须包含要求的回复。
业务解析当前使用 `gemini-3.8-flash-low`，仍为 Gemini 3.8 Flash。
High 档保留为首次授权验收记录，业务选择 Low 档降低提取等待。
业务解析优先读取 `structured_output`，否则解析 `response`。
两者都必须通过应用 schema 校验。
安装成功与模型验收分开记录，未授权不能标记 P0 完成。
传话筒不得传入 `--dangerously-skip-permissions`。

## 验收结果与授权边界

2026-10-24 实测：登录、首次设置与手机核验已完成。
显式指定 Gemini 3.8 Flash 后，无界面调用退出码为 0。
JSON 返回 `status: SUCCESS`，`response: "ok\n"`。
单轮调用耗时约 2.244 秒。
此前的 `Eligibility check failed` 已在手机核验后解除。
保留安装与凭据，完成官方账号验证后再复测。
出现 Google 手机二维码时，由本人扫描并完成设备或号码核验。
随后返回电脑完成流程，再执行一次模型验收。
验证失败时，记录手机或电脑上的错误原文。
重新验证使用 CLI 新返回的官方链接，复用已登录状态。
官方 FAQ 限定个人订阅的 CLI 用于直接脚本与 CI。
将 agy 封装进第三方应用不受个人订阅支持。
用户在 v1.7 明确选择微信直接调用已授权 CLI，不使用 API Key。
CLI 1.4.7 对复杂 --json-schema 实测返回空结果。
当前 schema 写入提示，返回 JSON 仍必须通过本地 zod 校验。

## 官方来源

- [下载与安装](https://antigravity.google/download#antigravity-cli)
- [无界面模式](https://antigravity.google/docs/cli/headless/)
- [SSH 授权](https://antigravity.google/docs/install/#remote-ssh-oauth-flow)
- [账号资格与个人订阅边界](https://antigravity.google/docs/faq)
