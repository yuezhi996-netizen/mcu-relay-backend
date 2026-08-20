# MCU Quay（芯埠）

MCU Quay is a Node.js/TypeScript device relay and control plane with a React
operator console. It provides HTTP and TCP device access, optional MQTT,
command queues, device reports, automation rules, OTA tasks, and Server-Sent
Events.

> **Public source release.** Production state, credentials, generated bundles,
> rollback archives, and deployment secrets are intentionally excluded.

## Project identity

- Canonical name: **MCU Quay（芯埠）**
- Package name: `mcu-quay`
- One-line description: **A safe harbor between MCU devices and operators.**
- Identity and usage notes: [PROJECT_IDENTITY.md](PROJECT_IDENTITY.md)

## Requirements

- Node.js >= 24
- npm >= 11

## Local development

```powershell
npm ci
Copy-Item .env.example .env
# Edit .env with local-only random values.
npm run typecheck
npm run build
npm start
```

The console is served at `http://127.0.0.1:18080/admin` by default. The TCP
gateway defaults to `127.0.0.1:9001`.

## Configuration

See [.env.example](.env.example). For any network deployment, set independent
high-entropy values for `ADMIN_TOKEN` and `ACCOUNT_CREDENTIAL_KEY`, terminate
HTTP with TLS, and restrict the TCP gateway with a private network or device
authentication layer. Do not commit `.env` or `data/`.

## Data and generated files

The runtime writes `data/state.json` and a backup next to it. The web build
writes `public/`; the server build writes `dist/`. These paths are ignored by
Git and must be created during deployment.

## Security status

Before exposing this service to the Internet, complete the hardening work in
[SECURITY.md](SECURITY.md), especially TLS, credential rotation, file
permissions, and role separation. This sanitized release is for source review
and controlled deployment, not a claim that a production endpoint is secure by
default.

## License

MCU Quay is released under the **MCU Quay Development License 1.0 (MQDL-1.0)**;
see [LICENSE](LICENSE). The license permits commercial use, modification, and
redistribution, but it is a project-specific license and is not currently
OSI-approved or SPDX-listed.
