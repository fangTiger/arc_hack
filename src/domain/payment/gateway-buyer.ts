import { CHAIN_CONFIGS, GatewayClient, type Balances, type DepositResult, type PayResult, type SupportedChainName } from '@circle-fin/x402-batching/client';
import type { Hex } from 'viem';
import { formatUnits } from 'viem';

import type { ExtractionOperation, ExtractionRequest, ExtractionResult } from '../extraction/types.js';
import type {
  GatewayAcceptedOption,
  GatewayPaidExtractionPayload,
  GatewayPaymentAcceptedResult
} from './types.js';

export type GatewayBuyerConfig = {
  baseUrl: string;
  chain: SupportedChainName;
  privateKey: string;
  rpcUrl?: string;
  autoDepositAmount?: string;
};

export type PostProbeResponse = {
  x402Version: number;
  accepts: GatewayAcceptedOption[];
  resource?: unknown;
};

export type GatewayBuyerRequest = {
  requestId: string;
  operation: ExtractionOperation;
  body: ExtractionRequest;
};

export type GatewayBuyerProbe = {
  requestId: string;
  operation: ExtractionOperation;
  accepted: GatewayAcceptedOption;
  paymentRequired: PostProbeResponse;
};

export type GatewayBuyerPayment = {
  requestId: string;
  operation: ExtractionOperation;
  pricedOperation: GatewayPaidExtractionPayload<ExtractionResult>['pricedOperation'];
  result: ExtractionResult;
  payment: GatewayPaymentAcceptedResult;
  transaction: string;
  amount: bigint;
  formattedAmount: string;
  status: number;
};

export type GatewayBuyerBatchResult = {
  probes: GatewayBuyerProbe[];
  balances: {
    before: Balances;
    after: Balances;
  };
  deposit?: DepositResult;
  payments: GatewayBuyerPayment[];
};

export interface GatewayBuyerClient {
  readonly address: string;
  getBalances(): Promise<Balances>;
  deposit(amount: string): Promise<DepositResult>;
  pay<T>(url: string, options?: { method?: string; headers?: Record<string, string>; body?: unknown }): Promise<PayResult<T>>;
}

export type GatewayBuyerDependencies = {
  createClient: (config: GatewayBuyerConfig) => GatewayBuyerClient;
  fetch: typeof fetch;
};

export interface GatewayBuyer {
  probe(request: GatewayBuyerRequest): Promise<GatewayBuyerProbe>;
  payBatch(requests: GatewayBuyerRequest[]): Promise<GatewayBuyerBatchResult>;
}

const createOfficialClient = (config: GatewayBuyerConfig): GatewayBuyerClient => {
  return new GatewayClient({
    chain: config.chain,
    privateKey: config.privateKey as Hex,
    rpcUrl: config.rpcUrl
  });
};

const defaultDependencies: GatewayBuyerDependencies = {
  createClient: createOfficialClient,
  fetch: globalThis.fetch.bind(globalThis)
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '');

const buildOperationUrl = (baseUrl: string, operation: ExtractionOperation): string => {
  return `${normalizeBaseUrl(baseUrl)}/api/extract/${operation}`;
};

const sumAmounts = (probes: GatewayBuyerProbe[]): bigint => {
  return probes.reduce((total, probe) => total + BigInt(probe.accepted.amount), 0n);
};

const encodeJsonBody = (value: unknown): string => JSON.stringify(value);

const parsePaymentRequiredHeader = (headerValue: string | null): PostProbeResponse => {
  if (!headerValue) {
    throw new Error('Missing PAYMENT-REQUIRED header in 402 response.');
  }

  return JSON.parse(Buffer.from(headerValue, 'base64').toString('utf8')) as PostProbeResponse;
};

const isGatewayBatchingOption = (option: GatewayAcceptedOption, expectedNetwork: string): boolean => {
  return (
    option.network === expectedNetwork &&
    option.extra?.name === 'GatewayWalletBatched' &&
    option.extra?.version === '1' &&
    typeof option.extra?.verifyingContract === 'string'
  );
};

const formatAtomicUsdc = (value: bigint): string => formatUnits(value, 6);

const buildInsufficientBalanceError = (available: bigint, required: bigint): Error => {
  return new Error(
    `Gateway available balance is insufficient. Have ${formatAtomicUsdc(available)} USDC, need ${formatAtomicUsdc(required)} USDC.`
  );
};

const normalizeGatewayPayment = (
  payload: GatewayPaidExtractionPayload<ExtractionResult>,
  payResult: PayResult<GatewayPaidExtractionPayload<ExtractionResult>>,
  fallbackNetwork: string,
  fallbackPayer: string
): GatewayPaymentAcceptedResult => {
  return {
    mode: 'gateway',
    status: 'paid',
    payer: payload.payment.payer ?? fallbackPayer,
    amount: payload.payment.amount ?? payResult.amount.toString(),
    network: payload.payment.network ?? fallbackNetwork,
    transaction: payload.payment.transaction ?? payResult.transaction
  };
};

const buildGatewayPaymentFailureMessage = (
  status: number,
  statusText: string,
  payload: unknown
): string => {
  if (payload && typeof payload === 'object') {
    const error = typeof (payload as { error?: unknown }).error === 'string' ? (payload as { error: string }).error.trim() : '';
    const reason = typeof (payload as { reason?: unknown }).reason === 'string' ? (payload as { reason: string }).reason.trim() : '';
    const message = typeof (payload as { message?: unknown }).message === 'string' ? (payload as { message: string }).message.trim() : '';
    const parts = [...new Set([error, reason, message].filter(Boolean))];

    if (parts.length > 0) {
      return `Payment failed: ${parts.join(' | ')}`;
    }
  }

  if (typeof payload === 'string' && payload.trim()) {
    return `Payment failed: ${payload.trim()}`;
  }

  return statusText ? `Payment failed with status ${status}: ${statusText}` : `Payment failed with status ${status}.`;
};

type GatewayPayResult = Pick<
  PayResult<GatewayPaidExtractionPayload<ExtractionResult>>,
  'data' | 'amount' | 'formattedAmount' | 'transaction' | 'status'
>;

class GatewayBuyerImpl implements GatewayBuyer {
  private readonly client: GatewayBuyerClient;

  private readonly expectedNetwork: string;

  constructor(
    private readonly config: GatewayBuyerConfig,
    private readonly dependencies: GatewayBuyerDependencies
  ) {
    this.client = dependencies.createClient(config);
    this.expectedNetwork = `eip155:${CHAIN_CONFIGS[config.chain].chain.id}`;
  }

  async probe(request: GatewayBuyerRequest): Promise<GatewayBuyerProbe> {
    const response = await this.dependencies.fetch(buildOperationUrl(this.config.baseUrl, request.operation), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': request.requestId
      },
      body: encodeJsonBody(request.body)
    });

    if (response.status !== 402) {
      throw new Error(`Expected seller probe to return 402, received ${response.status}.`);
    }

    const paymentRequired = parsePaymentRequiredHeader(response.headers.get('PAYMENT-REQUIRED'));
    const accepted = paymentRequired.accepts.find((option) => isGatewayBatchingOption(option, this.expectedNetwork));

    if (!accepted) {
      throw new Error(
        `No Gateway batching option available for network ${this.expectedNetwork}. Seller response does not match the buyer chain.`
      );
    }

    return {
      requestId: request.requestId,
      operation: request.operation,
      accepted,
      paymentRequired
    };
  }

  private async payWithDiagnostics(
    request: GatewayBuyerRequest,
    probe: GatewayBuyerProbe
  ): Promise<GatewayPayResult> {
    const operationUrl = buildOperationUrl(this.config.baseUrl, request.operation);
    const paymentPayloadFactory = (
      this.client as GatewayBuyerClient & {
        createPaymentPayload?: (
          x402Version: number,
          paymentRequirements: GatewayAcceptedOption
        ) => Promise<{
          x402Version: number;
          payload: unknown;
        }>;
      }
    ).createPaymentPayload;

    if (!paymentPayloadFactory) {
      return this.client.pay<GatewayPaidExtractionPayload<ExtractionResult>>(operationUrl, {
        method: 'POST',
        headers: {
          'x-request-id': request.requestId
        },
        body: request.body
      });
    }

    const paymentPayload = await paymentPayloadFactory.call(
      this.client,
      probe.paymentRequired.x402Version ?? 2,
      probe.accepted
    );
    const paymentHeader = Buffer.from(
      JSON.stringify({
        ...paymentPayload,
        resource: probe.paymentRequired.resource,
        accepted: probe.accepted
      })
    ).toString('base64');
    const response = await this.dependencies.fetch(operationUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': request.requestId,
        'Payment-Signature': paymentHeader
      },
      body: encodeJsonBody(request.body)
    });

    if (!response.ok) {
      const text = await response.text();
      let payload: unknown = text;

      if (text) {
        try {
          payload = JSON.parse(text) as unknown;
        } catch {
          payload = text;
        }
      }

      throw new Error(buildGatewayPaymentFailureMessage(response.status, response.statusText, payload));
    }

    const payload = (await response.json()) as GatewayPaidExtractionPayload<ExtractionResult>;
    const amount = BigInt(probe.accepted.amount);

    return {
      data: payload,
      amount,
      formattedAmount: formatAtomicUsdc(amount),
      transaction: payload.payment.transaction,
      status: response.status
    };
  }

  async payBatch(requests: GatewayBuyerRequest[]): Promise<GatewayBuyerBatchResult> {
    const probes: GatewayBuyerProbe[] = [];

    for (const request of requests) {
      probes.push(await this.probe(request));
    }

    const requiredAmount = sumAmounts(probes);
    const balancesBefore = await this.client.getBalances();
    let deposit: DepositResult | undefined;

    if (balancesBefore.gateway.available < requiredAmount) {
      if (!this.config.autoDepositAmount) {
        throw buildInsufficientBalanceError(balancesBefore.gateway.available, requiredAmount);
      }

      deposit = await this.client.deposit(this.config.autoDepositAmount);
      const balancesAfterDeposit = await this.client.getBalances();

      if (balancesAfterDeposit.gateway.available < requiredAmount) {
        throw buildInsufficientBalanceError(balancesAfterDeposit.gateway.available, requiredAmount);
      }
    }

    const payments: GatewayBuyerPayment[] = [];

    for (const [index, request] of requests.entries()) {
      const probe = probes[index]!;
      const payResult = await this.payWithDiagnostics(request, probe);
      const payload = payResult.data;

      payments.push({
        requestId: payload.requestId,
        operation: request.operation,
        pricedOperation: payload.pricedOperation,
        result: payload.result,
        payment: normalizeGatewayPayment(payload, payResult, this.expectedNetwork, this.client.address),
        transaction: payResult.transaction,
        amount: payResult.amount,
        formattedAmount: payResult.formattedAmount,
        status: payResult.status
      });
    }

    const balancesAfter = await this.client.getBalances();

    return {
      probes,
      balances: {
        before: balancesBefore,
        after: balancesAfter
      },
      deposit,
      payments
    };
  }
}

export const createGatewayBuyer = (
  config: GatewayBuyerConfig,
  dependencies: Partial<GatewayBuyerDependencies> = {}
): GatewayBuyer => {
  return new GatewayBuyerImpl(config, {
    ...defaultDependencies,
    ...dependencies
  });
};
