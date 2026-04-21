import { EventEmitter } from 'node:events';

type InvokeAppInput = {
  method: 'GET' | 'POST';
  path: string;
  headers?: Record<string, string | undefined>;
  body?: unknown;
};

type AppLike = {
  (request: any, response: any): void;
  handle?: (request: any, response: any, callback?: (error?: unknown) => void) => void;
  request: any;
  response: any;
};

export type InvokeAppResponse = {
  statusCode: number;
  headers: Record<string, string>;
  text: string;
  json: unknown;
};

const normalizeHeaders = (headers: Record<string, string | undefined>): Record<string, string> => {
  return Object.fromEntries(
    Object.entries(headers)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, value]) => [key.toLowerCase(), value])
  );
};

const parseJson = (text: string): unknown => {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const invokeApp = async (app: AppLike, input: InvokeAppInput): Promise<InvokeAppResponse> => {
  const request = Object.assign(new EventEmitter(), {
    method: input.method,
    url: input.path,
    originalUrl: input.path,
    path: input.path,
    headers: normalizeHeaders(input.headers ?? {}),
    body: input.body,
    connection: { remoteAddress: '127.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' }
  });
  const responseHeaders = new Map<string, string>();
  let responseBody = '';
  const response = Object.assign(new EventEmitter(), {
    app,
    locals: {},
    statusCode: 200,
    headersSent: false,
    finished: false,
    req: request,
    setHeader(name: string, value: string | number | readonly string[]) {
      responseHeaders.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value));
    },
    getHeader(name: string) {
      return responseHeaders.get(name.toLowerCase());
    },
    getHeaders() {
      return Object.fromEntries(responseHeaders);
    },
    hasHeader(name: string) {
      return responseHeaders.has(name.toLowerCase());
    },
    removeHeader(name: string) {
      responseHeaders.delete(name.toLowerCase());
    },
    writeHead(statusCode: number, headers?: Record<string, string>) {
      response.statusCode = statusCode;
      response.headersSent = true;

      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          response.setHeader(key, value);
        }
      }

      return response;
    },
    write(chunk: string | Buffer) {
      responseBody += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk) {
        response.write(chunk);
      }

      response.finished = true;
      response.headersSent = true;
      response.emit('finish');
      return response;
    }
  });

  Object.setPrototypeOf(request, app.request);
  Object.setPrototypeOf(response, app.response);
  (request as any).app = app;
  (request as any).res = response;
  (response as any).req = request;

  return new Promise<InvokeAppResponse>((resolve, reject) => {
    response.once('finish', () => {
      resolve({
        statusCode: response.statusCode,
        headers: Object.fromEntries(responseHeaders),
        text: responseBody,
        json: parseJson(responseBody)
      });
    });
    response.once('error', reject);

    const handler = app.handle ? app.handle.bind(app) : app.bind(app);

    handler(request, response, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }

      if (!response.finished) {
        response.end();
      }
    });
  });
};
