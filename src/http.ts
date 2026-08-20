import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, relative, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createGzip, gzipSync } from "node:zlib";
import { createAppError } from "./errors.js";
import type { JsonValue } from "./types.js";

export const readJsonBody = async (request: IncomingMessage, maxBytes: number): Promise<JsonValue> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw createAppError(413, "BODY_TOO_LARGE", "Request body is too large.", {
        maxBytes
      });
    }
    chunks.push(buffer);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (rawBody.length === 0) {
    throw createAppError(400, "EMPTY_BODY", "Request body is required.", null);
  }

  try {
    return JSON.parse(rawBody) as JsonValue;
  } catch (error) {
    const reason = error instanceof SyntaxError ? error.message : "Unknown JSON parse error.";
    throw createAppError(400, "INVALID_JSON", "Request body must be valid JSON.", {
      reason
    });
  }
};

const gzipResponses = new WeakSet<ServerResponse>();

export const configureResponseCompression = (response: ServerResponse, acceptEncoding: string | null): void => {
  if (acceptEncoding?.toLowerCase().includes("gzip") === true) gzipResponses.add(response);
};

export const sendJson = (response: ServerResponse, statusCode: number, payload: JsonValue): void => {
  const content = Buffer.from(JSON.stringify(payload));
  const compressed = gzipResponses.has(response) && content.length >= 512 ? gzipSync(content) : null;
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(compressed === null ? {} : { "content-encoding": "gzip" })
  });
  response.end(compressed ?? content);
};

export const sendText = (response: ServerResponse, statusCode: number, payload: string): void => {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(payload);
};

export const redirect = (response: ServerResponse, location: string): void => {
  response.writeHead(302, {
    location
  });
  response.end();
};

const contentTypes = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"]
]);

const resolveStaticFilePath = (publicDir: string, requestPath: string): string => {
  const cleanPath = requestPath.replace(/^\/+/, "");
  const normalizedPath = normalize(cleanPath);
  const resolvedPath = join(publicDir, normalizedPath);
  const normalizedPublicDir = normalize(publicDir);
  const relativePath = relative(normalizedPublicDir, normalize(resolvedPath));
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw createAppError(403, "STATIC_PATH_FORBIDDEN", "Static path is outside the public directory.", {
      requestPath
    });
  }

  return resolvedPath;
};

export const sendStaticFile = async (
  response: ServerResponse,
  publicDir: string,
  requestPath: string
): Promise<void> => {
  const filePath = resolveStaticFilePath(publicDir, requestPath);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw createAppError(404, "STATIC_FILE_NOT_FOUND", "Static file was not found.", {
      requestPath
    });
  }

  const contentType = contentTypes.get(extname(filePath)) ?? "application/octet-stream";
  const compress = gzipResponses.has(response) && fileStat.size >= 512;
  const cacheControl = /^assets[\\/].+-[A-Za-z0-9_-]{6,}\.[A-Za-z0-9]+$/.test(requestPath) ? "public, max-age=31536000, immutable" : "no-store";
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": cacheControl,
    ...(compress ? { "content-encoding": "gzip" } : {})
  });
  const stream = createReadStream(filePath);
  stream.on("error", () => {
    if (!response.writableEnded) {
      response.end();
    }
  });
  if (compress) {
    stream.pipe(createGzip()).pipe(response);
    return;
  }
  stream.pipe(response);
};
