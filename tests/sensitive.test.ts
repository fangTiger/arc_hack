import { describe, expect, it } from 'vitest';

import {
  collectRuntimeSensitiveValues,
  extractSafeErrorMessage,
  sanitizeSensitiveText,
  sanitizeSensitiveValue,
  stripSensitiveUrlParts
} from '../src/support/sensitive.js';

describe('sensitive helpers', () => {
  it('should redact labeled secrets and explicit sensitive values', () => {
    const privateKey = '0x50fff75e326b04954b6d4b7fb4cbd046d943a640a88a4b3a2e59163dbbfcbece';
    const text = `Command failed with ARC_PRIVATE_KEY=${privateKey} and raw secret ${privateKey}`;

    expect(
      sanitizeSensitiveText(text, {
        sensitiveValues: [privateKey]
      })
    ).toBe('Command failed with ARC_PRIVATE_KEY=[REDACTED] and raw secret [REDACTED]');
  });

  it('should recursively redact nested log payloads', () => {
    const privateKey = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const payload = {
      error: `--private-key ${privateKey}`,
      nested: {
        secret: privateKey
      }
    };

    expect(
      sanitizeSensitiveValue(payload, {
        sensitiveValues: [privateKey]
      })
    ).toEqual({
      error: '--private-key [REDACTED]',
      nested: {
        secret: '[REDACTED]'
      }
    });
  });

  it('should redact error messages with bare secrets when the secret is known', () => {
    const privateKey = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    expect(
      extractSafeErrorMessage(new Error(`signer rejected ${privateKey}`), 'fallback', {
        sensitiveValues: [privateKey]
      })
    ).toBe('signer rejected [REDACTED]');
  });

  it('should redact sensitive URL query strings and runtime secret values together', () => {
    const secrets = collectRuntimeSensitiveValues({
      arcPrivateKey: undefined,
      gatewayBuyerPrivateKey: 'gateway-secret',
      llmApiKey: 'llm-secret'
    });

    expect(
      sanitizeSensitiveText(
        'Fetch https://example.com/path?signature=abc123 and use gateway-secret with llm-secret.',
        { sensitiveValues: secrets }
      )
    ).toBe('Fetch https://example.com/path?[REDACTED] and use [REDACTED] with [REDACTED].');
    expect(stripSensitiveUrlParts('https://example.com/path?signature=abc123#section')).toBe('https://example.com/path');
  });
});
