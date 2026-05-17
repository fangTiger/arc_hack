# Circle Console Proof Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Circle Console proof path that uses the server-side Circle test API key to authenticate, read Circle Wallets / Contracts, and import the existing Arc `UsageReceipt` contract into Circle Contracts library without leaking secrets.

**Architecture:** Keep Circle credentials server-side in `.env`. Add a small domain runner that wraps Circle REST calls, writes a sanitized artifact, and exposes it through a guarded API and live workbench button. The first phase uses only `CIRCLE_API_KEY`; template deployments and App Kit flows are explicitly deferred until `CIRCLE_ENTITY_SECRET` / `KIT_KEY` are available.

**Tech Stack:** Node.js, TypeScript, Express, native `fetch`, Vitest, OpenSpec.

---

## Targets

- Produce `artifacts/circle-console/proof.json`.
- Import `USAGE_RECEIPT_ADDRESS` into Circle Contracts library when not already present.
- Add `/api/circle/console/status` and `/api/circle/console/proof`.
- Add a live workbench Circle Console proof card.
- Keep API key out of browser HTML, requests, responses, logs, tests, docs, and artifacts.

## Constraints

- `CIRCLE_API_KEY` is sensitive and must only be read from server-side env.
- `CIRCLE_ENTITY_SECRET` is not available yet, so do not deploy Circle contract templates in this phase.
- `KIT_KEY` is not available yet, so do not add App Kit runtime calls in this phase.
- `Graphify: unavailable` because `graphify-out/` and `graphify` CLI are absent.

## Task 1: Circle Console Domain

**Files:**
- Create: `src/domain/circle-console/artifacts.ts`
- Create: `src/domain/circle-console/proof.ts`
- Test: `tests/circle-console-proof.test.ts`

Steps:
1. Write tests for missing `CIRCLE_API_KEY`, API key redaction, existing UsageReceipt skip, and new import.
2. Implement env parsing with `CIRCLE_API_BASE_URL` defaulting to `https://api.circle.com`.
3. Implement `runCircleConsoleProof` with injected `fetch`, generated `X-Request-Id`, and sanitized artifact output.
4. Run `npm test -- --run tests/circle-console-proof.test.ts`.

## Task 2: CLI Runner

**Files:**
- Create: `scripts/circle-console-proof-runner.ts`
- Test: `tests/circle-console-proof-runner.test.ts`

Steps:
1. Write tests that CLI env parser rejects missing values and does not leak secrets.
2. Implement CLI that loads env, runs the domain proof, and prints sanitized artifact JSON.
3. Run `npm test -- --run tests/circle-console-proof-runner.test.ts`.

## Task 3: API Router

**Files:**
- Create: `src/routes/circle-console.ts`
- Modify: `src/app.ts`
- Test: `tests/routes.circle-console.test.ts`

Steps:
1. Add injected service tests for status, disabled `403`, sensitive request field rejection, enabled success, and sanitized failures.
2. Mount router at `/api/circle/console`.
3. Run `npm test -- --run tests/routes.circle-console.test.ts`.

## Task 4: Live Workbench UI

**Files:**
- Modify: `src/routes/live.ts`
- Modify: `tests/routes.live.test.ts`

Steps:
1. Add page assertions for Circle Console card, status endpoint, proof endpoint, disabled-by-default button, and success rendering.
2. Implement small UI card in the existing proof console area.
3. Run `npm test -- --run tests/routes.live.test.ts`.

## Task 5: Documentation and Env

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/runbooks/arc-circle-demo.md`

Steps:
1. Document `CIRCLE_API_KEY`, `CIRCLE_API_BASE_URL`, `CIRCLE_CONSOLE_PROOF_ENABLED`, `CIRCLE_CONSOLE_PROOF_ARTIFACT_PATH`.
2. Explain that template deployment needs `CIRCLE_ENTITY_SECRET`, and App Kit needs `KIT_KEY`.
3. Run `npm test -- --run tests/env.test.ts` if env parsing changes.

## Task 6: Integration Validation

Run:

```bash
npm test -- --run tests/circle-console-proof.test.ts tests/circle-console-proof-runner.test.ts tests/routes.circle-console.test.ts tests/routes.live.test.ts
npm test -- --run
npm run build
npx openspec validate add-circle-console-proof --strict --no-interactive
```

After review PASS, Architecture Codex will run the real Circle API proof with the local `.env` key and record only sanitized IDs / statuses.
