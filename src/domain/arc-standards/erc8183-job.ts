import { join } from 'node:path';

import type { Address, Hex } from 'viem';
import { decodeEventLog, keccak256, parseUnits, toHex } from 'viem';

import { extractSafeErrorMessage } from '../../support/sensitive.js';
import { agenticCommerceAbi, erc20Abi } from './abi.js';
import type { Erc8183JobArtifact } from './artifacts.js';
import { writeJsonArtifact } from './artifacts.js';
import {
  ARC_STANDARDS_ADDRESSES,
  ARC_TESTNET_EXPLORER_BASE_URL,
  ARC_USDC_DECIMALS,
  ERC8183_JOB_STATUS,
  buildArcScanTxUrl,
  ZERO_ADDRESS
} from './constants.js';
import { assertValidPrivateKey } from './private-key.js';
import {
  waitForSuccessfulTransaction,
  type ArcTransactionReceipt,
  type ArcTransactionReceiptLog
} from './runner-support.js';

type EnvSource = Record<string, string | undefined>;

export type Erc8183JobEnv = {
  rpcUrl: string;
  clientPrivateKey: Hex;
  providerPrivateKey: Hex;
  budgetAtomic: bigint;
  budgetUsdc: string;
  description: string;
  artifactPath: string;
  explorerBaseUrl: string;
};

type ArcWalletAccount = {
  address: string;
};

export type ArcWalletWriteClient = {
  account?: ArcWalletAccount;
  writeContract: (...args: any[]) => Promise<Hex>;
};

export type ArcPublicClient = {
  getBlock: (...args: any[]) => Promise<{ timestamp: bigint }>;
  waitForTransactionReceipt: (...args: any[]) => Promise<ArcTransactionReceipt>;
  readContract: (...args: any[]) => Promise<any>;
};

export type Erc8183JobProofOptions = {
  clientClient: ArcWalletWriteClient;
  providerClient: ArcWalletWriteClient;
  publicClient: ArcPublicClient;
  budgetAtomic: bigint;
  budgetUsdc: string;
  description: string;
  artifactPath: string;
  explorerBaseUrl?: string;
  artifactWriter?: typeof writeJsonArtifact;
};

export type Erc8183JobProofResult = {
  artifactPath: string;
  artifact: Erc8183JobArtifact;
};

const DEFAULT_JOB_DESCRIPTION = 'ERC-8183 demo job on Arc Testnet';
const DELIVERABLE_HASH = keccak256(toHex('arc-erc8183-demo-deliverable'));
const REASON_HASH = keccak256(toHex('work-delivered-and-approved'));
const JOB_EXPIRY_SECONDS = 3_600n;
type AgenticCommerceAbiItem = (typeof agenticCommerceAbi)[number];

const findAgenticCommerceAbiItem = <ItemType extends AgenticCommerceAbiItem['type'], ItemName extends string>(
  type: ItemType,
  name: ItemName
): Extract<AgenticCommerceAbiItem, { type: ItemType; name: ItemName }> => {
  const item = agenticCommerceAbi.find(
    (candidate): candidate is Extract<AgenticCommerceAbiItem, { type: ItemType; name: ItemName }> =>
      candidate.type === type && candidate.name === name
  );

  if (!item) {
    throw new Error(`Missing AgenticCommerce ABI item: ${type} ${name}`);
  }

  return item;
};

const JOB_CREATED_EVENT_ABI = findAgenticCommerceAbiItem('event', 'JobCreated');

const getRequiredEnv = (source: EnvSource, key: string): string | undefined => {
  const value = source[key]?.trim();
  return value ? value : undefined;
};

const requireWalletAddress = (client: ArcWalletWriteClient, label: string): Address => {
  const address = client.account?.address as Address | undefined;

  if (!address) {
    throw new Error(`${label} wallet client is missing an account address.`);
  }

  return address;
};

const formatBudgetError = (): Error => new Error('ERC-8183 预算必须是正数 USDC。');

const parseBudget = (value: string | undefined): { budgetUsdc: string; budgetAtomic: bigint } => {
  const normalized = value?.trim();

  if (normalized === undefined) {
    return {
      budgetUsdc: '1',
      budgetAtomic: parseUnits('1', ARC_USDC_DECIMALS)
    };
  }

  if (!normalized) {
    throw formatBudgetError();
  }

  let budgetAtomic: bigint;

  try {
    budgetAtomic = parseUnits(normalized, ARC_USDC_DECIMALS);
  } catch {
    throw formatBudgetError();
  }

  if (budgetAtomic <= 0n) {
    throw formatBudgetError();
  }

  return {
    budgetUsdc: normalized,
    budgetAtomic
  };
};

const resolveJobStatusName = (status: number): string => {
  const match = Object.entries(ERC8183_JOB_STATUS).find(([, code]) => code === status);
  return match?.[0] ?? `Unknown(${status})`;
};

const isAgenticCommerceLog = (log: ArcTransactionReceiptLog): boolean => {
  return log.address?.toLowerCase() === ARC_STANDARDS_ADDRESSES.agenticCommerce.toLowerCase();
};

const parseJobIdFromCreateReceipt = (receipt: ArcTransactionReceipt, createTxHash: Hex): bigint => {
  for (const log of receipt.logs ?? []) {
    if (!isAgenticCommerceLog(log) || !log.data || !log.topics) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: agenticCommerceAbi,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]]
      });

      if (decoded.eventName !== 'JobCreated') {
        continue;
      }

      const jobId = (decoded.args as { jobId?: bigint }).jobId;

      if (jobId != null) {
        return jobId;
      }
    } catch {
      continue;
    }
  }

  throw new Error(`Could not parse JobCreated event from create tx ${createTxHash}.`);
};

export const parseErc8183JobEnv = (source: EnvSource): Erc8183JobEnv => {
  const rpcUrl = getRequiredEnv(source, 'ARC_RPC_URL');
  const clientPrivateKey = getRequiredEnv(source, 'ARC_JOB_CLIENT_PRIVATE_KEY');
  const providerPrivateKey = getRequiredEnv(source, 'ARC_JOB_PROVIDER_PRIVATE_KEY');
  const missing = [
    !rpcUrl ? 'ARC_RPC_URL' : null,
    !clientPrivateKey ? 'ARC_JOB_CLIENT_PRIVATE_KEY' : null,
    !providerPrivateKey ? 'ARC_JOB_PROVIDER_PRIVATE_KEY' : null
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing required ERC-8183 env vars: ${missing.join(', ')}`);
  }

  const { budgetAtomic, budgetUsdc } = parseBudget(source.ARC_JOB_BUDGET_USDC);

  return {
    rpcUrl: rpcUrl!,
    clientPrivateKey: assertValidPrivateKey('ARC_JOB_CLIENT_PRIVATE_KEY', clientPrivateKey!),
    providerPrivateKey: assertValidPrivateKey('ARC_JOB_PROVIDER_PRIVATE_KEY', providerPrivateKey!),
    budgetAtomic,
    budgetUsdc,
    description: getRequiredEnv(source, 'ARC_JOB_DESCRIPTION') ?? DEFAULT_JOB_DESCRIPTION,
    artifactPath:
      getRequiredEnv(source, 'ARC_ERC8183_ARTIFACT_PATH') ??
      join(process.cwd(), 'artifacts', 'arc-standards', 'erc8183-job.json'),
    explorerBaseUrl: getRequiredEnv(source, 'ARC_EXPLORER_BASE_URL') ?? ARC_TESTNET_EXPLORER_BASE_URL
  };
};

export const runErc8183JobProof = async (options: Erc8183JobProofOptions): Promise<Erc8183JobProofResult> => {
  const clientAddress = requireWalletAddress(options.clientClient, 'Client');
  const providerAddress = requireWalletAddress(options.providerClient, 'Provider');
  const artifactWriter = options.artifactWriter ?? writeJsonArtifact;
  const explorerBaseUrl = options.explorerBaseUrl ?? ARC_TESTNET_EXPLORER_BASE_URL;
  const latestBlock = await options.publicClient.getBlock();
  const expiredAt = latestBlock.timestamp + JOB_EXPIRY_SECONDS;

  const createTxHash = await options.clientClient.writeContract({
    address: ARC_STANDARDS_ADDRESSES.agenticCommerce,
    abi: agenticCommerceAbi,
    functionName: 'createJob',
    args: [providerAddress, clientAddress, expiredAt, options.description, ZERO_ADDRESS],
    account: options.clientClient.account
  });
  const createReceipt = await waitForSuccessfulTransaction(options.publicClient, createTxHash, 'Create job');
  const jobId = parseJobIdFromCreateReceipt(createReceipt, createTxHash);

  const setBudgetTxHash = await options.providerClient.writeContract({
    address: ARC_STANDARDS_ADDRESSES.agenticCommerce,
    abi: agenticCommerceAbi,
    functionName: 'setBudget',
    args: [jobId, options.budgetAtomic, '0x'],
    account: options.providerClient.account
  });
  await waitForSuccessfulTransaction(options.publicClient, setBudgetTxHash, 'Set budget');

  const approveTxHash = await options.clientClient.writeContract({
    address: ARC_STANDARDS_ADDRESSES.usdc,
    abi: erc20Abi,
    functionName: 'approve',
    args: [ARC_STANDARDS_ADDRESSES.agenticCommerce, options.budgetAtomic],
    account: options.clientClient.account
  });
  await waitForSuccessfulTransaction(options.publicClient, approveTxHash, 'Approve USDC');

  const fundTxHash = await options.clientClient.writeContract({
    address: ARC_STANDARDS_ADDRESSES.agenticCommerce,
    abi: agenticCommerceAbi,
    functionName: 'fund',
    args: [jobId, '0x'],
    account: options.clientClient.account
  });
  await waitForSuccessfulTransaction(options.publicClient, fundTxHash, 'Fund escrow');

  const submitTxHash = await options.providerClient.writeContract({
    address: ARC_STANDARDS_ADDRESSES.agenticCommerce,
    abi: agenticCommerceAbi,
    functionName: 'submit',
    args: [jobId, DELIVERABLE_HASH, '0x'],
    account: options.providerClient.account
  });
  await waitForSuccessfulTransaction(options.publicClient, submitTxHash, 'Submit deliverable');

  const completeTxHash = await options.clientClient.writeContract({
    address: ARC_STANDARDS_ADDRESSES.agenticCommerce,
    abi: agenticCommerceAbi,
    functionName: 'complete',
    args: [jobId, REASON_HASH, '0x'],
    account: options.clientClient.account
  });
  await waitForSuccessfulTransaction(options.publicClient, completeTxHash, 'Complete job');

  const finalJob = (await options.publicClient.readContract({
    address: ARC_STANDARDS_ADDRESSES.agenticCommerce,
    abi: agenticCommerceAbi,
    functionName: 'getJob',
    args: [jobId]
  })) as { id: bigint; status: number; budget: bigint; hook?: Address };
  const finalStatus = resolveJobStatusName(finalJob.status);

  if (finalJob.status !== ERC8183_JOB_STATUS.Completed) {
    throw new Error(`Final job status for ${jobId} is ${finalStatus}; expected Completed.`);
  }

  const artifact: Erc8183JobArtifact = {
    client: clientAddress,
    provider: providerAddress,
    jobId: jobId.toString(),
    budgetAtomic: options.budgetAtomic.toString(),
    budgetUsdc: options.budgetUsdc,
    description: options.description,
    createTxHash,
    setBudgetTxHash,
    approveTxHash,
    fundTxHash,
    submitTxHash,
    completeTxHash,
    deliverableHash: DELIVERABLE_HASH,
    reasonHash: REASON_HASH,
    finalStatus,
    explorerLinks: {
      createTx: buildArcScanTxUrl(createTxHash, explorerBaseUrl),
      setBudgetTx: buildArcScanTxUrl(setBudgetTxHash, explorerBaseUrl),
      approveTx: buildArcScanTxUrl(approveTxHash, explorerBaseUrl),
      fundTx: buildArcScanTxUrl(fundTxHash, explorerBaseUrl),
      submitTx: buildArcScanTxUrl(submitTxHash, explorerBaseUrl),
      completeTx: buildArcScanTxUrl(completeTxHash, explorerBaseUrl)
    }
  };

  await artifactWriter(options.artifactPath, artifact);
  return {
    artifactPath: options.artifactPath,
    artifact
  };
};

export const formatErc8183JobError = (error: unknown, env?: Partial<Erc8183JobEnv>): string => {
  return extractSafeErrorMessage(error, 'ERC-8183 proof runner failed.', {
    sensitiveValues: [env?.clientPrivateKey, env?.providerPrivateKey].filter(Boolean) as string[]
  });
};
