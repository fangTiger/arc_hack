# Arc Proof Console Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a server-backed Arc proof console to `/arc/sd/live` so operators can trigger ERC-8004 and ERC-8183 proof creation from the UI without exposing private keys.

**Architecture:** The browser calls local Express endpoints under `/api/arc/proofs`. The server reads proof runner configuration from environment variables, invokes the existing runner functions, writes artifacts, sanitizes errors, and returns public proof metadata only.

**Tech Stack:** TypeScript, Express, Viem, Vitest, inline HTML/CSS/JS in the existing live workbench route.

---

### Task 1: Arc Proof API

**Files:**
- Create: `src/routes/arc-proofs.ts`
- Test: `tests/routes.arc-proofs.test.ts`

**Step 1: Write failing tests**
Cover:
- `GET /api/arc/proofs/status` returns configured flags and latest artifact summaries.
- `POST /api/arc/proofs/erc8004` calls injected service and returns artifact without private keys.
- `POST /api/arc/proofs/erc8183` calls injected service and returns artifact without private keys.
- Missing env returns `400`.
- Runner failure returns `500` with sanitized message.

**Step 2: Implement minimal route**
Create a service interface:

```ts
type ArcProofService = {
  getStatus: () => Promise<ArcProofStatus>;
  runErc8004: () => Promise<ArcProofRunResponse>;
  runErc8183: () => Promise<ArcProofRunResponse>;
};
```

Default service should use existing `parseErc8004AgentEnv`, `runErc8004AgentProof`, `parseErc8183JobEnv`, and `runErc8183JobProof`.

**Step 3: Verify**
Run:

```bash
npm test -- --run tests/routes.arc-proofs.test.ts
```

### Task 2: App Wiring

**Files:**
- Modify: `src/app.ts`
- Modify: `tests/routes.arc-proofs.test.ts`

**Step 1: Write failing integration expectation**
Assert `createApp({ arcProofService })` exposes `/api/arc/proofs/status`.

**Step 2: Wire router**
Add `arcProofService?: ArcProofService` to `CreateAppOptions` and mount:

```ts
app.use('/api/arc/proofs', createArcProofRouter({ proofService: options.arcProofService }));
```

**Step 3: Verify**
Run route test again.

### Task 3: Live Workbench UI

**Files:**
- Modify: `src/routes/live.ts`
- Modify: `tests/routes.live.test.ts`

**Step 1: Write failing UI test**
Check rendered HTML contains:
- `id="arc-proof-console"`
- `id="run-erc8004-proof"`
- `id="run-erc8183-proof"`
- `/api/arc/proofs/status`
- `/api/arc/proofs/erc8004`
- `/api/arc/proofs/erc8183`
- text indicating private keys stay server-side.

**Step 2: Implement panel**
Add a compact tool panel near the existing command deck. Use existing tokens, restrained borders, fixed button heights, and no nested cards.

**Step 3: Implement browser JS**
On load, fetch status. On button click, call the matching POST endpoint, disable both buttons during execution, then render result links or sanitized error.

**Step 4: Verify**
Run:

```bash
npm test -- --run tests/routes.live.test.ts
```

### Task 4: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/runbooks/arc-circle-demo.md`

**Step 1: Update docs**
Document that CLI remains available and UI creation is available at `/arc/sd/live` via server-side `.env`.

**Step 2: Verify**
Run:

```bash
npm test -- --run tests/routes.arc-proofs.test.ts tests/routes.live.test.ts
```

### Task 5: Final Validation

**Files:**
- Modify: `openspec/changes/add-arc-proof-console/tasks.md`

**Step 1: Mark tasks done**
Check off completed tasks.

**Step 2: Validate**
Run:

```bash
npm test -- --run
npm run build
npx openspec validate add-arc-proof-console --strict --no-interactive
```
