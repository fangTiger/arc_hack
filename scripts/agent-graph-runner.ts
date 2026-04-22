import { join } from 'node:path';

import { getRuntimeEnv } from '../src/config/env.js';
import { runAgentGraphSession } from '../src/demo/agent-session-runner.js';
import { demoCorpus } from '../src/demo/corpus.js';
import type { ExtractionRequest } from '../src/domain/extraction/types.js';
import { parseReceiptWriterFromEnv } from './demo-runner.js';
export * from '../src/demo/agent-session-runner.js';

const buildSourceFromEnv = (): ExtractionRequest => {
  const defaultSource = demoCorpus[0];
  const sourceType = process.env.AGENT_SOURCE_TYPE === 'research' ? 'research' : defaultSource.sourceType;

  return {
    sourceType,
    title: process.env.AGENT_SOURCE_TITLE ?? defaultSource.title,
    text: process.env.AGENT_SOURCE_TEXT ?? defaultSource.text
  };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const runtimeEnv = getRuntimeEnv();
  const receiptWriter = parseReceiptWriterFromEnv();
  const result = await runAgentGraphSession({
    artifactRootDirectory: process.env.DEMO_ARTIFACT_DIR ?? join(process.cwd(), 'artifacts', 'agent-graph'),
    source: buildSourceFromEnv(),
    runtimeEnv,
    receiptWriter,
    graphBaseUrl: process.env.GRAPH_BASE_URL
  });

  console.log(`sessionId: ${result.sessionId}`);
  console.log(`artifactPath: ${result.artifactPath}`);
  console.log(`graphUrl: ${result.graphUrl}`);
}
