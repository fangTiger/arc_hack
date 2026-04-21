import type { ExtractionRequest } from '../domain/extraction/types.js';

export const demoCorpus: ExtractionRequest[] = [
  {
    sourceType: 'news',
    title: 'Arc partners with Circle',
    text: 'Arc introduced gasless nanopayments for AI agents. Circle provides the settlement layer.'
  },
  {
    sourceType: 'research',
    title: 'Agentic commerce report',
    text: 'Researchers found that per-call pricing unlocks machine-to-machine payments. Arc lowers settlement friction.'
  },
  {
    sourceType: 'news',
    title: 'USDC expands utility',
    text: 'USDC is being used for developer payments. Nanopayments improve unit economics for API providers.'
  }
];
