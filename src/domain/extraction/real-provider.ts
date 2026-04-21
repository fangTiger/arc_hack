import type { KnowledgeExtractionProvider } from './provider.js';
import type {
  ExtractionOperation,
  ExtractionRequest,
  ExtractionResult
} from './types.js';

type RealKnowledgeExtractionProviderOptions = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  fetchImplementation?: typeof fetch;
};

const buildOperationInstruction = (operation: ExtractionOperation): string => {
  if (operation === 'summary') {
    return '请输出 JSON：{"kind":"summary","summary":"..."}，只保留简洁摘要。';
  }

  if (operation === 'entities') {
    return '请输出 JSON：{"kind":"entities","entities":[{"name":"...","type":"organization|person|topic"}]}。';
  }

  return '请输出 JSON：{"kind":"relations","relations":[{"source":"...","relation":"...","target":"..."}]}。';
};

export class RealKnowledgeExtractionProvider implements KnowledgeExtractionProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: RealKnowledgeExtractionProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async extract(operation: ExtractionOperation, request: ExtractionRequest): Promise<ExtractionResult> {
    const response = await this.fetchImplementation(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: {
          type: 'json_object'
        },
        messages: [
          {
            role: 'system',
            content: `你是知识抽取引擎。${buildOperationInstruction(operation)}`
          },
          {
            role: 'user',
            content: JSON.stringify({
              operation,
              sourceType: request.sourceType,
              title: request.title,
              text: request.text
            })
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Real knowledge extraction provider request failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('Real knowledge extraction provider returned an empty response.');
    }

    try {
      return JSON.parse(content) as ExtractionResult;
    } catch (error) {
      throw new Error('Real knowledge extraction provider returned invalid JSON content.', {
        cause: error
      });
    }
  }
}
