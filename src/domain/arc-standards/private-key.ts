import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const assertValidPrivateKey = (keyName: string, value: string): Hex => {
  try {
    privateKeyToAccount(value as Hex);
    return value as Hex;
  } catch {
    throw new Error(`Invalid ${keyName} value.`);
  }
};
