import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../src/app.js';
import { loadRuntimeEnv } from '../src/config/env.js';
import { LiveAgentSessionService, type LiveAgentSessionCreateInput } from '../src/demo/live-session.js';
import type { AgentSessionRun } from '../src/demo/agent-graph.js';
import {
  runAgentGraphSession as defaultRunAgentGraphSession,
  type AgentGraphRunOptions
} from '../src/demo/agent-session-runner.js';
import { FileAgentGraphStore } from '../src/store/agent-graph-store.js';
import { FileLiveAgentSessionStore } from '../src/store/live-session-store.js';

const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-e2e-'));
const E2E_SLOW_MARKER = '[e2e-slow]';
const E2E_GATEWAY_MARKER = '[e2e-gateway]';
const GATEWAY_NETWORK = 'eip155:5042002';
const GATEWAY_PAYER = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

const mockRuntimeEnv = loadRuntimeEnv({
  ...process.env,
  NODE_ENV: 'test',
  PORT: process.env.PORT ?? '3101',
  PAYMENT_MODE: 'mock',
  AI_MODE: 'mock',
  CALL_LOG_PATH: join(workingDirectory, 'call-log.jsonl')
});

const gatewayRuntimeEnv = loadRuntimeEnv({
  ...process.env,
  NODE_ENV: 'test',
  PORT: String(mockRuntimeEnv.port),
  PAYMENT_MODE: 'gateway',
  AI_MODE: 'mock',
  CALL_LOG_PATH: join(workingDirectory, 'call-log.jsonl'),
  GATEWAY_BUYER_BASE_URL: `http://127.0.0.1:${mockRuntimeEnv.port}`,
  GATEWAY_BUYER_PRIVATE_KEY: '0xe2etestbuyer',
  GATEWAY_BUYER_CHAIN: 'arcTestnet'
});

const sleep = async (milliseconds: number) => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const hasMarker = (value: string | undefined, marker: string): boolean => value?.includes(marker) ?? false;

const stripE2EMarkers = (value: string | undefined): string | undefined => {
  if (!value) {
    return value;
  }

  const normalized = value
    .replaceAll(E2E_SLOW_MARKER, ' ')
    .replaceAll(E2E_GATEWAY_MARKER, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized || undefined;
};

const stripGatewayMarker = (value: string | undefined): string | undefined => {
  if (!value) {
    return value;
  }

  const normalized = value.replaceAll(E2E_GATEWAY_MARKER, ' ').replace(/\s+/g, ' ').trim();
  return normalized || undefined;
};

const sanitizeInput = (input: LiveAgentSessionCreateInput): LiveAgentSessionCreateInput => ({
  ...input,
  ...(stripGatewayMarker(input.title) ? { title: stripGatewayMarker(input.title) } : {}),
  text: stripGatewayMarker(input.text) ?? input.text
});

const toAtomicAmount = (price: string): string => String(Math.round(Number(price.slice(1)) * 1_000_000));

const decorateGatewayRuns = (runs: AgentSessionRun[]): AgentSessionRun[] =>
  runs.map((run, index) => ({
    ...run,
    requestId: `gateway-${String(index + 1).padStart(3, '0')}`,
    paymentTransaction: `0xgateway-${run.operation}`,
    paymentAmount: toAtomicAmount(run.price),
    paymentNetwork: GATEWAY_NETWORK,
    paymentPayer: GATEWAY_PAYER
  }));

const emitGatewayReplay = async (
  options: AgentGraphRunOptions,
  runs: AgentSessionRun[],
  summary: string,
  entities: NonNullable<Awaited<ReturnType<typeof defaultRunAgentGraphSession>>['session']['entities']>,
  relations: NonNullable<Awaited<ReturnType<typeof defaultRunAgentGraphSession>>['session']['relations']>,
  slowScenario: boolean
) => {
  for (const run of runs) {
    await options.onProgress?.({
      type: 'step-started',
      step: run.operation,
      at: new Date().toISOString(),
      sessionId: options.sessionIdFactory?.() ?? 'e2e-gateway'
    });

    if (slowScenario) {
      await sleep(280);
    }

    await options.onProgress?.({
      type: 'step-completed',
      step: run.operation,
      at: new Date().toISOString(),
      sessionId: options.sessionIdFactory?.() ?? 'e2e-gateway',
      run,
      snapshot: {
        ...(run.operation === 'summary' ? { summary } : {}),
        ...(run.operation === 'entities' || run.operation === 'relations' ? { summary } : {}),
        ...(run.operation === 'entities' ? { entities } : {}),
        ...(run.operation === 'relations' ? { entities, relations } : {})
      }
    });

    if (slowScenario) {
      await sleep(420);
    }
  }
};

const runMockAgentGraphSession = async (options: AgentGraphRunOptions) => {
  const slowScenario = hasMarker(options.source?.text, E2E_SLOW_MARKER);

  if (!slowScenario) {
    return defaultRunAgentGraphSession(options);
  }

  return defaultRunAgentGraphSession({
    ...options,
    onProgress: async (event) => {
      await sleep(event.type === 'step-started' ? 220 : 520);
      await options.onProgress?.(event);
    }
  });
};

const runGatewayAgentGraphSession = async (options: AgentGraphRunOptions) => {
  const slowScenario = hasMarker(options.source?.text, E2E_SLOW_MARKER);
  const sanitizedSource = options.source
    ? {
        ...options.source,
        ...(stripE2EMarkers(options.source.title) ? { title: stripE2EMarkers(options.source.title) } : {}),
        text: stripE2EMarkers(options.source.text) ?? options.source.text
      }
    : options.source;
  const gatewaySessionId = options.sessionIdFactory?.() ?? 'e2e-gateway';
  const mockResult = await defaultRunAgentGraphSession({
    ...options,
    source: sanitizedSource,
    runtimeEnv: mockRuntimeEnv,
    onProgress: undefined,
    sessionIdFactory: () => gatewaySessionId
  });
  const gatewayRuns = decorateGatewayRuns(mockResult.session.runs);
  const gatewaySession = {
    ...mockResult.session,
    source: sanitizedSource ?? mockResult.session.source,
    runs: gatewayRuns
  };

  await new FileAgentGraphStore(options.artifactRootDirectory).writeSession(gatewaySession);
  await emitGatewayReplay(
    {
      ...options,
      sessionIdFactory: () => gatewaySessionId
    },
    gatewayRuns,
    gatewaySession.summary,
    gatewaySession.entities,
    gatewaySession.relations,
    slowScenario
  );

  return {
    ...mockResult,
    graphUrl: `${gatewayRuntimeEnv.gatewayBuyerBaseUrl}/demo/graph/${gatewaySession.sessionId}`,
    session: gatewaySession
  };
};

const agentGraphStore = new FileAgentGraphStore(join(workingDirectory, 'artifacts', 'agent-graph'));
const liveSessionStore = new FileLiveAgentSessionStore(join(workingDirectory, 'artifacts', 'live-console'));
const mockLiveSessionService = new LiveAgentSessionService({
  runtimeEnv: mockRuntimeEnv,
  liveSessionStore,
  agentGraphArtifactRootDirectory: agentGraphStore.getRootDirectory(),
  runAgentGraphSession: runMockAgentGraphSession
});
const gatewayLiveSessionService = new LiveAgentSessionService({
  runtimeEnv: gatewayRuntimeEnv,
  liveSessionStore,
  agentGraphArtifactRootDirectory: agentGraphStore.getRootDirectory(),
  runAgentGraphSession: runGatewayAgentGraphSession
});

const liveSessionService = {
  startSession(input: LiveAgentSessionCreateInput) {
    const sanitizedInput = sanitizeInput(input);
    const service = hasMarker(input.text, E2E_GATEWAY_MARKER) ? gatewayLiveSessionService : mockLiveSessionService;
    return service.startSession(sanitizedInput);
  },
  readSession(sessionId: string) {
    return liveSessionStore.readSession(sessionId);
  },
  readLatestSession() {
    return liveSessionStore.readLatestSession();
  },
  readActiveSession() {
    return liveSessionStore.readActiveSession();
  }
} as LiveAgentSessionService;

const app = createApp({
  runtimeEnv: mockRuntimeEnv,
  agentGraphStore,
  liveSessionStore,
  liveSessionService
});

const server = app.listen(mockRuntimeEnv.port, () => {
  console.log(`[e2e-server] listening on port ${mockRuntimeEnv.port}`);
});

const closeServer = () => {
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', closeServer);
process.on('SIGTERM', closeServer);
