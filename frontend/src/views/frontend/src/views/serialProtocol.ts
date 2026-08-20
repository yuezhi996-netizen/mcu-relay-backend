export type SerialDisplayMode = "text" | "hex";
export type LineEnding = "none" | "cr" | "lf" | "crlf";
export type ChecksumMode = "none" | "xor8" | "sum8" | "crc16-modbus";
export type SerialDirection = "TX" | "RX";

export type SerialLogEntry = {
  readonly key: string;
  readonly id: number;
  readonly projectId: string;
  readonly deviceId: string;
  readonly direction: SerialDirection;
  readonly data: string;
  readonly byteLength: number;
  readonly receivedAt: string;
  readonly bytes: readonly number[];
  readonly text: string;
};

export type RemoteDebugSession = {
  readonly active: boolean;
  readonly openedAt: string | null;
  readonly closedAt: string | null;
  readonly lastActivityAt: string | null;
  readonly txFrames: number;
  readonly txBytes: number;
  readonly rxFrames: number;
  readonly rxBytes: number;
  readonly retainedEntries: number;
};

export type RemoteDebugStatusPayload = {
  readonly online: boolean;
  readonly projectId: string;
  readonly deviceId: string;
  readonly session: RemoteDebugSession;
};

export type RemoteDebugLogPage = {
  readonly projectId: string;
  readonly deviceId: string;
  readonly total: number;
  readonly retainedLimit: number;
  readonly items: readonly SerialLogEntry[];
};

export type RemoteDebugWriteResponse = {
  readonly byteLength: number;
  readonly entry: SerialLogEntry;
};

export type SerialPreset = {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly sendMode: SerialDisplayMode;
  readonly lineEnding: LineEnding;
  readonly checksumMode: ChecksumMode;
};

const lineEndingValues: Readonly<Record<LineEnding, string>> = { none: "", cr: "\r", lf: "\n", crlf: "\r\n" };
export const maxRemoteDebugBytes = 16 * 1024;

const readProperty = (value: object, key: string): unknown => key in value ? Reflect.get(value, key) as unknown : undefined;
const readString = (value: object, key: string): string | null => {
  const property = readProperty(value, key);
  return typeof property === "string" ? property : null;
};
const readInteger = (value: object, key: string): number | null => {
  const property = readProperty(value, key);
  return typeof property === "number" && Number.isInteger(property) ? property : null;
};
const readNullableString = (value: object, key: string): string | null | undefined => {
  const property = readProperty(value, key);
  return property === null || typeof property === "string" ? property : undefined;
};

export const bytesToHex = (bytes: readonly number[]): string => bytes.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
export const bytesToText = (bytes: readonly number[]): string => new TextDecoder().decode(Uint8Array.from(bytes));
export const bytesToBase64 = (bytes: Uint8Array): string => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));

const base64ToBytes = (value: string): Uint8Array => {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "未知 Base64 解码错误。";
    throw new Error(`REMOTE_DEBUG_EVENT_INVALID: 服务端串口数据不是有效 Base64。${reason}`);
  }
};

export const parseHexInput = (value: string): Uint8Array => {
  const sourceTokens = value.trim().split(/[\s,]+/).filter((token) => token.length > 0);
  const tokens = sourceTokens.flatMap((sourceToken) => {
    const token = sourceToken.toLowerCase().startsWith("0x") ? sourceToken.slice(2) : sourceToken;
    if (!/^[0-9a-fA-F]+$/.test(token) || token.length % 2 !== 0) throw new Error(`HEX_FORMAT_ERROR: “${sourceToken}” 必须由完整的两位十六进制字节组成。`);
    return Array.from({ length: token.length / 2 }, (_, index) => token.slice(index * 2, index * 2 + 2));
  });
  if (tokens.length === 0) throw new Error("HEX_EMPTY: 请输入至少一个十六进制字节，例如 01 A0 FF。");
  return Uint8Array.from(tokens.map((token) => Number.parseInt(token, 16)));
};

const calculateCrc16Modbus = (bytes: Uint8Array): number => {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
};

const appendChecksum = (bytes: Uint8Array, checksumMode: ChecksumMode): Uint8Array => {
  if (checksumMode === "none") return bytes;
  if (checksumMode === "xor8") {
    const checksum = bytes.reduce((result, byte) => result ^ byte, 0);
    return Uint8Array.from([...bytes, checksum]);
  }
  if (checksumMode === "sum8") {
    const checksum = bytes.reduce((result, byte) => (result + byte) & 0xff, 0);
    return Uint8Array.from([...bytes, checksum]);
  }
  const crc = calculateCrc16Modbus(bytes);
  return Uint8Array.from([...bytes, crc & 0xff, (crc >>> 8) & 0xff]);
};

export const buildSendBytes = (value: string, mode: SerialDisplayMode, lineEnding: LineEnding, checksumMode: ChecksumMode): Uint8Array => {
  const payload = mode === "hex" ? parseHexInput(value) : new TextEncoder().encode(`${value}${lineEndingValues[lineEnding]}`);
  if (mode === "text" && value.length === 0 && lineEnding === "none") throw new Error("TEXT_EMPTY: 请输入要发送的内容，或选择 CR/LF 行尾。");
  const bytes = appendChecksum(payload, checksumMode);
  if (bytes.byteLength > maxRemoteDebugBytes) throw new Error(`REMOTE_DEBUG_DATA_TOO_LARGE: 单次最多发送 ${maxRemoteDebugBytes} 字节，当前帧为 ${bytes.byteLength} 字节。`);
  return bytes;
};

const parseSession = (payload: unknown): RemoteDebugSession => {
  if (typeof payload !== "object" || payload === null) throw new Error("REMOTE_DEBUG_STATUS_INVALID: 会话状态不是 JSON 对象。");
  const active = readProperty(payload, "active");
  const openedAt = readNullableString(payload, "openedAt");
  const closedAt = readNullableString(payload, "closedAt");
  const lastActivityAt = readNullableString(payload, "lastActivityAt");
  const txFrames = readInteger(payload, "txFrames");
  const txBytes = readInteger(payload, "txBytes");
  const rxFrames = readInteger(payload, "rxFrames");
  const rxBytes = readInteger(payload, "rxBytes");
  const retainedEntries = readInteger(payload, "retainedEntries");
  if (typeof active !== "boolean" || openedAt === undefined || closedAt === undefined || lastActivityAt === undefined || txFrames === null || txBytes === null || rxFrames === null || rxBytes === null || retainedEntries === null) {
    throw new Error("REMOTE_DEBUG_STATUS_INVALID: 会话状态字段不完整。");
  }
  return { active, openedAt, closedAt, lastActivityAt, txFrames, txBytes, rxFrames, rxBytes, retainedEntries };
};

export const parseRemoteDebugStatus = (payload: unknown): RemoteDebugStatusPayload => {
  if (typeof payload !== "object" || payload === null) throw new Error("REMOTE_DEBUG_STATUS_INVALID: 远程调试状态不是 JSON 对象。");
  const online = readProperty(payload, "online");
  const projectId = readString(payload, "projectId");
  const deviceId = readString(payload, "deviceId");
  if (typeof online !== "boolean" || projectId === null || deviceId === null) throw new Error("REMOTE_DEBUG_STATUS_INVALID: 远程调试状态字段不完整。");
  return { online, projectId, deviceId, session: parseSession(readProperty(payload, "session")) };
};

export const parseRemoteDebugLogEntry = (payload: unknown): SerialLogEntry => {
  if (typeof payload !== "object" || payload === null) throw new Error("REMOTE_DEBUG_LOG_INVALID: 串口日志不是 JSON 对象。");
  const id = readInteger(payload, "id");
  const projectId = readString(payload, "projectId");
  const deviceId = readString(payload, "deviceId");
  const direction = readString(payload, "direction");
  const encoding = readString(payload, "encoding");
  const data = readString(payload, "data");
  const byteLength = readInteger(payload, "byteLength");
  const receivedAt = readString(payload, "receivedAt");
  if (id === null || projectId === null || deviceId === null || (direction !== "TX" && direction !== "RX") || encoding !== "base64" || data === null || byteLength === null || receivedAt === null) {
    throw new Error("REMOTE_DEBUG_LOG_INVALID: 串口日志字段不完整。");
  }
  const bytes = base64ToBytes(data);
  if (bytes.byteLength !== byteLength) throw new Error(`REMOTE_DEBUG_LOG_INVALID: 声明长度 ${byteLength} 与实际长度 ${bytes.byteLength} 不一致。`);
  return { key: `${id}:${receivedAt}`, id, projectId, deviceId, direction, data, byteLength, receivedAt, bytes: Array.from(bytes), text: bytesToText(Array.from(bytes)) };
};

export const parseRemoteDebugLogPage = (payload: unknown): RemoteDebugLogPage => {
  if (typeof payload !== "object" || payload === null) throw new Error("REMOTE_DEBUG_LOG_INVALID: 串口日志响应不是 JSON 对象。");
  const projectId = readString(payload, "projectId");
  const deviceId = readString(payload, "deviceId");
  const total = readInteger(payload, "total");
  const retainedLimit = readInteger(payload, "retainedLimit");
  const items = readProperty(payload, "items");
  if (projectId === null || deviceId === null || total === null || retainedLimit === null || !Array.isArray(items)) throw new Error("REMOTE_DEBUG_LOG_INVALID: 串口日志响应字段不完整。");
  return { projectId, deviceId, total, retainedLimit, items: items.map(parseRemoteDebugLogEntry) };
};

export const parseRemoteDebugWriteResponse = (payload: unknown): RemoteDebugWriteResponse => {
  if (typeof payload !== "object" || payload === null) throw new Error("REMOTE_DEBUG_WRITE_INVALID: 发送响应不是 JSON 对象。");
  const byteLength = readInteger(payload, "byteLength");
  if (byteLength === null) throw new Error("REMOTE_DEBUG_WRITE_INVALID: 发送响应缺少字节数。");
  return { byteLength, entry: parseRemoteDebugLogEntry(readProperty(payload, "entry")) };
};

export const formatTimestamp = (value: string): string => {
  const date = new Date(value);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}.${date.getMilliseconds().toString().padStart(3, "0")}`;
};

export const formatLogEntry = (entry: SerialLogEntry, mode: SerialDisplayMode, showTimestamp: boolean): string => {
  const prefix = `${showTimestamp ? `[${formatTimestamp(entry.receivedAt)}] ` : ""}${entry.direction}  `;
  return `${prefix}${mode === "hex" ? bytesToHex(entry.bytes) : entry.text}`;
};

export const formatByteSize = (bytes: number): string => {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
};

export const formatDuration = (openedAt: string | null, currentTime: number): string => {
  if (openedAt === null) return "未开始";
  const elapsed = Math.max(0, currentTime - new Date(openedAt).getTime());
  const seconds = Math.floor(elapsed / 1_000);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
};

export const parseSerialPresets = (payload: unknown): readonly SerialPreset[] => {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const id = readString(item, "id");
    const name = readString(item, "name");
    const value = readString(item, "value");
    const sendMode = readString(item, "sendMode");
    const lineEnding = readString(item, "lineEnding");
    const checksumMode = readString(item, "checksumMode");
    if (id === null || name === null || value === null || (sendMode !== "text" && sendMode !== "hex") || !["none", "cr", "lf", "crlf"].includes(lineEnding ?? "") || !["none", "xor8", "sum8", "crc16-modbus"].includes(checksumMode ?? "")) return [];
    return [{ id, name, value, sendMode: sendMode as SerialDisplayMode, lineEnding: lineEnding as LineEnding, checksumMode: checksumMode as ChecksumMode }];
  }).slice(0, 50);
};
