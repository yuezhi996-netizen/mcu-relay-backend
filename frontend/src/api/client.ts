import type { ApiPayload, JsonObject, ServerStatus } from "../types";

export type RequestOptions = {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly body: JsonObject | null;
  readonly headers: Readonly<Record<string, string>>;
};

type StatusListener = (status: ServerStatus) => void;

const statusListeners = new Set<StatusListener>();

const publishServerStatus = (status: ServerStatus): void => {
  statusListeners.forEach((listener) => listener(status));
};

export const subscribeServerStatus = (listener: StatusListener): (() => void) => {
  statusListeners.add(listener);
  return (): void => {
    statusListeners.delete(listener);
  };
};

const readError = (payload: unknown, fallbackCode: string, fallbackMessage: string): Error => {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const error = payload.error;
    if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
      const code = typeof error.code === "string" ? error.code : fallbackCode;
      const message = typeof error.message === "string" ? error.message : fallbackMessage;
      return new Error(`${code}: ${message}`);
    }
  }
  return new Error(`${fallbackCode}: ${fallbackMessage}`);
};

const parsePayload = <T>(payload: unknown): ApiPayload<T> => {
  if (typeof payload !== "object" || payload === null || !("ok" in payload) || payload.ok !== true || !("data" in payload)) {
    throw new Error("INVALID_RESPONSE: 服务端返回了无效 JSON。");
  }
  return payload as ApiPayload<T>;
};

export const requestJson = async <T>(url: string, options: RequestOptions): Promise<ApiPayload<T>> => {
  publishServerStatus("connecting");
  const headers = options.body === null ? options.headers : { ...options.headers, "content-type": "application/json" };
  const init: RequestInit = options.body === null
    ? { method: options.method, headers }
    : { method: options.method, headers, body: JSON.stringify(options.body) };

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error: unknown) {
    publishServerStatus("error");
    const message = error instanceof Error ? error.message : "网络请求失败。";
    throw new Error(`NETWORK_ERROR: ${message}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    publishServerStatus("error");
    throw new Error(`HTTP_${response.status}: 服务端返回了无效 JSON。`);
  }

  if (!response.ok) {
    publishServerStatus(response.status >= 500 ? "error" : "running");
    throw readError(payload, `HTTP_${response.status}`, "请求未成功。");
  }

  let parsed: ApiPayload<T>;
  try {
    parsed = parsePayload<T>(payload);
  } catch (error: unknown) {
    publishServerStatus("error");
    throw error;
  }
  publishServerStatus("running");
  return parsed;
};
