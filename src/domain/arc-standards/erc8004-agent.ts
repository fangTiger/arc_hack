import { join } from 'node:path';

import type { Address, Hex } from 'viem';
import { keccak256, toHex } from 'viem';

import { extractSafeErrorMessage } from '../../support/sensitive.js';
import { erc8004IdentityAbi, erc8004ReputationAbi, erc8004ValidationAbi } from './abi.js';
import type { Erc8004AgentArtifact } from './artifacts.js';
import { writeJsonArtifact } from './artifacts.js';
import { ARC_STANDARDS_ADDRESSES, ARC_TESTNET_EXPLORER_BASE_URL, buildArcScanTxUrl } from './constants.js';
import { assertValidPrivateKey } from './private-key.js';
import { waitForSuccessfulTransaction, type ArcTransactionReceipt } from './runner-support.js';

type EnvSource = Record<string, string | undefined>;

export type Erc8004AgentEnv = {
  rpcUrl: string;
  ownerPrivateKey: Hex;
  validatorPrivateKey: Hex;
  metadataUri: string;
  validationRequestUri: string;
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
  waitForTransactionReceipt: (...args: any[]) => Promise<ArcTransactionReceipt>;
  getLogs: (...args: any[]) => Promise<any[]>;
};

export type Erc8004AgentProofOptions = {
  ownerClient: ArcWalletWriteClient;
  validatorClient: ArcWalletWriteClient;
  publicClient: ArcPublicClient;
  metadataUri: string;
  validationRequestUri: string;
  artifactPath: string;
  explorerBaseUrl?: string;
  artifactWriter?: typeof writeJsonArtifact;
};

export type Erc8004AgentProofResult = {
  artifactPath: string;
  artifact: Erc8004AgentArtifact;
};

const DEFAULT_VALIDATION_REQUEST_URI = 'ipfs://bafkreiexamplevalidationrequest';
const FEEDBACK_TAG = 'successful_trade';
const FEEDBACK_SCORE = 95n;
const ZERO_HASH = `0x${'0'.repeat(64)}` as const;
const VALIDATION_RESPONSE_CODE = 100;
const VALIDATION_RESPONSE_TAG = 'kyc_verified';
const TRANSFER_EVENT_ABI = erc8004IdentityAbi[3];

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

export const parseErc8004AgentEnv = (source: EnvSource): Erc8004AgentEnv => {
  const rpcUrl = getRequiredEnv(source, 'ARC_RPC_URL');
  const ownerPrivateKey = getRequiredEnv(source, 'ARC_AGENT_OWNER_PRIVATE_KEY');
  const validatorPrivateKey = getRequiredEnv(source, 'ARC_AGENT_VALIDATOR_PRIVATE_KEY');
  const metadataUri = getRequiredEnv(source, 'ARC_AGENT_METADATA_URI');
  const missing = [
    !rpcUrl ? 'ARC_RPC_URL' : null,
    !ownerPrivateKey ? 'ARC_AGENT_OWNER_PRIVATE_KEY' : null,
    !validatorPrivateKey ? 'ARC_AGENT_VALIDATOR_PRIVATE_KEY' : null,
    !metadataUri ? 'ARC_AGENT_METADATA_URI' : null
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing required ERC-8004 env vars: ${missing.join(', ')}`);
  }

  return {
    rpcUrl: rpcUrl!,
    ownerPrivateKey: assertValidPrivateKey('ARC_AGENT_OWNER_PRIVATE_KEY', ownerPrivateKey!),
    validatorPrivateKey: assertValidPrivateKey('ARC_AGENT_VALIDATOR_PRIVATE_KEY', validatorPrivateKey!),
    metadataUri: metadataUri!,
    validationRequestUri: getRequiredEnv(source, 'ARC_AGENT_VALIDATION_REQUEST_URI') ?? DEFAULT_VALIDATION_REQUEST_URI,
    artifactPath:
      getRequiredEnv(source, 'ARC_ERC8004_ARTIFACT_PATH') ??
      join(process.cwd(), 'artifacts', 'arc-standards', 'erc8004-agent.json'),
    explorerBaseUrl: getRequiredEnv(source, 'ARC_EXPLORER_BASE_URL') ?? ARC_TESTNET_EXPLORER_BASE_URL
  };
};

export const runErc8004AgentProof = async (options: Erc8004AgentProofOptions): Promise<Erc8004AgentProofResult> => {
  const ownerAddress = requireWalletAddress(options.ownerClient, 'Owner');
  const validatorAddress = requireWalletAddress(options.validatorClient, 'Validator');
  const explorerBaseUrl = options.explorerBaseUrl ?? ARC_TESTNET_EXPLORER_BASE_URL;
  const artifactWriter = options.artifactWriter ?? writeJsonArtifact;

  const registrationTxHash = await options.ownerClient.writeContract({
    address: ARC_STANDARDS_ADDRESSES.identityRegistry,
    abi: erc8004IdentityAbi,
    functionName: 'register',
    args: [options.metadataUri],
    account: options.ownerClient.account
  });
  const registrationReceipt = await waitForSuccessfulTransaction(
    options.publicClient,
    registrationTxHash,
    'Registration'
  );
  const transferLogs = (await options.publicClient.getLogs({
    address: ARC_STANDARDS_ADDRESSES.identityRegistry,
    event: TRANSFER_EVENT_ABI,
    args: { to: ownerAddress },
    fromBlock: registrationReceipt.blockNumber,
    toBlock: registrationReceipt.blockNumber
  })) as Array<{ args?: { tokenId?: bigint } }>;
  const agentId = transferLogs.at(-1)?.args?.tokenId;

  if (agentId == null) {
    throw new Error(`Could not parse agentId from Transfer event for registration tx ${registrationTxHash}.`);
  }

  const feedbackHash = keccak256(toHex(FEEDBACK_TAG));
  const reputationTxHash = await options.validatorClient.writeContract({
    address: ARC_STANDARDS_ADDRESSES.reputationRegistry,
    abi: erc8004ReputationAbi,
    functionName: 'giveFeedback',
    args: [agentId, FEEDBACK_SCORE, 0, FEEDBACK_TAG, '', '', '', feedbackHash],
    account: options.validatorClient.account
  });
  await waitForSuccessfulTransaction(options.publicClient, reputationTxHash, 'Reputation');

  const requestHash = keccak256(toHex(`kyc_verification_request_agent_${agentId}`));
  const validationRequestTxHash = await options.ownerClient.writeContract({
    address: ARC_STANDARDS_ADDRESSES.validationRegistry,
    abi: erc8004ValidationAbi,
    functionName: 'validationRequest',
    args: [validatorAddress, agentId, options.validationRequestUri, requestHash],
    account: options.ownerClient.account
  });
  await waitForSuccessfulTransaction(options.publicClient, validationRequestTxHash, 'Validation request');

  const validationResponseTxHash = await options.validatorClient.writeContract({
    address: ARC_STANDARDS_ADDRESSES.validationRegistry,
    abi: erc8004ValidationAbi,
    functionName: 'validationResponse',
    args: [requestHash, VALIDATION_RESPONSE_CODE, '', ZERO_HASH, VALIDATION_RESPONSE_TAG],
    account: options.validatorClient.account
  });
  await waitForSuccessfulTransaction(options.publicClient, validationResponseTxHash, 'Validation response');

  const artifact: Erc8004AgentArtifact = {
    owner: ownerAddress,
    validator: validatorAddress,
    agentId: agentId.toString(),
    metadataUri: options.metadataUri,
    registrationTxHash,
    reputationTxHash,
    validationRequestTxHash,
    validationResponseTxHash,
    requestHash,
    explorerLinks: {
      registrationTx: buildArcScanTxUrl(registrationTxHash, explorerBaseUrl),
      reputationTx: buildArcScanTxUrl(reputationTxHash, explorerBaseUrl),
      validationRequestTx: buildArcScanTxUrl(validationRequestTxHash, explorerBaseUrl),
      validationResponseTx: buildArcScanTxUrl(validationResponseTxHash, explorerBaseUrl)
    }
  };

  await artifactWriter(options.artifactPath, artifact);
  return {
    artifactPath: options.artifactPath,
    artifact
  };
};

export const formatErc8004AgentError = (error: unknown, env?: Partial<Erc8004AgentEnv>): string => {
  return extractSafeErrorMessage(error, 'ERC-8004 proof runner failed.', {
    sensitiveValues: [env?.ownerPrivateKey, env?.validatorPrivateKey].filter(Boolean) as string[]
  });
};
