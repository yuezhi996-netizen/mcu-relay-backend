import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { createAppError } from "./errors.js";
import type { AIChatMessage, JsonObject, JsonValue } from "./types.js";

export type AIChatOptions = {
  readonly temperature?: number;
  readonly maxTokens?: number;
};

export type AIClientOptions = {
  readonly apiKey: string;
  readonly baseUrl?: string;
};

export type AIClient = {
  readonly chat: (messages: readonly AIChatMessage[], options?: AIChatOptions) => Promise<JsonObject>;
};

type AIHttpResponse = {
  readonly statusCode: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
};

const defaultBaseUrl = "https://api.deepseek.com";
const retryDelaysMs = [1_000, 2_000, 4_000] as const;

const wait = async (delayMs: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
};

const parseBaseUrl = (baseUrl: string): URL => {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw createAppError(500, "AI_SERVICE_ERROR", "AI baseUrl must use HTTP or HTTPS.", { baseUrl });
    }
    return url;
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "AI_SERVICE_ERROR") {
      throw error;
    }
    throw createAppError(500, "AI_SERVICE_ERROR", "AI baseUrl must be a valid URL.", { baseUrl });
  }
};

const sendRequest = async (url: URL, apiKey: string, body: string): Promise<AIHttpResponse> => {
  const requestImplementation = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<AIHttpResponse>((resolve, reject) => {
    const request = requestImplementation(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      }
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end(body);
  });
};

const parseResponseBody = (body: string, requestUrl: string, statusCode: number): JsonObject => {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(body) as JsonValue;
  } catch {
    throw createAppError(502, "AI_SERVICE_ERROR", "AI service returned an invalid JSON response.", {
      requestUrl,
      statusCode,
      responseBody: body
    });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw createAppError(502, "AI_SERVICE_ERROR", "AI service returned a JSON response that is not an object.", {
      requestUrl,
      statusCode,
      responseBody: parsed
    });
  }
  return parsed as JsonObject;
};

const createRequestBody = (messages: readonly AIChatMessage[], options: AIChatOptions | undefined): string => {
  const payload: JsonObject = {
    model: "deepseek-chat",
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
    ...(options?.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options?.maxTokens === undefined ? {} : { max_tokens: options.maxTokens })
  };
  return JSON.stringify(payload);
};

const isRetryableStatus = (statusCode: number): boolean => statusCode === 429 || statusCode >= 500;

export const createAIClient = (options: AIClientOptions): AIClient => {
  if (options.apiKey.trim().length === 0) {
    throw createAppError(500, "AI_SERVICE_ERROR", "AI apiKey must be a non-empty string.", null);
  }
  const baseUrl = parseBaseUrl(options.baseUrl ?? defaultBaseUrl);
  const endpoint = new URL("/v1/chat/completions", baseUrl);

  return {
    chat: async (messages: readonly AIChatMessage[], chatOptions?: AIChatOptions): Promise<JsonObject> => {
      if (messages.length === 0) {
        throw createAppError(400, "AI_SERVICE_ERROR", "AI messages must contain at least one message.", null);
      }
      const body = createRequestBody(messages, chatOptions);
      let response: AIHttpResponse | null = null;
      for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
        try {
          response = await sendRequest(endpoint, options.apiKey, body);
        } catch (error: unknown) {
          const reason = error instanceof Error ? error.message : "Unknown network failure.";
          throw createAppError(502, "AI_SERVICE_ERROR", "AI service request failed.", {
            requestUrl: endpoint.toString(),
            reason
          });
        }
        if (!isRetryableStatus(response.statusCode) || attempt === retryDelaysMs.length) break;
        await wait(retryDelaysMs[attempt] as number);
      }
      if (response === null) {
        throw createAppError(502, "AI_SERVICE_ERROR", "AI service did not return a response.", {
          requestUrl: endpoint.toString()
        });
      }
      const parsed = parseResponseBody(response.body, endpoint.toString(), response.statusCode);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw createAppError(response.statusCode === 429 ? 429 : 502, "AI_SERVICE_ERROR", "AI service returned an unsuccessful response.", {
          requestUrl: endpoint.toString(),
          statusCode: response.statusCode,
          response: parsed
        });
      }
      return parsed;
    }
  };
};
