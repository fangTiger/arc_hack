import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  formatErc8004AgentError,
  parseErc8004AgentEnv,
  runErc8004AgentProof
} from '../src/domain/arc-standards/erc8004-agent.js';

export { formatErc8004AgentError, parseErc8004AgentEnv, runErc8004AgentProof } from '../src/domain/arc-standards/erc8004-agent.js';

const main = async (): Promise<void> => {
  const env = parseErc8004AgentEnv(process.env);
  const transport = http(env.rpcUrl);
  const ownerAccount = privateKeyToAccount(env.ownerPrivateKey);
  const validatorAccount = privateKeyToAccount(env.validatorPrivateKey);

  const publicClient = createPublicClient({ transport });
  const ownerClient = createWalletClient({
    account: ownerAccount,
    transport
  });
  const validatorClient = createWalletClient({
    account: validatorAccount,
    transport
  });

  const result = await runErc8004AgentProof({
    ownerClient,
    validatorClient,
    publicClient,
    metadataUri: env.metadataUri,
    validationRequestUri: env.validationRequestUri,
    artifactPath: env.artifactPath,
    explorerBaseUrl: env.explorerBaseUrl
  });

  console.log(JSON.stringify(result.artifact, null, 2));
};

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (error) {
    let parsedEnv:
      | ReturnType<typeof parseErc8004AgentEnv>
      | undefined;

    try {
      parsedEnv = parseErc8004AgentEnv(process.env);
    } catch {
      parsedEnv = undefined;
    }

    console.error(formatErc8004AgentError(error, parsedEnv));
    process.exit(1);
  }
}
