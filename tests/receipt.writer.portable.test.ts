import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createPublicClientMock,
  createWalletClientMock,
  encodeFunctionDataMock,
  getTransactionCountMock,
  httpMock,
  privateKeyToAccountMock,
  sendTransactionMock
} = vi.hoisted(() => ({
  createPublicClientMock: vi.fn(),
  createWalletClientMock: vi.fn(),
  encodeFunctionDataMock: vi.fn(),
  getTransactionCountMock: vi.fn(),
  httpMock: vi.fn(),
  privateKeyToAccountMock: vi.fn(),
  sendTransactionMock: vi.fn()
}));

vi.mock('viem', () => ({
  createPublicClient: createPublicClientMock,
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
  createPublicClientMock.mockReset();
  createWalletClientMock.mockReset();
  encodeFunctionDataMock.mockReset();
  getTransactionCountMock.mockReset();
  httpMock.mockReset();
  privateKeyToAccountMock.mockReset();
  sendTransactionMock.mockReset();

  getTransactionCountMock.mockResolvedValue(121);
  sendTransactionMock.mockResolvedValue(defaultTxHash);
  createPublicClientMock.mockReturnValue({
    getTransactionCount: getTransactionCountMock
  });
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
      data: '0xencoded',
      nonce: 121
    });
  });

  it('increments the nonce locally across sequential receipt writes even when the rpc nonce lags', async () => {
    getTransactionCountMock.mockResolvedValue(121);

    const { createReceiptWriter } = await loadReceiptWriterModule();
    const writer = createReceiptWriter({
      mode: 'arc',
      rpcUrl: 'https://arc.example',
      contractAddress: '0x1234567890123456789012345678901234567890',
      privateKey: '0xabc'
    });

    await writer.write({
      requestId: 'demo-001',
      operation: 'summary',
      payloadHash: '0x1111111111111111111111111111111111111111111111111111111111111111'
    });
    await writer.write({
      requestId: 'demo-002',
      operation: 'entities',
      payloadHash: '0x2222222222222222222222222222222222222222222222222222222222222222'
    });

    expect(getTransactionCountMock).toHaveBeenNthCalledWith(1, {
      address: '0x1234567890123456789012345678901234567890',
      blockTag: 'pending'
    });
    expect(getTransactionCountMock).toHaveBeenNthCalledWith(2, {
      address: '0x1234567890123456789012345678901234567890',
      blockTag: 'pending'
    });
    expect(sendTransactionMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        nonce: 121
      })
    );
    expect(sendTransactionMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        nonce: 122
      })
    );
  });

  it('keeps the next nonce reserved after an ambiguous transport failure', async () => {
    getTransactionCountMock
      .mockResolvedValueOnce(121)
      .mockResolvedValueOnce(121)
      .mockResolvedValueOnce(121);
    sendTransactionMock
      .mockRejectedValueOnce(new Error('request timed out while waiting for rpc response'))
      .mockResolvedValueOnce(defaultTxHash);

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
    ).rejects.toThrow('request timed out');

    await expect(
      writer.write({
        requestId: 'demo-002',
        operation: 'entities',
        payloadHash: '0x2222222222222222222222222222222222222222222222222222222222222222'
      })
    ).resolves.toEqual({
      mode: 'arc',
      txHash: defaultTxHash
    });

    expect(sendTransactionMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        nonce: 122
      })
    );
  });

  it('re-syncs with the pending nonce after a deterministic chain rejection', async () => {
    getTransactionCountMock
      .mockResolvedValueOnce(121)
      .mockResolvedValueOnce(130)
      .mockResolvedValueOnce(130);
    sendTransactionMock
      .mockRejectedValueOnce(new Error('nonce too low'))
      .mockResolvedValueOnce(defaultTxHash);

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
    ).rejects.toThrow('nonce too low');

    await expect(
      writer.write({
        requestId: 'demo-002',
        operation: 'entities',
        payloadHash: '0x2222222222222222222222222222222222222222222222222222222222222222'
      })
    ).resolves.toEqual({
      mode: 'arc',
      txHash: defaultTxHash
    });

    expect(sendTransactionMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        nonce: 130
      })
    );
  });
});
