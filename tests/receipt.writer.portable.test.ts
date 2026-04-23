import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createWalletClientMock,
  encodeFunctionDataMock,
  httpMock,
  privateKeyToAccountMock,
  sendTransactionMock
} = vi.hoisted(() => ({
  createWalletClientMock: vi.fn(),
  encodeFunctionDataMock: vi.fn(),
  httpMock: vi.fn(),
  privateKeyToAccountMock: vi.fn(),
  sendTransactionMock: vi.fn()
}));

vi.mock('viem', () => ({
  createWalletClient: createWalletClientMock,
  encodeFunctionData: encodeFunctionDataMock,
  http: httpMock
}));

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: privateKeyToAccountMock
}));

const loadReceiptWriterModule = async () => import('../src/domain/receipt/writer.js');

const defaultTxHash = '0x1111111111111111111111111111111111111111111111111111111111111111';
const defaultAccount = {
  address: '0x1234567890123456789012345678901234567890'
};

beforeEach(() => {
  vi.resetModules();
  createWalletClientMock.mockReset();
  encodeFunctionDataMock.mockReset();
  httpMock.mockReset();
  privateKeyToAccountMock.mockReset();
  sendTransactionMock.mockReset();

  sendTransactionMock.mockResolvedValue(defaultTxHash);
  createWalletClientMock.mockReturnValue({
    sendTransaction: sendTransactionMock
  });
  encodeFunctionDataMock.mockReturnValue('0xencoded');
  httpMock.mockReturnValue({ transport: 'http' });
  privateKeyToAccountMock.mockReturnValue(defaultAccount);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('portable receipt writer', () => {
  it('redacts the private key when ARC receipt submission fails', async () => {
    const leakedPrivateKey = '0x50fff75e326b04954b6d4b7fb4cbd046d943a640a88a4b3a2e59163dbbfcbece';

    sendTransactionMock.mockRejectedValueOnce(new Error(`signer rejected ${leakedPrivateKey}`));

    const { createReceiptWriter } = await loadReceiptWriterModule();
    const writer = createReceiptWriter({
      mode: 'arc',
      rpcUrl: 'https://arc.example',
      contractAddress: '0x1234567890123456789012345678901234567890',
      privateKey: leakedPrivateKey
    });

    const error = await writer
      .write({
        requestId: 'demo-001',
        operation: 'summary',
        payloadHash: '0x1111111111111111111111111111111111111111111111111111111111111111'
      })
      .then(() => null)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('[REDACTED]');
    expect((error as Error).message).not.toContain(leakedPrivateKey);
  });

  it('signs and sends the receipt transaction with viem instead of shelling out to cast', async () => {
    const { createReceiptWriter } = await loadReceiptWriterModule();
    const writer = createReceiptWriter({
      mode: 'arc',
      rpcUrl: 'https://arc.example',
      contractAddress: '0x1234567890123456789012345678901234567890',
      privateKey: '0xabc'
    });

    await expect(
      writer.write({
        requestId: 'demo-001',
        operation: 'summary',
        payloadHash: '0x1111111111111111111111111111111111111111111111111111111111111111'
      })
    ).resolves.toEqual({
      mode: 'arc',
      txHash: defaultTxHash
    });

    expect(privateKeyToAccountMock).toHaveBeenCalledWith('0xabc');
    expect(httpMock).toHaveBeenCalledWith('https://arc.example');
    expect(encodeFunctionDataMock).toHaveBeenCalledWith({
      abi: expect.any(Array),
      functionName: 'recordReceipt',
      args: [
        'demo-001',
        'summary',
        '0x1111111111111111111111111111111111111111111111111111111111111111'
      ]
    });
    expect(sendTransactionMock).toHaveBeenCalledWith({
      account: defaultAccount,
      to: '0x1234567890123456789012345678901234567890',
      data: '0xencoded'
    });
  });
});
