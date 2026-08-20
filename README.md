# MCU Relay Backend

MCU Relay Backend is a Node.js/TypeScript service and React console for managing MCU devices through HTTP, TCP, optional MQTT, command queues, device reports, automation rules, OTA tasks, and Server-Sent Events.

> This repository is a sanitized source release. Production state, credentials, generated bundles, rollback archives, and deployment secrets are intentionally excluded.

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

The console is served at `http://127.0.0.1:18080/admin` by default. The TCP gateway defaults to `127.0.0.1:9001`.

## Configuration

See [.env.example](.env.example). For any network deployment, set independent high-entropy values for `ADMIN_TOKEN` and `ACCOUNT_CREDENTIAL_KEY`, terminate HTTP with TLS, and restrict the TCP gateway with a private network or device authentication layer. Do not commit `.env` or `data/`.

## Data and generated files

The runtime writes `data/state.json` and a backup next to it. The web build writes `public/`; the server build writes `dist/`. These paths are ignored by Git and must be created during deployment.

## Security status

Before exposing this service to the Internet, complete the hardening work in [SECURITY.md](SECURITY.md), especially TLS, credential rotation, file permissions, and role separation. The sanitized release is for source review and controlled deployment, not a claim that the production endpoint is secure by default.

## License

MIT. See [LICENSE](LICENSE).
