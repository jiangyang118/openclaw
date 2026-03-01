# OpenClaw 助理能力快照（Capability Snapshot）

更新时间：2026-02-28

## 1）部署与访问

- Gateway 主机：`47.90.228.188`
- Gateway 入口：`http://robot.cpt-fit.com:17310/e3b48ad9?token=***`
- Gateway 模式：`lan`
- 运行状态：`active`，端口 `17310` 已监听

## 2）已配置通道与桥接

- WeCom 插件：已启用
- Feishu 插件：已启用
- Telegram 插件：已启用
- GitHub Webhook Bridge 插件：已启用
- QQBot 插件：已启用
- DingTalk 插件：已启用

## 3）已接入 Provider Auth 插件

服务器配置已写入并启用：

- `google-gemini-cli-auth`
- `qwen-portal-auth`
- `copilot-proxy`

兼容性说明：

- `google-antigravity-auth` 在当前 OpenClaw 版本已移除，不再支持。

## 4）现在可直接做的能力

- 走现有已配置通道收发消息（WeCom / Feishu / Telegram / GitHub webhook 流）。
- 使用服务器当前已配置的阿里云模型链路。
- 网关启动时加载 Gemini/Qwen/Copilot 的 provider-auth 插件。

## 5）仍需手工授权的能力

本次检查时，以下 provider 尚未发现可用 auth profile：

- `google-gemini-cli`
- `qwen-portal`
- `copilot-proxy`

因此这三个目前是“已集成、已启用”，但还不是“已登录可调用”。

建议在服务器 `admin` 用户下执行：

```bash
openclaw models auth login --provider google-gemini-cli --set-default
openclaw models auth login --provider qwen-portal --set-default
openclaw models auth login --provider copilot-proxy --set-default
```

## 6）能力矩阵

| 能力                    | 状态                 | 备注                         |
| ----------------------- | -------------------- | ---------------------------- |
| 企业微信收发            | Ready                | 插件已启用                   |
| 飞书收发                | Ready                | 插件已启用                   |
| Telegram 收发           | Ready                | 插件已启用                   |
| GitHub Webhook 事件入站 | Ready                | Bridge 已启用                |
| Antigravity 写代码      | Not supported        | 上游已移除该 provider/plugin |
| Gemini 提问             | Pending auth         | 插件已启用，待登录授权       |
| Qwen Portal OAuth       | Pending auth         | 插件已启用，待登录授权       |
| Copilot Proxy 调用      | Pending auth/runtime | 需代理运行 + 登录授权        |

## 7）本次实际变更

- 已更新服务器 `/home/admin/.openclaw/openclaw.json`：
  - `google-gemini-cli-auth.enabled = true`
  - `qwen-portal-auth.enabled = true`
  - `copilot-proxy.enabled = true`
- 若存在旧项，已移除 `google-antigravity-auth`。
- 未改动你现有通道、webhook、token 配置。

## 8）新线程工作约定（给 Codex/Agent）

为保证在本仓库新线程里也能快速进入可执行状态，约定如下：

- 先读本文件：`docs/assistant-capabilities.md`
- 远程执行统一走脚本：`scripts/aliyun-openclaw-remote.sh`

常用命令：

```bash
# 1) 连通与服务健康检查
OPENCLAW_ALIYUN_PASSWORD='***' scripts/aliyun-openclaw-remote.sh --check

# 2) root 执行远程命令
OPENCLAW_ALIYUN_PASSWORD='***' scripts/aliyun-openclaw-remote.sh "ss -ltnp | grep :17310 || true"

# 3) admin 身份执行（用于 openclaw CLI、用户态 systemd）
OPENCLAW_ALIYUN_PASSWORD='***' scripts/aliyun-openclaw-remote.sh --as-admin "openclaw --version"
OPENCLAW_ALIYUN_PASSWORD='***' scripts/aliyun-openclaw-remote.sh --as-admin "systemctl --user is-active openclaw-gateway.service"
```
