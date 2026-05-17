import {
  formatCircleConsoleProofError,
  parseCircleConsoleEnv,
  runCircleConsoleProof,
  type CircleConsoleProofResult
} from '../src/domain/circle-console/proof.js';
import { writeCircleConsoleProofArtifact } from '../src/domain/circle-console/artifacts.js';
import { loadDotEnvFile } from '../src/config/env.js';

type RunCircleConsoleProofCliOptions = {
  envSource?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  artifactWriter?: (artifactPath: string, artifact: CircleConsoleProofResult['artifact']) => Promise<void>;
  requestIdFactory?: () => string;
};

export { formatCircleConsoleProofError, parseCircleConsoleEnv, runCircleConsoleProof } from '../src/domain/circle-console/proof.js';

export const runCircleConsoleProofCli = async (
  options: RunCircleConsoleProofCliOptions = {}
): Promise<CircleConsoleProofResult> => {
  const envSource = options.envSource ?? loadDotEnvFile(process.env);
  const env = parseCircleConsoleEnv(envSource);
  const result = await runCircleConsoleProof({
    env,
    fetchImpl: options.fetchImpl,
    artifactWriter: options.artifactWriter ?? writeCircleConsoleProofArtifact,
    requestIdFactory: options.requestIdFactory
  });

  (options.log ?? console.log)(JSON.stringify(result.artifact, null, 2));
  return result;
};

const main = async (): Promise<void> => {
  await runCircleConsoleProofCli();
};

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (error) {
    let parsedEnv:
      | ReturnType<typeof parseCircleConsoleEnv>
      | undefined;

    try {
      parsedEnv = parseCircleConsoleEnv(loadDotEnvFile(process.env));
    } catch {
      parsedEnv = undefined;
    }

    console.error(formatCircleConsoleProofError(error, parsedEnv));
    process.exit(1);
  }
}
