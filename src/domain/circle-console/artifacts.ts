import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type CircleConsoleImportStatus =
  | 'already_imported'
  | 'imported'
  | 'skipped_missing_contract_address';

export type CircleConsoleProofArtifact = {
  checkedAt: string;
  walletCount: number;
  contractCount: number;
  usageReceiptImportStatus: CircleConsoleImportStatus;
  contractId?: string;
  contractAddress?: string;
  requestIds: {
    wallets?: string;
    contracts?: string;
    import?: string;
  };
  source: {
    runner: 'circle-console-proof';
    blockchain: 'ARC-TESTNET';
    apiBaseUrl: string;
  };
};

export type CircleConsoleProofArtifactSummary = CircleConsoleProofArtifact & {
  updatedAt?: string;
};

const isFileMissingError = (error: unknown): boolean => {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT');
};

export const writeCircleConsoleProofArtifact = async (
  artifactPath: string,
  value: CircleConsoleProofArtifact
): Promise<void> => {
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

export const readCircleConsoleProofArtifactSummary = async (
  artifactPath: string
): Promise<CircleConsoleProofArtifactSummary | null> => {
  try {
    const [contents, artifactStat] = await Promise.all([readFile(artifactPath, 'utf8'), stat(artifactPath)]);
    const artifact = JSON.parse(contents) as CircleConsoleProofArtifact;

    return {
      ...artifact,
      updatedAt: artifactStat.mtime.toISOString()
    };
  } catch (error) {
    if (isFileMissingError(error)) {
      return null;
    }

    return null;
  }
};
