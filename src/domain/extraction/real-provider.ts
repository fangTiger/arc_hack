import type { KnowledgeExtractionProvider } from './provider.js';
import { normalizeExtractionResult } from './normalizer.js';
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

const normalizeBaseUrl = (baseUrl: string): string => {
  const normalized = baseUrl.replace(/\/$/, '');

  return normalized.endsWith('/chat/completions')
    ? normalized.slice(0, -'/chat/completions'.length)
    : normalized;
};

const buildOperationInstruction = (operation: ExtractionOperation): string => {
  if (operation === 'summary') {
    return '请输出 JSON：{"kind":"summary","summary":"..."}，只保留简洁摘要。';
  }

  if (operation === 'entities') {
    return '请输出 JSON：{"kind":"entities","entities":[{"name":"...","type":"organization|person|topic"}]}。实体最多 4 个；若文本信息弱，也请返回 2-4 个有限 topic，不要返回空数组。';
  }

  return '请输出 JSON：{"kind":"relations","relations":[{"source":"...","relation":"...","target":"..."}]}。关系最多 3 条；若文本信息弱，也请优先返回 1-3 条弱关系（如 日期、状态、描述、提到），不要返回空数组。';
};

export class RealKnowledgeExtractionProvider implements KnowledgeExtractionProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: RealKnowledgeExtractionProviderOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
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
      const errorText = await response.text();
      const details = errorText.trim().slice(0, 500);

      throw new Error(
        details
          ? `Real knowledge extraction provider request failed with status ${response.status}. Upstream: ${details}`
          : `Real knowledge extraction provider request failed with status ${response.status}.`
      );
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

    let parsedResult: ExtractionResult;

    try {
      parsedResult = JSON.parse(content) as ExtractionResult;
    } catch (error) {
      throw new Error('Real knowledge extraction provider returned invalid JSON content.', {
        cause: error
      });
    }

    return normalizeExtractionResult(operation, request, parsedResult);
  }
}
