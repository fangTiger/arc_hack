import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('arc standards artifacts', () => {
  it('should expose Arc constants and write JSON artifacts with explorer links', async () => {
    const constants = await import('../src/domain/arc-standards/constants.js');
    const artifacts = await import('../src/domain/arc-standards/artifacts.js');
    const abi = await import('../src/domain/arc-standards/abi.js');
    const workingDirectory = mkdtempSync(join(tmpdir(), 'arc-hack-arc-standards-'));
    temporaryDirectories.push(workingDirectory);

    const artifactPath = join(workingDirectory, 'artifacts', 'arc-standards', 'erc8004-agent.json');
    const registrationTxHash = `0x${'a'.repeat(64)}` as const;
    const reputationTxHash = `0x${'b'.repeat(64)}` as const;
    const validationRequestTxHash = `0x${'c'.repeat(64)}` as const;
    const validationResponseTxHash = `0x${'d'.repeat(64)}` as const;

    expect(constants.ARC_STANDARDS_ADDRESSES.identityRegistry).toBe('0x8004A818BFB912233c491871b3d84c89A494BD9e');
    expect(constants.ARC_STANDARDS_ADDRESSES.agenticCommerce).toBe('0x0747EEf0706327138c69792bF28Cd525089e4583');
    expect(constants.buildArcScanTxUrl(registrationTxHash)).toBe(`https://testnet.arcscan.app/tx/${registrationTxHash}`);
    expect(abi.erc8004IdentityAbi.some((item) => item.type === 'function' && item.name === 'register')).toBe(true);
    expect(abi.agenticCommerceAbi.some((item) => item.type === 'event' && item.name === 'JobCreated')).toBe(true);

    await artifacts.writeJsonArtifact(artifactPath, {
      owner: '0x1111111111111111111111111111111111111111',
      validator: '0x2222222222222222222222222222222222222222',
      agentId: '7',
      metadataUri: 'ipfs://arc-agent',
      registrationTxHash,
      reputationTxHash,
      validationRequestTxHash,
      validationResponseTxHash,
      requestHash: `0x${'e'.repeat(64)}`,
      explorerLinks: {
        registrationTx: constants.buildArcScanTxUrl(registrationTxHash),
        reputationTx: constants.buildArcScanTxUrl(reputationTxHash),
        validationRequestTx: constants.buildArcScanTxUrl(validationRequestTxHash),
        validationResponseTx: constants.buildArcScanTxUrl(validationResponseTxHash)
      }
    });

    const persisted = JSON.parse(readFileSync(artifactPath, 'utf8')) as Record<string, unknown>;

    expect(persisted.owner).toBe('0x1111111111111111111111111111111111111111');
    expect(persisted.explorerLinks).toEqual({
      registrationTx: `https://testnet.arcscan.app/tx/${registrationTxHash}`,
      reputationTx: `https://testnet.arcscan.app/tx/${reputationTxHash}`,
      validationRequestTx: `https://testnet.arcscan.app/tx/${validationRequestTxHash}`,
      validationResponseTx: `https://testnet.arcscan.app/tx/${validationResponseTxHash}`
    });
    expect(persisted).not.toHaveProperty('ownerPrivateKey');
    expect(persisted).not.toHaveProperty('validatorPrivateKey');
  });
});
