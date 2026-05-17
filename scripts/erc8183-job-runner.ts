import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  formatErc8183JobError,
  parseErc8183JobEnv,
  runErc8183JobProof
} from '../src/domain/arc-standards/erc8183-job.js';

export { formatErc8183JobError, parseErc8183JobEnv, runErc8183JobProof } from '../src/domain/arc-standards/erc8183-job.js';

const main = async (): Promise<void> => {
  const env = parseErc8183JobEnv(process.env);
  const transport = http(env.rpcUrl);
  const clientAccount = privateKeyToAccount(env.clientPrivateKey);
  const providerAccount = privateKeyToAccount(env.providerPrivateKey);

  const publicClient = createPublicClient({ transport });
  const clientClient = createWalletClient({
    account: clientAccount,
    transport
  });
  const providerClient = createWalletClient({
    account: providerAccount,
    transport
  });

  const result = await runErc8183JobProof({
    clientClient,
    providerClient,
    publicClient,
    budgetAtomic: env.budgetAtomic,
    budgetUsdc: env.budgetUsdc,
    description: env.description,
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
      | ReturnType<typeof parseErc8183JobEnv>
      | undefined;

    try {
      parsedEnv = parseErc8183JobEnv(process.env);
    } catch {
      parsedEnv = undefined;
    }

    console.error(formatErc8183JobError(error, parsedEnv));
    process.exit(1);
  }
}
