# MCU Quay（芯埠）

## 简介 / Introduction

MCU Quay（芯埠）是面向 MCU 设备的中继与控制平面，提供 Node.js/TypeScript
后端和 React 操作控制台。它支持 HTTP、TCP、可选 MQTT、命令队列、设备上报、
自动化规则、OTA 任务和 Server-Sent Events（SSE）。

MCU Quay is a Node.js/TypeScript relay and control plane for MCU devices with a
React operator console. It supports HTTP, TCP, optional MQTT, command queues,
device reports, automation rules, OTA tasks, and Server-Sent Events (SSE).

> **公开源码 / Public source release.** 生产状态、凭据、生成的构建产物、回滚归档和部署密钥均不纳入仓库。
> Production state, credentials, generated bundles, rollback archives, and deployment secrets are intentionally excluded.

## 项目身份 / Project identity

- Canonical name: **MCU Quay（芯埠）**
- Package name: `mcu-quay`
- 一句话定位 / One-line description: **连接 MCU 设备与操作人员的安全港口 / A safe harbor between MCU devices and operators.**
- Identity and usage notes: [PROJECT_IDENTITY.md](PROJECT_IDENTITY.md)

## 环境要求 / Requirements

- Node.js >= 24
- npm >= 11

## 本地开发 / Local development

```powershell
npm ci
Copy-Item .env.example .env
# Edit .env with local-only random values.
npm run typecheck
npm run build
npm start
```

控制台默认地址为 `http://127.0.0.1:18080/admin`，TCP 网关默认监听
`127.0.0.1:9001`。

The console is served at `http://127.0.0.1:18080/admin` by default. The TCP
gateway defaults to `127.0.0.1:9001`.

## 配置 / Configuration

请参阅 [.env.example](.env.example)。部署到网络环境时，请为 `ADMIN_TOKEN` 和
`ACCOUNT_CREDENTIAL_KEY` 设置相互独立的高熵随机值，使用 TLS 终止 HTTP，并通过
私有网络或设备认证层限制 TCP 网关。不要提交 `.env` 或 `data/`。

See [.env.example](.env.example). For any network deployment, set independent
high-entropy values for `ADMIN_TOKEN` and `ACCOUNT_CREDENTIAL_KEY`, terminate
HTTP with TLS, and restrict the TCP gateway with a private network or device
authentication layer. Do not commit `.env` or `data/`.

## 数据与构建产物 / Data and generated files

运行时会写入 `data/state.json` 及其旁边的备份文件；前端构建写入 `public/`，
服务端构建写入 `dist/`。这些路径已被 Git 忽略，部署时必须重新创建。

The runtime writes `data/state.json` and a backup next to it. The web build
writes `public/`; the server build writes `dist/`. These paths are ignored by
Git and must be created during deployment.

## 安全状态 / Security status

在将服务暴露到互联网之前，请完成 [SECURITY.md](SECURITY.md) 中的加固工作，
重点处理 TLS、凭据轮换、文件权限和权限分离。本清洗版用于源码审查和受控部署，
不代表生产端点默认安全。

Before exposing this service to the Internet, complete the hardening work in
[SECURITY.md](SECURITY.md), especially TLS, credential rotation, file
permissions, and role separation. This sanitized release is for source review
and controlled deployment, not a claim that a production endpoint is secure by
default.

## 许可 / License

MCU Quay 使用 **MCU Quay Development License 1.0（MQDL-1.0）**，详见
[LICENSE](LICENSE)。该许可允许商业使用、修改和再发布，但属于项目专属许可，
目前未获 OSI 批准，也没有 SPDX 标识。

MCU Quay is released under the **MCU Quay Development License 1.0 (MQDL-1.0)**;
see [LICENSE](LICENSE). The license permits commercial use, modification, and
redistribution, but it is a project-specific license and is not currently
OSI-approved or SPDX-listed.
