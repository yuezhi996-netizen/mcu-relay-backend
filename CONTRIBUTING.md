# Contributing

1. Create a branch from `main`.
2. Do not commit `.env`, `data/`, generated `dist/` or `public/`, production state, or device credentials.
3. Run `npm ci`, `npm run typecheck`, and `npm run build` before opening a pull request.
4. Include a regression test for behavior changes. Test sources must be restored/added before relying on `npm test`.
5. Never include real tokens, passwords, API keys, or private endpoint data in issues or pull requests.
