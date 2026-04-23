import type { KnowledgeExtractionProvider } from './provider.js';
import { normalizeEntities, normalizeExtractionResult, normalizeRelations } from './normalizer.js';
import type {
  EntityExtractionResult,
  ExtractionOperation,
  ExtractionRelation,
  ExtractionRequest,
  ExtractionResult
} from './types.js';

type RealKnowledgeExtractionProviderOptions = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  fetchImplementation?: typeof fetch;
};

type StructuredAnalysisResult = {
  entities?: EntityExtractionResult['entities'];
  relations?: ExtractionRelation[];
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
    return '请输出 JSON：{"kind":"entities","entities":[{"name":"...","type":"organization|person|topic"}]}。强信息文本优先返回 6-8 个关键实体；若文本信息弱，也请返回 2-4 个有限 topic，不要返回空数组。';
  }

  return '请输出 JSON：{"kind":"relations","relations":[{"source":"...","relation":"...","target":"..."}]}。强信息文本优先返回 3-10 条关键关系；若文本信息弱，也请优先返回 1-3 条弱关系（如 日期、状态、描述、提到），不要返回空数组。';
};

const buildStructuredAnalysisInstruction = () =>
  '请输出 JSON：{"entities":[{"name":"...","type":"organization|person|topic"}],"relations":[{"source":"...","relation":"...","target":"..."}]}。' +
  'source 和 target 必须引用 entities 中出现的名称。entities 最多 8 个，relations 最多 10 条；强信息文本优先抽取 6-8 个关键实体与 3-10 条关键关系。若文本信息弱，也请返回有限 topic 与弱关系，不要返回空对象。';

export class RealKnowledgeExtractionProvider implements KnowledgeExtractionProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly structuredAnalysisCache = new Map<string, Promise<StructuredAnalysisResult>>();

  constructor(options: RealKnowledgeExtractionProviderOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  private async requestJsonResult<T>(instruction: string, request: ExtractionRequest, operation?: ExtractionOperation): Promise<T> {
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
            content: `你是知识抽取引擎。${instruction}`
          },
          {
            role: 'user',
            content: JSON.stringify({
              ...(operation ? { operation } : {}),
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

    try {
      return JSON.parse(content) as T;
    } catch (error) {
      throw new Error('Real knowledge extraction provider returned invalid JSON content.', {
        cause: error
      });
    }
  }

  private async getStructuredAnalysis(request: ExtractionRequest): Promise<StructuredAnalysisResult> {
    const cacheKey = JSON.stringify({
      sourceType: request.sourceType,
      title: request.title ?? '',
      text: request.text
    });
    const cached = this.structuredAnalysisCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const pending = this.requestJsonResult<StructuredAnalysisResult>(buildStructuredAnalysisInstruction(), request).catch(
      (error) => {
        this.structuredAnalysisCache.delete(cacheKey);
        throw error;
      }
    );
    this.structuredAnalysisCache.set(cacheKey, pending);
    return pending;
  }

  async extract(operation: ExtractionOperation, request: ExtractionRequest): Promise<ExtractionResult> {
    if (operation === 'entities' || operation === 'relations') {
      const structuredAnalysis = await this.getStructuredAnalysis(request);
      const normalizedEntities = normalizeEntities(request, structuredAnalysis.entities ?? []);

      if (operation === 'entities') {
        return {
          kind: 'entities',
          entities: normalizedEntities
        };
      }

      return {
        kind: 'relations',
        relations: normalizeRelations(request, structuredAnalysis.relations ?? [], normalizedEntities)
      };
    }

    const parsedResult = await this.requestJsonResult<ExtractionResult>(
      buildOperationInstruction(operation),
      request,
      operation
    );

    return normalizeExtractionResult(operation, request, parsedResult);
  }
}
