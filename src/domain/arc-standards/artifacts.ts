import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Address, Hex } from 'viem';

export type Erc8004AgentArtifact = {
  owner: Address;
  validator: Address;
  agentId: string;
  metadataUri: string;
  registrationTxHash: Hex;
  reputationTxHash: Hex;
  validationRequestTxHash: Hex;
  validationResponseTxHash: Hex;
  requestHash: Hex;
  explorerLinks: {
    registrationTx: string;
    reputationTx: string;
    validationRequestTx: string;
    validationResponseTx: string;
  };
};

export type Erc8183JobArtifact = {
  client: Address;
  provider: Address;
  jobId: string;
  budgetAtomic: string;
  budgetUsdc: string;
  description: string;
  createTxHash: Hex;
  setBudgetTxHash: Hex;
  approveTxHash: Hex;
  fundTxHash: Hex;
  submitTxHash: Hex;
  completeTxHash: Hex;
  deliverableHash: Hex;
  reasonHash: Hex;
  finalStatus: string;
  explorerLinks: {
    createTx: string;
    setBudgetTx: string;
    approveTx: string;
    fundTx: string;
    submitTx: string;
    completeTx: string;
  };
};

export const writeJsonArtifact = async <Value extends Erc8004AgentArtifact | Erc8183JobArtifact>(
  artifactPath: string,
  value: Value
): Promise<void> => {
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};
