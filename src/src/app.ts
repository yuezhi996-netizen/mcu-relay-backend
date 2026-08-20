import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { createAppError, isAppError } from "./errors.js";
import type { EventHub, ServerEvent } from "./events.js";
import { configureResponseCompression, redirect, readJsonBody, sendJson, sendStaticFile, sendText } from "./http.js";
import type { MqttBridge } from "./mqtt.js";
import { createRemoteDebugRuntime, type RemoteDebugRuntime } from "./remote-debug-runtime.js";
import { createAIClient } from "./ai.js";
import { dispatchReportForwarders } from "./forwarders.js";
import { generateOpenApiSpec } from "./openapi.js";
import { defaultDeviceHealthSettings, getDeviceHealth } from "./device-health.js";
import type { DataStore, FirmwareData } from "./store.js";
import { isJsonObject, parseAIChatRequest, parseBatchCommandInput, parseBatchReportInput, parseCommandInput, parseDeviceImportInput, parseDeviceRegistrationInput, parseDeviceRegistrationInputV2, parseDeviceReportInput, parseForwarderInput, parseProjectAccountLoginInput, parseProjectAccountRegistrationInput, parseProjectAccountReviewInput, parseProjectInput, parseProjectNameInput, parseRemoteDebugWriteInput, parseRuleInput, parseSimulateInput } from "./validation.js";
import type { AIChatMessage, BatchDeviceCommandResult, CommandDispatcher, CommandStatus, DeviceConnectionStatus, DeviceRecord, DeviceReportInput, JsonObject, JsonValue, RemoteDebugDispatcher, VerifyResult, VerifySession } from "./types.js";

type AppOptions = {
  readonly publicDir: string;
  readonly store: DataStore;
  readonly eventHub: EventHub;
  readonly commandDispatcher: CommandDispatcher;
  readonly tcpCommandDispatcher?: CommandDispatcher;
  readonly remoteDebugDispatcher?: RemoteDebugDispatcher;
  readonly mqtt?: MqttBridge;
  readonly corsOrigins: readonly string[];
  readonly adminToken?: string;
  readonly forwarderAllowedHosts?: readonly string[];
  readonly tcpGateway?: {
    readonly getStatus: () => "listening" | "stopped";
    readonly getDeviceConnectionStatus?: (projectId: string, deviceId: string) => DeviceConnectionStatus;
    readonly host: string;
    readonly port: number;
  };
};

type RateLimitEntry = {
  readonly count: number;
  readonly resetAt: number;
};

type DeviceRoute = {
  readonly projectId: string;
  readonly deviceId: string;
};

type EventTarget = {
  readonly projectId: string;
  readonly deviceId: string | null;
};

type CommandAckRoute = DeviceRoute & {
  readonly commandId: string;
};

type CommandStatusRoute = DeviceRoute & {
  readonly commandId: string;
};

type ProbeRequest = DeviceRoute & {
  readonly token: string;
};

type AgentKeyRoute = {
  readonly projectId: string;
  readonly keyId?: string;
};

type RuleRoute = {
  readonly projectId: string;
  readonly ruleId?: string;
};

type ForwarderRoute = {
  readonly projectId: string;
  readonly forwarderId?: string;
};

type FirmwareRoute = {
  readonly projectId: string;
  readonly firmwareId?: string;
};

type OTAProgressRoute = DeviceRoute & {
  readonly otaId: string;
};

type RemoteDebugRoute = DeviceRoute & {
  readonly action: "status" | "logs" | "open" | "write" | "close";
};

const maxBodyBytes = 64 * 1024;
const rateLimitWindowMs = 60_000;
const rateLimitMaxRequests = 120;

const endpointCatalog: readonly JsonObject[] = [
  { method: "GET", path: "/health", description: "服务健康状态", authentication: false },
  { method: "GET", path: "/health/live", description: "进程存活探针", authentication: false },
  { method: "GET", path: "/health/ready", description: "设备网关就绪探针", authentication: false },
  { method: "GET", path: "/api/v1/operations/metrics", description: "运行指标", authentication: "admin" },
  { method: "GET", path: "/api/openapi.json", description: "OpenAPI 3.0 规范", authentication: false },
  { method: "GET", path: "/api/sdk", description: "生成 API SDK", authentication: false },
  { method: "GET, POST", path: "/api/v1/projects", description: "项目列表与创建项目", authentication: "admin" },
  { method: "PUT", path: "/api/v1/projects/{projectId}", description: "修改项目中文名称", authentication: true },
  { method: "DELETE", path: "/api/v1/projects/{projectId}", description: "删除项目及其全部关联数据", authentication: true },
  { method: "POST", path: "/api/v1/projects/{projectId}/reset-token", description: "重置项目 Token", authentication: true },
  { method: "GET, POST", path: "/api/v1/projects/{projectId}/agent-keys", description: "代理密钥列表与创建", authentication: true },
  { method: "DELETE", path: "/api/v1/projects/{projectId}/agent-keys/{keyId}", description: "删除代理密钥", authentication: true },
  { method: "GET, POST", path: "/api/v1/projects/{projectId}/rules", description: "规则列表与创建", authentication: true },
  { method: "PUT, DELETE", path: "/api/v1/projects/{projectId}/rules/{ruleId}", description: "更新或删除规则", authentication: true },
  { method: "GET, POST", path: "/api/v1/projects/{projectId}/forwarders", description: "转发器列表与创建", authentication: true },
  { method: "PUT, DELETE", path: "/api/v1/projects/{projectId}/forwarders/{forwarderId}", description: "更新或删除转发器", authentication: true },
  { method: "GET, POST", path: "/api/v1/projects/{projectId}/firmware", description: "固件列表与添加", authentication: true },
  { method: "DELETE", path: "/api/v1/projects/{projectId}/firmware/{firmwareId}", description: "删除固件", authentication: true },
  { method: "GET", path: "/api/v1/devices", description: "设备列表", authentication: true },
  { method: "GET", path: "/api/v1/devices/status", description: "设备状态汇总", authentication: true },
  { method: "GET", path: "/api/v1/devices/status-items", description: "设备在线状态明细", authentication: true },
  { method: "GET", path: "/api/v1/dashboard", description: "最近 24 小时业务仪表盘", authentication: true },
  { method: "POST", path: "/api/v1/devices/report", description: "单设备上报", authentication: true },
  { method: "POST", path: "/api/v1/devices/batch-report", description: "批量设备上报", authentication: true },
  { method: "POST", path: "/api/v1/devices/register", description: "自动注册空设备", authentication: true },
  { method: "POST", path: "/api/v1/devices/import", description: "批量导入设备", authentication: true },
  { method: "POST", path: "/api/v1/devices/probe", description: "探测设备连通性", authentication: true },
  { method: "GET", path: "/api/v1/devices/{projectId}/{deviceId}/latest", description: "设备最新数据", authentication: true },
  { method: "GET", path: "/api/v1/events", description: "实时事件流", authentication: true },
  { method: "GET", path: "/api/v1/commands", description: "查询命令历史", authentication: true },
  { method: "POST", path: "/api/v1/commands/batch", description: "向最多 50 台设备批量下发命令", authentication: true },
  { method: "POST", path: "/api/v1/devices/{projectId}/{deviceId}/commands", description: "下发命令", authentication: true },
  { method: "GET", path: "/api/v1/devices/{projectId}/{deviceId}/commands/{commandId}", description: "查询命令生命周期状态", authentication: true },
  { method: "GET", path: "/api/v1/devices/{projectId}/{deviceId}/diagnostics", description: "查询 TCP、状态上报和未完成命令", authentication: true },
  { method: "GET", path: "/api/v1/devices/{projectId}/{deviceId}/commands/next", description: "轮询下一条命令", authentication: true },
  { method: "POST", path: "/api/v1/devices/{projectId}/{deviceId}/commands/{commandId}/ack", description: "确认命令", authentication: true },
  { method: "GET", path: "/api/v1/devices/{projectId}/{deviceId}/probe-status", description: "查询设备探测结果", authentication: true },
  { method: "POST", path: "/api/v1/devices/{projectId}/{deviceId}/verify", description: "验证设备连通性", authentication: true },
  { method: "GET", path: "/api/v1/devices/{projectId}/{deviceId}/remote-debug/status", description: "查询远程调试 TCP 连接状态", authentication: true },
  { method: "GET, DELETE", path: "/api/v1/devices/{projectId}/{deviceId}/remote-debug/logs", description: "查询或清空远程调试运行期日志", authentication: true },
  { method: "POST", path: "/api/v1/devices/{projectId}/{deviceId}/remote-debug/open", description: "开启设备远程调试", authentication: true },
  { method: "POST", path: "/api/v1/devices/{projectId}/{deviceId}/remote-debug/write", description: "向设备发送远程调试字节", authentication: true },
  { method: "POST", path: "/api/v1/devices/{projectId}/{deviceId}/remote-debug/close", description: "关闭设备远程调试", authentication: true },
  { method: "GET, PUT", path: "/api/v1/devices/{projectId}/{deviceId}/shadow", description: "设备影子", authentication: true },
  { method: "POST", path: "/api/v1/devices/{projectId}/{deviceId}/simulate", description: "模拟设备上报", authentication: true },
  { method: "GET, POST", path: "/api/v1/devices/{projectId}/{deviceId}/ota", description: "创建或查询 OTA 任务", authentication: true },
  { method: "POST", path: "/api/v1/devices/{projectId}/{deviceId}/ota/{otaId}/progress", description: "设备上报 OTA 进度", authentication: true },
  { method: "POST", path: "/api/v1/ai/chat", description: "AI 助手对话", authentication: true },
  { method: "POST", path: "/api/v1/ai/generate-template", description: "AI 生成设备模板", authentication: true },
  { method: "GET", path: "/api/v1/mqtt-status", description: "MQTT bridge 状态", authentication: false },
  { method: "GET", path: "/api/endpoints", description: "公开 API 清单", authentication: false }
];

const createSuccessPayload = (data: JsonValue): JsonObject => {
  return {
    ok: true,
    data
  };
};

const collectOperationalMetrics = async (options: AppOptions): Promise<JsonObject> => {
  const [projects, devices, commands] = await Promise.all([
    options.store.listProjects(),
    options.store.listDevices(null),
    options.store.listCommands()
  ]);
  const statusGroups = await Promise.all(projects.map((project) => options.store.listDeviceStatuses(project.projectId)));
  const memory = process.memoryUsage();
  const tcpGatewayStatus = options.tcpGateway?.getStatus() ?? "unavailable";
  return {
    generated_at: new Date().toISOString(),
    ready: tcpGatewayStatus === "listening",
    uptime_seconds: Math.floor(process.uptime()),
    process: {
      pid: process.pid,
      node_version: process.version,
      rss_bytes: memory.rss,
      heap_used_bytes: memory.heapUsed,
      heap_total_bytes: memory.heapTotal
    },
    resources: {
      projects_total: projects.length,
      devices_total: devices.length,
      devices_online: statusGroups.flat().filter((device) => device.online).length,
      commands_total: commands.length,
      commands_pending: commands.filter((command) => command.status === "queued" || command.status === "dispatched" || command.status === "acked").length,
      commands_acked: commands.filter((command) => command.status === "acked").length,
      commands_expired: commands.filter((command) => command.status === "expired" || command.status === "superseded" || command.status === "failed").length
    },
    gateways: {
      tcp: tcpGatewayStatus,
      mqtt: options.mqtt?.getStatus() ?? "disabled"
    }
  };
};

const writeServerEvent = (response: ServerResponse, eventName: string, payload: object): void => {
  response.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
};

const getEventTarget = (event: ServerEvent): EventTarget | null => {
  if (event.type === "device_report") {
    return {
      projectId: event.device.projectId,
      deviceId: event.device.deviceId
    };
  }
  if (event.type === "command_queued" || event.type === "command_dispatched" || event.type === "command_acked" || event.type === "command_state_confirmed" || event.type === "command_requeued" || event.type === "command_failed" || event.type === "command_expired" || event.type === "command_superseded") return { projectId: event.command.projectId, deviceId: event.command.deviceId };
  if (event.type === "device_verified") return { projectId: event.verify.projectId, deviceId: event.verify.deviceId };
  if (event.type === "remote_debug_data" || event.type === "remote_debug_log") return { projectId: event.projectId, deviceId: event.deviceId };
  if (event.type === "device_online" || event.type === "device_offline" || event.type === "device_health_changed" || event.type === "alarm_triggered") return { projectId: event.projectId, deviceId: event.deviceId };
  if (event.type === "rule_triggered") return { projectId: event.rule.projectId, deviceId: event.deviceId };
  if (event.type === "shadow_updated") return { projectId: event.shadow.projectId, deviceId: event.shadow.deviceId };
  if (event.type === "firmware_progress") return { projectId: event.ota.projectId, deviceId: event.ota.deviceId };
  if (event.type === "forwarder_delivery") return { projectId: event.projectId, deviceId: event.deviceId };
  if (event.type === "project_deleted") return { projectId: event.projectId, deviceId: null };
  return null;
};

const getDeviceConnectionStatus = (options: AppOptions, device: DeviceRecord): DeviceConnectionStatus => {
  if (options.tcpGateway === undefined || options.tcpGateway.getDeviceConnectionStatus === undefined) return { connected: false, connectedAt: null };
  return options.tcpGateway.getDeviceConnectionStatus(device.projectId, device.deviceId);
};

const createDeviceStatusResponse = (options: AppOptions, device: DeviceRecord): JsonObject => {
  const connection = getDeviceConnectionStatus(options, device);
  return {
    ...device,
    health: getDeviceHealth(device, connection, new Date().toISOString(), defaultDeviceHealthSettings),
    tcp: connection
  };
};

const eventMatches = (event: ServerEvent, projectId: string | null, deviceId: string | null): boolean => {
  const target = getEventTarget(event);
  if (target === null) return false;

  return (
    (projectId === null || projectId.length === 0 || target.projectId === projectId) &&
    (deviceId === null || deviceId.length === 0 || target.deviceId === null || target.deviceId === deviceId)
  );
};

const routeDevicePath = (pathname: string): DeviceRoute | null => {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.length !== 6) {
    return null;
  }

  if (
    parts[0] !== "api" ||
    parts[1] !== "v1" ||
    parts[2] !== "devices" ||
    parts[5] !== "latest"
  ) {
    return null;
  }

  return {
    projectId: decodeURIComponent(parts[3] ?? ""),
    deviceId: decodeURIComponent(parts[4] ?? "")
  };
};

const routeCommandPath = (pathname: string): DeviceRoute | null => {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.length !== 6) {
    return null;
  }

  if (
    parts[0] !== "api" ||
    parts[1] !== "v1" ||
    parts[2] !== "devices" ||
    parts[5] !== "commands"
  ) {
    return null;
  }

  return {
    projectId: decodeURIComponent(parts[3] ?? ""),
    deviceId: decodeURIComponent(parts[4] ?? "")
  };
};

const routeNextCommandPath = (pathname: string): DeviceRoute | null => {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.length !== 7) {
    return null;
  }

  if (
    parts[0] !== "api" ||
    parts[1] !== "v1" ||
    parts[2] !== "devices" ||
    parts[5] !== "commands" ||
    parts[6] !== "next"
  ) {
    return null;
  }

  return {
    projectId: decodeURIComponent(parts[3] ?? ""),
    deviceId: decodeURIComponent(parts[4] ?? "")
  };
};

const routeAckCommandPath = (pathname: string): CommandAckRoute | null => {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.length !== 8) {
    return null;
  }

  if (
    parts[0] !== "api" ||
    parts[1] !== "v1" ||
    parts[2] !== "devices" ||
    parts[5] !== "commands" ||
    parts[7] !== "ack"
  ) {
    return null;
  }

  return {
    projectId: decodeURIComponent(parts[3] ?? ""),
    deviceId: decodeURIComponent(parts[4] ?? ""),
    commandId: decodeURIComponent(parts[6] ?? "")
  };
};

const routeCommandStatusPath = (pathname: string): CommandStatusRoute | null => {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.length !== 7 || parts[0] !== "api" || parts[1] !== "v1" || parts[2] !== "devices" || parts[5] !== "commands" || parts[6] === "next") return null;
  return {
    projectId: decodeURIComponent(parts[3] ?? ""),
    deviceId: decodeURIComponent(parts[4] ?? ""),
    commandId: decodeURIComponent(parts[6] ?? "")
  };
};

const routeDeviceDiagnosticsPath = (pathname: string): DeviceRoute | null => {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.length !== 6 || parts[0] !== "api" || parts[1] !== "v1" || parts[2] !== "devices" || parts[5] !== "diagnostics") return null;
  return { projectId: decodeURIComponent(parts[3] ?? ""), deviceId: decodeURIComponent(parts[4] ?? "") };
};

const routeProbeStatusPath = (pathname: string): DeviceRoute | null => {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.length !== 6 || parts[0] !== "api" || parts[1] !== "v1" || parts[2] !== "devices" || parts[5] !== "probe-status") return null;
  return { projectId: decodeURIComponent(parts[3] ?? ""), deviceId: decodeURIComponent(parts[4] ?? "") };
};

const routeResetTokenPath = (pathname: string): string | null => {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.length !== 5 || parts[0] !== "api" || parts[1] !== "v1" || parts[2] !== "projects" || parts[4] !== "reset-token") return null;
  return decodeURIComponent(parts[3] ?? "");
};

const routeProjectPath = (pathname: string): string | null => {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.length !== 4 || parts[0] !== "api" || parts[1] !== "v1" || parts[2] !== "projects") return null;
  return decodeURIComponent(parts[3] ?? "");
};

const routeProjectResourcePath = (pathname: string, resource: string): { readonly projectId: string; readonly resourceId?: string } | null => {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.length !== 5 && parts.length !== 6) return null;
  if (parts[0] !== "api" || parts[1] !== "v1" || parts[2] !== "projects" || parts[4] !== resource) return null;
  return {
    projectId: decodeURIComponent(parts[3] ?? ""),
    ...(parts.length === 6 ? { resourceId: decodeURIComponent(parts[5] ?? "") } : {})
  };
};

const routeAgentKeysPath = (pathname: string): AgentKeyRoute | null => {
  const route = routeProjectResourcePath(pathname, "agent-keys");
  return route === null ? null : { projectId: route.projectId, ...(route.resourceId === undefined ? {} : { keyId: route.resourceId }) };
};

const routeRulesPath = (pathname: string): RuleRoute | null => {
  const route = routeProjectResourcePath(pathname, "rules");
  return route === null ? null : { projectId: route.projectId, ...(route.resourceId === undefined ? {} : { ruleId: route.resourceId }) };
};

const routeForwardersPath = (pathname: string): ForwarderRoute | null => {
  const route = routeProjectResourcePath(pathname, "forwarders");
  return route === null ? null : { projectId: route.projectId, ...(route.resourceId === undefined ? {} : { forwarderId: route.resourceId }) };
};

const routeFirmwarePath = (pathname: string): FirmwareRoute | null => {
  const route = routeProjectResourcePath(pathname, "firmware");
  return route === null ? null : { projectId: route.projectId, ...(route.resourceId === undefined ? {} : { firmwareId: route.resourceId }) };
};

const routeDeviceActionPath = (pathname: string, action: string): DeviceRoute | null => {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.length !== 6 || parts[0] !== "api" || parts[1] !== "v1" || parts[2] !== "devices" || parts[5] !== action) return null;
  return { projectId: decodeURIComponent(parts[3] ?? ""), deviceId: decodeURIComponent(parts[4] ?? "") };
};

const routeVerifyPath = (pathname: string): DeviceRoute | null => routeDeviceActionPath(pathname, "verify");

const routeRemoteDebugPath = (pathname: string): RemoteDebugRoute | null => {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.length !== 7 || parts[0] !== "api" || parts[1] !== "v1" || parts[2] !== "devices" || parts[5] !== "remote-debug") return null;
  const action = parts[6];
  if (action !== "status" && action !== "logs" && action !== "open" && action !== "write" && action !== "close") return null;
  return { projectId: decodeURIComponent(parts[3] ?? ""), deviceId: decodeURIComponent(parts[4] ?? ""), action };
};

const parseRemoteDebugLogLimit = (url: URL): number => {
  const value = url.searchParams.get("limit");
  if (value === null) return 500;
  if (!/^\d+$/.test(value)) {
    throw createAppError(400, "INVALID_REMOTE_DEBUG_LOG_LIMIT", "Remote debug log limit must be an integer between 1 and 2000.", { limit: value });
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 2_000) {
    throw createAppError(400, "INVALID_REMOTE_DEBUG_LOG_LIMIT", "Remote debug log limit must be an integer between 1 and 2000.", { limit });
  }
  return limit;
};

const routeShadowPath = (pathname: string): DeviceRoute | null => routeDeviceActionPath(pathname, "shadow");

const routeSimulatePath = (pathname: string): DeviceRoute | null => routeDeviceActionPath(pathname, "simulate");

const routeOTAPath = (pathname: string): DeviceRoute | null => routeDeviceActionPath(pathname, "ota");

const routeOTAProgressPath = (pathname: string): OTAProgressRoute | null => {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  if (parts.length !== 8 || parts[0] !== "api" || parts[1] !== "v1" || parts[2] !== "devices" || parts[5] !== "ota" || parts[7] !== "progress") return null;
  return {
    projectId: decodeURIComponent(parts[3] ?? ""),
    deviceId: decodeURIComponent(parts[4] ?? ""),
    otaId: decodeURIComponent(parts[6] ?? "")
  };
};

const parseProbeRequest = (value: JsonValue): ProbeRequest => {
  if (!isJsonObject(value)) throw createAppError(400, "INVALID_PROBE_REQUEST", "Probe request must be a JSON object.", null);
  const projectId = value.projectId;
  const token = value.token;
  const deviceId = value.deviceId;
  if (typeof projectId !== "string" || projectId.trim().length === 0 || typeof token !== "string" || token.trim().length === 0 || typeof deviceId !== "string" || deviceId.trim().length === 0) {
    throw createAppError(400, "INVALID_PROBE_REQUEST", "Probe request requires non-empty projectId, token, and deviceId.", null);
  }
  return { projectId: projectId.trim(), token: token.trim(), deviceId: deviceId.trim() };
};

const requireJsonObject = (value: JsonValue, code: string, message: string): JsonObject => {
  if (!isJsonObject(value)) throw createAppError(400, code, message, null);
  return value;
};

const readRequiredStringField = (value: JsonObject, field: string): string => {
  const fieldValue = value[field];
  if (typeof fieldValue !== "string" || fieldValue.trim().length === 0) {
    throw createAppError(400, "INVALID_FIELD", `${field} must be a non-empty string.`, { field });
  }
  return fieldValue.trim();
};

const readRequiredFiniteNumberField = (value: JsonObject, field: string): number => {
  const fieldValue = value[field];
  if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
    throw createAppError(400, "INVALID_FIELD", `${field} must be a finite number.`, { field });
  }
  return fieldValue;
};

const parseAgentKeyLabel = (value: JsonValue): string => readRequiredStringField(requireJsonObject(value, "INVALID_BODY", "Request body must be a JSON object."), "label");

const parseFirmwareData = (value: JsonValue): FirmwareData => {
  const body = requireJsonObject(value, "INVALID_BODY", "Request body must be a JSON object.");
  const fileSize = readRequiredFiniteNumberField(body, "fileSize");
  if (!Number.isInteger(fileSize) || fileSize < 0) {
    throw createAppError(400, "INVALID_FIRMWARE_SIZE", "fileSize must be a non-negative integer.", { fileSize });
  }
  const downloadUrl = readRequiredStringField(body, "downloadUrl");
  let parsedDownloadUrl: URL;
  try {
    parsedDownloadUrl = new URL(downloadUrl);
  } catch {
    throw createAppError(400, "INVALID_FIRMWARE_URL", "downloadUrl must be a valid HTTP or HTTPS URL.", { downloadUrl });
  }
  if ((parsedDownloadUrl.protocol !== "http:" && parsedDownloadUrl.protocol !== "https:") || parsedDownloadUrl.username.length > 0 || parsedDownloadUrl.password.length > 0) {
    throw createAppError(400, "INVALID_FIRMWARE_URL", "downloadUrl must use HTTP or HTTPS and must not contain embedded credentials.", { downloadUrl });
  }
  return {
    fileName: readRequiredStringField(body, "fileName"),
    fileSize,
    md5: readRequiredStringField(body, "md5"),
    version: readRequiredStringField(body, "version"),
    downloadUrl: parsedDownloadUrl.toString()
  };
};

const parseVerifyTimeoutMs = (value: JsonValue): number => {
  const body = requireJsonObject(value, "INVALID_BODY", "Request body must be a JSON object.");
  const timeoutMs = body.timeoutMs;
  if (timeoutMs === undefined) return 30_000;
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw createAppError(400, "INVALID_VERIFY_TIMEOUT", "timeoutMs must be a positive integer.", { timeoutMs });
  }
  return timeoutMs;
};

const parseShadowDesired = (value: JsonValue): JsonObject => {
  const body = requireJsonObject(value, "INVALID_BODY", "Request body must be a JSON object.");
  const desired = body.desired;
  if (desired === undefined || !isJsonObject(desired)) {
    throw createAppError(400, "INVALID_SHADOW_DESIRED", "desired must be a JSON object.", null);
  }
  return desired;
};

const parseOtaFirmwareId = (value: JsonValue): string => readRequiredStringField(requireJsonObject(value, "INVALID_BODY", "Request body must be a JSON object."), "firmwareId");

const parseOtaProgress = (value: JsonValue): { readonly status: "downloading" | "installing" | "success" | "failed"; readonly progress: number } => {
  const body = requireJsonObject(value, "INVALID_BODY", "Request body must be a JSON object.");
  const status = readRequiredStringField(body, "status");
  const progress = readRequiredFiniteNumberField(body, "progress");
  if (status !== "downloading" && status !== "installing" && status !== "success" && status !== "failed") {
    throw createAppError(400, "INVALID_OTA_STATUS", "status must be downloading, installing, success, or failed.", { status });
  }
  if (!Number.isInteger(progress) || progress < 0 || progress > 100 || (status === "success" && progress !== 100)) {
    throw createAppError(400, "INVALID_OTA_PROGRESS", "progress must be an integer from 0 to 100, and success requires 100.", { status, progress });
  }
  return { status, progress };
};

const parseCommandHistoryQuery = (url: URL): {
  readonly projectId: string;
  readonly deviceId: string | null;
  readonly status: CommandStatus | null;
  readonly limit: number;
} => {
  const projectId = requireProjectId(url.searchParams.get("projectId"));
  const deviceIdParameter = url.searchParams.get("deviceId");
  const deviceId = deviceIdParameter === null || deviceIdParameter.trim().length === 0 ? null : deviceIdParameter.trim();
  const statusParameter = url.searchParams.get("status");
  if (statusParameter !== null && statusParameter !== "pending" && statusParameter !== "queued" && statusParameter !== "dispatched" && statusParameter !== "acked" && statusParameter !== "state_confirmed" && statusParameter !== "failed" && statusParameter !== "expired" && statusParameter !== "superseded") {
    throw createAppError(400, "INVALID_COMMAND_STATUS", "status must be queued, dispatched, acked, state_confirmed, failed, expired, or superseded.", { status: statusParameter });
  }
  const limitParameter = url.searchParams.get("limit");
  const limit = limitParameter === null ? 100 : Number(limitParameter);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw createAppError(400, "INVALID_COMMAND_LIMIT", "limit must be an integer between 1 and 200.", { limit: limitParameter });
  }
  return { projectId, deviceId, status: statusParameter === "pending" ? "queued" : statusParameter, limit };
};

const assertOtaTransition = (currentStatus: "pending" | "downloading" | "installing" | "success" | "failed", nextStatus: "downloading" | "installing" | "success" | "failed"): void => {
  const allowed: Readonly<Record<typeof currentStatus, readonly string[]>> = {
    pending: ["downloading", "failed"],
    downloading: ["downloading", "installing", "failed"],
    installing: ["installing", "success", "failed"],
    success: [],
    failed: []
  };
  if (!allowed[currentStatus].includes(nextStatus)) {
    throw createAppError(409, "INVALID_OTA_TRANSITION", "OTA status transition is not allowed.", { currentStatus, nextStatus });
  }
};

const parseTemplateGenerationRequest = (value: JsonValue): { readonly projectId: string; readonly token: string; readonly description: string } => {
  const body = requireJsonObject(value, "INVALID_BODY", "Request body must be a JSON object.");
  return {
    projectId: readRequiredStringField(body, "projectId"),
    token: readRequiredStringField(body, "token"),
    description: readRequiredStringField(body, "description")
  };
};

const waitForVerifyResult = async (store: DataStore, session: VerifySession, timeoutMs: number): Promise<VerifyResult> => {
  const deadline = Date.now() + timeoutMs;
  let current = session;
  while (current.result === null && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
    current = await store.checkVerify(session.projectId, session.deviceId, session.id);
  }
  return current.result ?? { online: false, firstSeenAt: null, dataComplete: false, missingTemplate: [] };
};

const dispatchDeviceForwarders = (options: AppOptions, device: Awaited<ReturnType<DataStore["saveReport"]>>): void => {
  const publishMqtt = options.mqtt === undefined ? null : options.mqtt.publishForwardedReport;
  void dispatchReportForwarders(options.store, options.eventHub, device, options.forwarderAllowedHosts ?? [], publishMqtt).catch((error: unknown) => {
    console.error("forwarder_dispatch_failed", {
      projectId: device.projectId,
      deviceId: device.deviceId,
      reason: error instanceof Error ? error.message : "Unknown forwarder failure."
    });
  });
};

const createAgentKeySummary = (key: Awaited<ReturnType<DataStore["createAgentKey"]>>): JsonObject => ({
  id: key.id,
  projectId: key.projectId,
  label: key.label,
  createdAt: key.createdAt,
  lastUsedAt: key.lastUsedAt,
  keyPreview: `****${key.key.slice(-4)}`
});

const reportValuesAsJson = (report: DeviceReportInput): JsonObject => {
  return Object.fromEntries(report.values.map((value) => [value.key, value.value]));
};

const dispatchTriggeredRules = async (options: AppOptions, projectId: string, deviceId: string, report: DeviceReportInput): Promise<void> => {
  const triggeredRules = await options.store.evaluateRules(projectId, deviceId, report);
  const triggeredValues = reportValuesAsJson(report);
  for (const triggeredRule of triggeredRules) {
    options.eventHub.publish({ type: "rule_triggered", rule: triggeredRule.rule, deviceId, triggeredValues });
    for (const action of triggeredRule.actions) {
      const queued = await options.store.enqueueCommandWithResult(projectId, action.deviceId, action.command);
      for (const command of queued.superseded) options.eventHub.publish({ type: "command_superseded", command });
      options.eventHub.publish({ type: "command_queued", command: queued.command });
      options.commandDispatcher.dispatchCommand(queued.command);
    }
  }
};

const readAiResponseContent = (response: JsonObject): string => {
  const choices = response.choices;
  const choice = Array.isArray(choices) ? choices[0] : undefined;
  if (choice === undefined || !isJsonObject(choice)) {
    throw createAppError(502, "AI_SERVICE_ERROR", "AI service response does not contain a chat message.", { response });
  }
  const message = choice.message;
  if (message === undefined || !isJsonObject(message) || typeof message.content !== "string") {
    throw createAppError(502, "AI_SERVICE_ERROR", "AI service response does not contain a chat message.", { response });
  }
  return message.content;
};

const createConfiguredAIClient = () => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw createAppError(503, "AI_SERVICE_NOT_CONFIGURED", "AI service is not configured. Set DEEPSEEK_API_KEY before using AI endpoints.", null);
  }
  return createAIClient({
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com"
  });
};

type SdkMethodSpec = {
  readonly name: string;
  readonly method: string;
  readonly path: string;
};

const sdkMethodSpecs: readonly SdkMethodSpec[] = [
  { name: "getHealth", method: "GET", path: "/health" },
  { name: "getLiveness", method: "GET", path: "/health/live" },
  { name: "getReadiness", method: "GET", path: "/health/ready" },
  { name: "getOperationalMetrics", method: "GET", path: "/api/v1/operations/metrics" },
  { name: "getOpenApi", method: "GET", path: "/api/openapi.json" },
  { name: "getSdk", method: "GET", path: "/api/sdk" },
  { name: "getEndpoints", method: "GET", path: "/api/endpoints" },
  { name: "getMqttStatus", method: "GET", path: "/api/v1/mqtt-status" },
  { name: "listProjects", method: "GET", path: "/api/v1/projects" },
  { name: "createProject", method: "POST", path: "/api/v1/projects" },
  { name: "updateProjectName", method: "PUT", path: "/api/v1/projects/{projectId}" },
  { name: "deleteProject", method: "DELETE", path: "/api/v1/projects/{projectId}" },
  { name: "resetProjectToken", method: "POST", path: "/api/v1/projects/{projectId}/reset-token" },
  { name: "listAgentKeys", method: "GET", path: "/api/v1/projects/{projectId}/agent-keys" },
  { name: "createAgentKey", method: "POST", path: "/api/v1/projects/{projectId}/agent-keys" },
  { name: "deleteAgentKey", method: "DELETE", path: "/api/v1/projects/{projectId}/agent-keys/{keyId}" },
  { name: "listRules", method: "GET", path: "/api/v1/projects/{projectId}/rules" },
  { name: "createRule", method: "POST", path: "/api/v1/projects/{projectId}/rules" },
  { name: "updateRule", method: "PUT", path: "/api/v1/projects/{projectId}/rules/{ruleId}" },
  { name: "deleteRule", method: "DELETE", path: "/api/v1/projects/{projectId}/rules/{ruleId}" },
  { name: "listForwarders", method: "GET", path: "/api/v1/projects/{projectId}/forwarders" },
  { name: "createForwarder", method: "POST", path: "/api/v1/projects/{projectId}/forwarders" },
  { name: "updateForwarder", method: "PUT", path: "/api/v1/projects/{projectId}/forwarders/{forwarderId}" },
  { name: "deleteForwarder", method: "DELETE", path: "/api/v1/projects/{projectId}/forwarders/{forwarderId}" },
  { name: "listFirmware", method: "GET", path: "/api/v1/projects/{projectId}/firmware" },
  { name: "addFirmware", method: "POST", path: "/api/v1/projects/{projectId}/firmware" },
  { name: "deleteFirmware", method: "DELETE", path: "/api/v1/projects/{projectId}/firmware/{firmwareId}" },
  { name: "listDevices", method: "GET", path: "/api/v1/devices" },
  { name: "getDeviceStatus", method: "GET", path: "/api/v1/devices/status" },
  { name: "getDashboard", method: "GET", path: "/api/v1/dashboard" },
  { name: "sendBatchCommand", method: "POST", path: "/api/v1/commands/batch" },
  { name: "reportDevice", method: "POST", path: "/api/v1/devices/report" },
  { name: "batchReportDevices", method: "POST", path: "/api/v1/devices/batch-report" },
  { name: "registerDevice", method: "POST", path: "/api/v1/devices/register" },
  { name: "importDevices", method: "POST", path: "/api/v1/devices/import" },
  { name: "probeDevice", method: "POST", path: "/api/v1/devices/probe" },
  { name: "getLatestDevice", method: "GET", path: "/api/v1/devices/{projectId}/{deviceId}/latest" },
  { name: "queueCommand", method: "POST", path: "/api/v1/devices/{projectId}/{deviceId}/commands" },
  { name: "getNextCommand", method: "GET", path: "/api/v1/devices/{projectId}/{deviceId}/commands/next" },
  { name: "acknowledgeCommand", method: "POST", path: "/api/v1/devices/{projectId}/{deviceId}/commands/{commandId}/ack" },
  { name: "getProbeStatus", method: "GET", path: "/api/v1/devices/{projectId}/{deviceId}/probe-status" },
  { name: "openEvents", method: "GET", path: "/api/v1/events" },
  { name: "verifyDevice", method: "POST", path: "/api/v1/devices/{projectId}/{deviceId}/verify" },
  { name: "getRemoteDebugStatus", method: "GET", path: "/api/v1/devices/{projectId}/{deviceId}/remote-debug/status" },
  { name: "listRemoteDebugLogs", method: "GET", path: "/api/v1/devices/{projectId}/{deviceId}/remote-debug/logs" },
  { name: "clearRemoteDebugLogs", method: "DELETE", path: "/api/v1/devices/{projectId}/{deviceId}/remote-debug/logs" },
  { name: "openRemoteDebug", method: "POST", path: "/api/v1/devices/{projectId}/{deviceId}/remote-debug/open" },
  { name: "writeRemoteDebug", method: "POST", path: "/api/v1/devices/{projectId}/{deviceId}/remote-debug/write" },
  { name: "closeRemoteDebug", method: "POST", path: "/api/v1/devices/{projectId}/{deviceId}/remote-debug/close" },
  { name: "getShadow", method: "GET", path: "/api/v1/devices/{projectId}/{deviceId}/shadow" },
  { name: "updateShadow", method: "PUT", path: "/api/v1/devices/{projectId}/{deviceId}/shadow" },
  { name: "simulateDevice", method: "POST", path: "/api/v1/devices/{projectId}/{deviceId}/simulate" },
  { name: "createOtaTask", method: "POST", path: "/api/v1/devices/{projectId}/{deviceId}/ota" },
  { name: "getOtaTask", method: "GET", path: "/api/v1/devices/{projectId}/{deviceId}/ota" },
  { name: "updateOtaProgress", method: "POST", path: "/api/v1/devices/{projectId}/{deviceId}/ota/{otaId}/progress" },
  { name: "aiChat", method: "POST", path: "/api/v1/ai/chat" },
  { name: "generateDeviceTemplate", method: "POST", path: "/api/v1/ai/generate-template" }
];

const createJavaScriptSdk = (): string => {
  const methods = sdkMethodSpecs.map((specification) => `  async ${specification.name}(pathParameters, queryParameters, body, token) { return this.request("${specification.method}", "${specification.path}", pathParameters, queryParameters, body, token); }`).join("\n");
  return `export class McuRelaySdk {
  constructor(baseUrl) { this.baseUrl = baseUrl.replace(/\\/$/, ""); }
  async request(method, pathTemplate, pathParameters, queryParameters, body, token) {
    const path = pathTemplate.replace(/\\{([^}]+)\\}/g, (_, key) => encodeURIComponent(pathParameters[key]));
    const query = new URLSearchParams(queryParameters).toString();
    const response = await fetch(this.baseUrl + path + (query.length === 0 ? "" : "?" + query), { method, headers: { "content-type": "application/json", ...(token === null ? {} : { "x-project-token": token }) }, ...(body === null ? {} : { body: JSON.stringify(body) }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message ?? "API request failed.");
    return payload.data;
  }
${methods}
}`;
};

const createPythonSdk = (): string => {
  const methods = sdkMethodSpecs.map((specification) => `    def ${specification.name}(self, path_parameters, query_parameters, body, token):\n        return self.request("${specification.method}", "${specification.path}", path_parameters, query_parameters, body, token)`).join("\n\n");
  return `import json
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

class McuRelaySdk:
    def __init__(self, base_url):
        self.base_url = base_url.rstrip("/")

    def request(self, method, path_template, path_parameters, query_parameters, body, token):
        path = path_template.format(**path_parameters)
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["x-project-token"] = token
        data = None if body is None else json.dumps(body).encode("utf-8")
        query = urlencode(query_parameters)
        request = Request(self.base_url + path + ("" if not query else "?" + query), data=data, headers=headers, method=method)
        try:
            with urlopen(request) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            payload = json.loads(error.read().decode("utf-8"))
            raise RuntimeError(payload["error"]["message"]) from error
        return payload["data"]

${methods}
`;
};

const createCSdk = (): string => `#ifndef MCU_RELAY_SDK_H
#define MCU_RELAY_SDK_H

#define MCU_RELAY_JSON_CONTENT_TYPE "Content-Type: application/json"
#define MCU_RELAY_PROJECT_TOKEN_HEADER(token) "x-project-token: " token
#define MCU_RELAY_REQUEST(method, path, body, token, send) send(method, path, MCU_RELAY_JSON_CONTENT_TYPE, MCU_RELAY_PROJECT_TOKEN_HEADER(token), body)
#define MCU_RELAY_GET(path, token, send) MCU_RELAY_REQUEST("GET", path, 0, token, send)
#define MCU_RELAY_POST(path, body, token, send) MCU_RELAY_REQUEST("POST", path, body, token, send)
#define MCU_RELAY_PUT(path, body, token, send) MCU_RELAY_REQUEST("PUT", path, body, token, send)
#define MCU_RELAY_DELETE(path, token, send) MCU_RELAY_REQUEST("DELETE", path, 0, token, send)

#endif
`;

const requireMethod = (actualMethod: string | undefined, expectedMethod: string): void => {
  if (actualMethod !== expectedMethod) {
    throw createAppError(405, "METHOD_NOT_ALLOWED", `Expected ${expectedMethod}.`, {
      actualMethod: actualMethod ?? "UNKNOWN",
      expectedMethod
    });
  }
};

const readHeaderValue = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
};

const readClientIp = (request: IncomingMessage): string => {
  return request.socket.remoteAddress ?? "unknown";
};

const tokensMatch = (actual: string, expected: string): boolean => {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
};

const isLoopbackAddress = (address: string | undefined): boolean => {
  if (address === undefined) return false;
  return address === "127.0.0.1" || address === "::1" || address.startsWith("::ffff:127.");
};

const verifyAdminAccess = (request: IncomingMessage, configuredToken: string | undefined): void => {
  const expected = configuredToken?.trim();
  if (expected === undefined || expected.length === 0) {
    if (isLoopbackAddress(request.socket.remoteAddress)) return;
    throw createAppError(403, "ADMIN_LOCAL_ONLY", "Project administration is restricted to the local machine unless ADMIN_TOKEN is configured.", null);
  }
  const actual = readHeaderValue(request.headers["x-admin-token"])?.trim();
  if (actual === undefined || actual.length === 0) {
    throw createAppError(401, "ADMIN_TOKEN_REQUIRED", "Admin token is required.", null);
  }
  if (!tokensMatch(actual, expected)) {
    throw createAppError(401, "INVALID_ADMIN_TOKEN", "Admin token is invalid.", null);
  }
};

const configureSecurityHeaders = (response: ServerResponse): void => {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
};

const configureCors = (request: IncomingMessage, response: ServerResponse, url: URL, origins: readonly string[]): void => {
  if (!url.pathname.startsWith("/api/")) return;
  const origin = readHeaderValue(request.headers.origin);
  if (origin === null || !origins.includes(origin)) return;
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type,authorization,x-project-token,x-agent-key,x-admin-token");
  response.setHeader("vary", "Origin");
};

const readProjectToken = (request: IncomingMessage, url: URL, body: JsonValue | null): string => {
  const headerToken = readHeaderValue(request.headers["x-project-token"]);
  const queryToken = url.searchParams.get("token");
  const bodyToken = isJsonObject(body) && typeof body.token === "string" ? body.token : null;
  const token = headerToken ?? queryToken ?? bodyToken;
  if (token === null || token.trim().length === 0) {
    throw createAppError(401, "PROJECT_TOKEN_REQUIRED", "Project token is required.", null);
  }

  return token.trim();
};

const readProjectUserSessionToken = (request: IncomingMessage, url: URL): string | null => {
  const authorization = readHeaderValue(request.headers.authorization)?.trim();
  if (authorization !== undefined && authorization.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (token.length > 0) return token;
  }
  const queryToken = url.searchParams.get("session")?.trim();
  return queryToken === undefined || queryToken.length === 0 ? null : queryToken;
};

const requireProjectId = (projectId: string | null): string => {
  if (projectId === null || projectId.trim().length === 0) {
    throw createAppError(400, "PROJECT_ID_REQUIRED", "projectId is required.", null);
  }

  return projectId.trim();
};

const verifyProjectAccess = async (
  store: DataStore,
  request: IncomingMessage,
  url: URL,
  projectId: string,
  body: JsonValue | null
): Promise<void> => {
  const sessionToken = readProjectUserSessionToken(request, url);
  if (sessionToken !== null) {
    await store.verifyProjectUserSession(sessionToken, projectId);
    return;
  }
  const agentKey = readHeaderValue(request.headers["x-agent-key"])?.trim();
  if (agentKey !== undefined && agentKey.length > 0) {
    await store.verifyAgentKey(projectId, agentKey);
    return;
  }
  const token = readProjectToken(request, url, body);
  await store.verifyProjectToken(projectId, token);
};

const verifyProjectManagerAccess = async (
  store: DataStore,
  request: IncomingMessage,
  url: URL,
  projectId: string,
  body: JsonValue | null
): Promise<void> => {
  if (readProjectUserSessionToken(request, url) !== null) {
    throw createAppError(403, "PROJECT_MANAGER_REQUIRED", "Project users cannot change project settings or credentials.", { projectId });
  }
  await verifyProjectAccess(store, request, url, projectId, body);
};

const handleEventStream = async (
  request: IncomingMessage,
  response: ServerResponse,
  store: DataStore,
  eventHub: EventHub,
  url: URL
): Promise<void> => {
  requireMethod(request.method, "GET");

  const projectId = requireProjectId(url.searchParams.get("projectId"));
  const deviceId = url.searchParams.get("deviceId");
  await verifyProjectAccess(store, request, url, projectId, null);

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });

  response.write(":init\n\n");
  let lastEventAt = Date.now();
  writeServerEvent(response, "connected", {
    ok: true,
    projectId,
    deviceId
  });

  const unsubscribe = eventHub.subscribe((event) => {
    if (eventMatches(event, projectId, deviceId)) {
      writeServerEvent(response, event.type, event);
      lastEventAt = Date.now();
    }
  });

  const heartbeat = setInterval(() => {
    if (!response.writableEnded && Date.now() - lastEventAt >= 5_000) response.write(": heartbeat\n\n");
  }, 5_000);

  request.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
};

const handleApi = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: AppOptions,
  remoteDebugRuntime: RemoteDebugRuntime,
  url: URL
): Promise<void> => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {
      ok: true
    });
    return;
  }

  if (url.pathname === "/health") {
    requireMethod(request.method, "GET");
    const [projects, devices, commands] = await Promise.all([options.store.listProjects(), options.store.listDevices(null), options.store.listCommands()]);
    const tcpGatewayStatus = options.tcpGateway?.getStatus() ?? "unavailable";
    sendJson(response, 200, createSuccessPayload({
      status: "ok",
      uptime: Math.floor(process.uptime()),
      projects: projects.length,
      devices: devices.length,
      commands_pending: commands.filter((command) => command.status === "queued" || command.status === "dispatched" || command.status === "acked").length,
      tcp_gateway: tcpGatewayStatus,
      tcp_gateway_host: options.tcpGateway?.host ?? null,
      tcp_gateway_port: options.tcpGateway?.port ?? null,
      mqtt: options.mqtt?.getStatus() ?? "disabled"
    }));
    return;
  }

  if (url.pathname === "/health/live") {
    requireMethod(request.method, "GET");
    sendJson(response, 200, createSuccessPayload({ status: "alive", uptime_seconds: Math.floor(process.uptime()) }));
    return;
  }

  if (url.pathname === "/health/ready") {
    requireMethod(request.method, "GET");
    const tcpGatewayStatus = options.tcpGateway?.getStatus() ?? "unavailable";
    const mqttStatus = options.mqtt?.getStatus() ?? "disabled";
    const ready = tcpGatewayStatus === "listening";
    sendJson(response, ready ? 200 : 503, createSuccessPayload({
      status: ready ? "ready" : "not_ready",
      tcp_gateway: tcpGatewayStatus,
      mqtt: mqttStatus
    }));
    return;
  }

  if (url.pathname === "/api/openapi.json") {
    requireMethod(request.method, "GET");
    const forwardedProtocol = readHeaderValue(request.headers["x-forwarded-proto"]);
    const protocol = forwardedProtocol === null || forwardedProtocol.trim().length === 0 ? url.protocol.slice(0, -1) : forwardedProtocol.split(",")[0]?.trim() ?? "http";
    sendJson(response, 200, generateOpenApiSpec({ baseUrl: `${protocol}://${request.headers.host ?? "127.0.0.1"}`, version: "0.1.0" }));
    return;
  }

  if (url.pathname === "/api/sdk") {
    requireMethod(request.method, "GET");
    const language = url.searchParams.get("lang") ?? "javascript";
    if (language === "javascript") {
      sendText(response, 200, createJavaScriptSdk());
      return;
    }
    if (language === "python") {
      sendText(response, 200, createPythonSdk());
      return;
    }
    if (language === "c") {
      sendText(response, 200, createCSdk());
      return;
    }
    throw createAppError(400, "INVALID_SDK_LANGUAGE", "lang must be python, javascript, or c.", { language });
  }

  if (url.pathname === "/api/endpoints") {
    requireMethod(request.method, "GET");
    sendJson(response, 200, createSuccessPayload(endpointCatalog));
    return;
  }

  if (url.pathname === "/api/v1/auth/register") {
    requireMethod(request.method, "POST");
    const account = await options.store.registerProjectAccount(parseProjectAccountRegistrationInput(await readJsonBody(request, maxBodyBytes)));
    sendJson(response, 201, createSuccessPayload({ id: account.id, username: account.username, status: account.status }));
    return;
  }

  if (url.pathname === "/api/v1/auth/login") {
    requireMethod(request.method, "POST");
    const input = parseProjectAccountLoginInput(await readJsonBody(request, maxBodyBytes));
    sendJson(response, 200, createSuccessPayload(await options.store.loginProjectAccount(input.username, input.password)));
    return;
  }

  if (url.pathname === "/api/v1/auth/me") {
    requireMethod(request.method, "GET");
    const sessionToken = readProjectUserSessionToken(request, url);
    if (sessionToken === null) throw createAppError(401, "USER_SESSION_REQUIRED", "Project user session is required.", null);
    sendJson(response, 200, createSuccessPayload(await options.store.getProjectUserSession(sessionToken)));
    return;
  }

  if (url.pathname === "/api/v1/admin/accounts") {
    requireMethod(request.method, "GET");
    verifyAdminAccess(request, options.adminToken);
    sendJson(response, 200, createSuccessPayload(await options.store.listProjectAccounts()));
    return;
  }

  const accountReviewMatch = /^\/api\/v1\/admin\/accounts\/([^/]+)\/review$/.exec(url.pathname);
  if (accountReviewMatch !== null) {
    requireMethod(request.method, "POST");
    verifyAdminAccess(request, options.adminToken);
    const accountId = decodeURIComponent(accountReviewMatch[1] ?? "");
    const account = await options.store.reviewProjectAccount(accountId, parseProjectAccountReviewInput(await readJsonBody(request, maxBodyBytes)));
    if (options.mqtt !== undefined) await options.mqtt.refreshSubscriptions();
    sendJson(response, 200, createSuccessPayload(account));
    return;
  }

  if (url.pathname === "/api/v1/operations/metrics") {
    requireMethod(request.method, "GET");
    verifyAdminAccess(request, options.adminToken);
    sendJson(response, 200, createSuccessPayload(await collectOperationalMetrics(options)));
    return;
  }

  if (url.pathname === "/api/v1/mqtt-status") {
    requireMethod(request.method, "GET");
    if (options.mqtt === undefined) {
      sendJson(response, 200, createSuccessPayload({ status: "stopped", broker: "", port: 0, clientId: "", tls: false }));
      return;
    }
    sendJson(response, 200, createSuccessPayload(options.mqtt.getStatusInfo()));
    return;
  }

  if (url.pathname === "/api/v1/projects") {
    if (request.method === "GET") {
      const sessionToken = readProjectUserSessionToken(request, url);
      if (sessionToken !== null) {
        const user = await options.store.getProjectUserSession(sessionToken);
        const project = (await options.store.listProjects()).find((candidate) => candidate.projectId === user.projectId);
        if (project === undefined) throw createAppError(404, "PROJECT_NOT_FOUND", "The project bound to this account was not found.", { projectId: user.projectId });
        sendJson(response, 200, createSuccessPayload([{ projectId: project.projectId, name: project.name, createdAt: project.createdAt, updatedAt: project.updatedAt }]));
        return;
      }
      verifyAdminAccess(request, options.adminToken);
      const [projects, accounts] = await Promise.all([options.store.listProjects(), options.store.listProjectAccounts()]);
      sendJson(response, 200, createSuccessPayload(projects.map((project) => ({ ...project, account: accounts.find((account) => account.projectId === project.projectId) ?? null }))));
      return;
    }

    requireMethod(request.method, "POST");
    verifyAdminAccess(request, options.adminToken);
    const body = await readJsonBody(request, maxBodyBytes);
    const input = parseProjectInput(body);
    const project = await options.store.createProject(input);
    if (options.mqtt !== undefined) await options.mqtt.refreshSubscriptions();
    sendJson(response, 201, createSuccessPayload(project));
    return;
  }

  const projectId = routeProjectPath(url.pathname);
  if (projectId !== null) {
    if (request.method === "PUT") {
      await verifyProjectManagerAccess(options.store, request, url, projectId, null);
      const input = parseProjectNameInput(await readJsonBody(request, maxBodyBytes));
      sendJson(response, 200, createSuccessPayload(await options.store.updateProjectName(projectId, input)));
      return;
    }
    requireMethod(request.method, "DELETE");
    await verifyProjectManagerAccess(options.store, request, url, projectId, null);
    await options.store.deleteProject(projectId);
    if (options.mqtt !== undefined) await options.mqtt.refreshSubscriptions();
    options.eventHub.publish({ type: "project_deleted", projectId });
    sendJson(response, 200, createSuccessPayload({ deleted: true, projectId }));
    return;
  }

  if (url.pathname === "/api/v1/ai/chat") {
    requireMethod(request.method, "POST");
    const body = await readJsonBody(request, maxBodyBytes);
    const input = parseAIChatRequest(body);
    await options.store.verifyProjectToken(input.projectId, input.token);
    const messages: readonly AIChatMessage[] = [
      {
        role: "system",
        content: `You are an IoT platform assistant for the MCU Relay Console. The user manages STM32+ESP8266 devices. Help them with: 1) Understanding device data 2) Creating device templates 3) API usage 4) Debugging connectivity issues. Current projectId: ${input.projectId}. Respond in Chinese.`
      },
      ...(input.context === undefined ? [] : [{ role: "system" as const, content: input.context }]),
      ...input.messages
    ];
    const aiResponse = await createConfiguredAIClient().chat(messages);
    sendJson(response, 200, createSuccessPayload(aiResponse));
    return;
  }

  if (url.pathname === "/api/v1/ai/generate-template") {
    requireMethod(request.method, "POST");
    const body = await readJsonBody(request, maxBodyBytes);
    const input = parseTemplateGenerationRequest(body);
    await options.store.verifyProjectToken(input.projectId, input.token);
    const aiResponse = await createConfiguredAIClient().chat([
      {
        role: "system",
        content: "You are a device template generator. Given a description of a device (sensors, relays, alarms), output ONLY valid JSON matching this schema: { deviceId: string, type: string, template: { values: [{key, unit, label}], relays: [{key, label}], alarms: [{key, label}] } }. No other text."
      },
      { role: "user", content: input.description }
    ]);
    const content = readAiResponseContent(aiResponse);
    let generatedTemplate: JsonValue;
    try {
      generatedTemplate = JSON.parse(content) as JsonValue;
    } catch {
      throw createAppError(502, "AI_SERVICE_ERROR", "AI service returned an invalid device template JSON response.", { content });
    }
    if (!isJsonObject(generatedTemplate)) {
      throw createAppError(502, "AI_SERVICE_ERROR", "AI service returned a device template that is not a JSON object.", { generatedTemplate });
    }
    sendJson(response, 200, createSuccessPayload(generatedTemplate));
    return;
  }

  if (url.pathname === "/api/v1/devices") {
    requireMethod(request.method, "GET");
    const projectId = requireProjectId(url.searchParams.get("projectId"));
    await verifyProjectAccess(options.store, request, url, projectId, null);
    sendJson(response, 200, createSuccessPayload(await options.store.listDevices(projectId)));
    return;
  }

  if (url.pathname === "/api/v1/devices/status") {
    requireMethod(request.method, "GET");
    const projectId = requireProjectId(url.searchParams.get("projectId"));
    await verifyProjectAccess(options.store, request, url, projectId, null);
    const type = url.searchParams.get("type");
    sendJson(response, 200, createSuccessPayload(await options.store.getDeviceStatusSummary(projectId, type === null || type.length === 0 ? undefined : type)));
    return;
  }

  if (url.pathname === "/api/v1/devices/status-items") {
    requireMethod(request.method, "GET");
    const projectId = requireProjectId(url.searchParams.get("projectId"));
    await verifyProjectAccess(options.store, request, url, projectId, null);
    sendJson(response, 200, createSuccessPayload(await options.store.listDeviceStatuses(projectId)));
    return;
  }

  if (url.pathname === "/api/v1/dashboard") {
    requireMethod(request.method, "GET");
    const projectId = requireProjectId(url.searchParams.get("projectId"));
    await verifyProjectAccess(options.store, request, url, projectId, null);
    sendJson(response, 200, createSuccessPayload(await options.store.getDashboardSnapshot(projectId)));
    return;
  }

  if (url.pathname === "/api/v1/commands/batch") {
    requireMethod(request.method, "POST");
    const body = await readJsonBody(request, maxBodyBytes);
    const input = parseBatchCommandInput(body);
    await verifyProjectAccess(options.store, request, url, input.projectId, body);
    const queued = await options.store.enqueueCommandsWithResult(input.projectId, input.deviceIds, input.command);
    for (const command of queued.superseded) options.eventHub.publish({ type: "command_superseded", command });
    const dispatchResults = queued.commands.map((command) => {
      options.eventHub.publish({ type: "command_queued", command });
      return options.commandDispatcher.dispatchCommand(command);
    });
    const dispatched = dispatchResults.filter(Boolean).length;
    const result: BatchDeviceCommandResult = {
      count: queued.commands.length,
      dispatched,
      queuedOffline: queued.commands.length - dispatched,
      commands: queued.commands
    };
    sendJson(response, 201, createSuccessPayload(result));
    return;
  }

  if (url.pathname === "/api/v1/commands") {
    requireMethod(request.method, "GET");
    const query = parseCommandHistoryQuery(url);
    await verifyProjectAccess(options.store, request, url, query.projectId, null);
    const commands = (await options.store.listCommands())
      .filter((command) => command.projectId === query.projectId)
      .filter((command) => query.deviceId === null || command.deviceId === query.deviceId)
      .filter((command) => query.status === null || command.status === query.status)
      .slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, query.limit);
    sendJson(response, 200, createSuccessPayload(commands));
    return;
  }

  if (url.pathname === "/api/v1/events") {
    await handleEventStream(request, response, options.store, options.eventHub, url);
    return;
  }

  if (url.pathname === "/api/v1/devices/report") {
    requireMethod(request.method, "POST");
    const body = await readJsonBody(request, maxBodyBytes);
    const report = parseDeviceReportInput(body);
    await options.store.verifyProjectToken(report.projectId, report.token);
    const saved = await options.store.saveReportWithCommandState(report);
    const device = saved.device;
    options.eventHub.publish({
      type: "device_report",
      device
    });
    for (const command of saved.stateConfirmed) options.eventHub.publish({ type: "command_state_confirmed", command });
    sendJson(response, 201, createSuccessPayload(device));
    return;
  }

  if (url.pathname === "/api/v1/devices/batch-report") {
    requireMethod(request.method, "POST");
    const body = await readJsonBody(request, maxBodyBytes);
    const input = parseBatchReportInput(body);
    await options.store.verifyProjectToken(input.projectId, input.token);
    const devices = await Promise.all(input.reports.map(async (report) => {
      const saved = await options.store.saveReportWithCommandState(report);
      const device = saved.device;
      options.eventHub.publish({ type: "device_report", device });
      for (const command of saved.stateConfirmed) options.eventHub.publish({ type: "command_state_confirmed", command });
      return device;
    }));
    sendJson(response, 201, createSuccessPayload({ count: devices.length, devices }));
    return;
  }

  if (url.pathname === "/api/v1/devices/register") {
    requireMethod(request.method, "POST");
    const body = await readJsonBody(request, maxBodyBytes);
    const isV2Registration = isJsonObject(body) && (
      body.template !== undefined ||
      body.name !== undefined ||
      body.type !== undefined ||
      body.location !== undefined ||
      body.metadata !== undefined
    );
    const device = isV2Registration
      ? await (async () => {
          const input = parseDeviceRegistrationInputV2(body);
          await options.store.verifyProjectToken(input.projectId, input.token);
          return options.store.registerDeviceV2(input);
        })()
      : await (async () => {
          const input = parseDeviceRegistrationInput(body);
          await options.store.verifyProjectToken(input.projectId, input.token);
          return options.store.registerDevice(input.projectId, input.deviceId);
        })();
    sendJson(response, 201, createSuccessPayload(device));
    return;
  }

  if (url.pathname === "/api/v1/devices/import") {
    requireMethod(request.method, "POST");
    const input = parseDeviceImportInput(await readJsonBody(request, maxBodyBytes));
    await options.store.verifyProjectToken(input.projectId, input.token);
    const devices = await Promise.all(input.devices.map(async (item) => {
      const registered = await options.store.registerDevice(input.projectId, item.deviceId);
      const values = item.values ?? [];
      const relays = item.relays ?? [];
      const alarms = item.alarms ?? [];
      if (values.length + relays.length + alarms.length === 0) return registered;
      const device = await options.store.saveReport({ projectId: input.projectId, token: input.token, deviceId: item.deviceId, values, relays, alarms });
      options.eventHub.publish({ type: "device_report", device });
      return device;
    }));
    sendJson(response, 201, createSuccessPayload({ count: devices.length, devices }));
    return;
  }

  if (url.pathname === "/api/v1/devices/probe") {
    requireMethod(request.method, "POST");
    const body = await readJsonBody(request, maxBodyBytes);
    const probeRequest = parseProbeRequest(body);
    await options.store.verifyProjectToken(probeRequest.projectId, probeRequest.token);
    const command = await options.store.enqueueProbe(probeRequest.projectId, probeRequest.deviceId, {
      nonce: randomUUID(),
      timestamp: new Date().toISOString()
    });
    const tcpDispatched = options.tcpCommandDispatcher?.dispatchCommand(command) ?? options.commandDispatcher.dispatchCommand(command);
    const mqttDispatched = options.mqtt?.publishCommand(command) ?? false;
    if (tcpDispatched || mqttDispatched) {
      await options.store.setProbeTransport(probeRequest.projectId, probeRequest.deviceId, command.id, tcpDispatched && mqttDispatched ? "both" : tcpDispatched ? "tcp" : "mqtt");
    }
    const result = await options.store.waitForProbe(probeRequest.projectId, probeRequest.deviceId, command.id, 3_000);
    sendJson(response, 200, createSuccessPayload(result));
    return;
  }

  const probeStatusRoute = routeProbeStatusPath(url.pathname);
  if (probeStatusRoute !== null) {
    requireMethod(request.method, "GET");
    await verifyProjectAccess(options.store, request, url, probeStatusRoute.projectId, null);
    const result = await options.store.getProbeStatus(probeStatusRoute.projectId, probeStatusRoute.deviceId);
    sendJson(response, 200, createSuccessPayload(result ?? { reachable: false, latencyMs: null, transport: null, checkedAt: null }));
    return;
  }

  const resetTokenProjectId = routeResetTokenPath(url.pathname);
  if (resetTokenProjectId !== null) {
    requireMethod(request.method, "POST");
    await verifyProjectManagerAccess(options.store, request, url, resetTokenProjectId, null);
    sendJson(response, 200, createSuccessPayload({ newToken: await options.store.resetToken(resetTokenProjectId) }));
    return;
  }

  const agentKeysRoute = routeAgentKeysPath(url.pathname);
  if (agentKeysRoute !== null) {
    if (agentKeysRoute.keyId === undefined) {
      if (request.method === "GET") {
        await verifyProjectAccess(options.store, request, url, agentKeysRoute.projectId, null);
        const keys = await options.store.listAgentKeys(agentKeysRoute.projectId);
        sendJson(response, 200, createSuccessPayload(keys.map(createAgentKeySummary)));
        return;
      }
      requireMethod(request.method, "POST");
      const body = await readJsonBody(request, maxBodyBytes);
      await verifyProjectAccess(options.store, request, url, agentKeysRoute.projectId, body);
      sendJson(response, 201, createSuccessPayload(await options.store.createAgentKey(agentKeysRoute.projectId, parseAgentKeyLabel(body))));
      return;
    }
    requireMethod(request.method, "DELETE");
    await verifyProjectAccess(options.store, request, url, agentKeysRoute.projectId, null);
    await options.store.deleteAgentKey(agentKeysRoute.projectId, agentKeysRoute.keyId);
    sendJson(response, 200, createSuccessPayload({}));
    return;
  }

  const rulesRoute = routeRulesPath(url.pathname);
  if (rulesRoute !== null) {
    if (rulesRoute.ruleId === undefined) {
      if (request.method === "GET") {
        await verifyProjectAccess(options.store, request, url, rulesRoute.projectId, null);
        sendJson(response, 200, createSuccessPayload(await options.store.listRules(rulesRoute.projectId)));
        return;
      }
      requireMethod(request.method, "POST");
      const body = await readJsonBody(request, maxBodyBytes);
      await verifyProjectAccess(options.store, request, url, rulesRoute.projectId, body);
      sendJson(response, 201, createSuccessPayload(await options.store.createRule(rulesRoute.projectId, parseRuleInput(body))));
      return;
    }
    if (request.method === "PUT") {
      const body = await readJsonBody(request, maxBodyBytes);
      await verifyProjectAccess(options.store, request, url, rulesRoute.projectId, body);
      sendJson(response, 200, createSuccessPayload(await options.store.updateRule(rulesRoute.projectId, rulesRoute.ruleId, parseRuleInput(body))));
      return;
    }
    requireMethod(request.method, "DELETE");
    await verifyProjectAccess(options.store, request, url, rulesRoute.projectId, null);
    await options.store.deleteRule(rulesRoute.projectId, rulesRoute.ruleId);
    sendJson(response, 200, createSuccessPayload({}));
    return;
  }

  const forwardersRoute = routeForwardersPath(url.pathname);
  if (forwardersRoute !== null) {
    if (forwardersRoute.forwarderId === undefined) {
      if (request.method === "GET") {
        await verifyProjectAccess(options.store, request, url, forwardersRoute.projectId, null);
        sendJson(response, 200, createSuccessPayload(await options.store.listForwarders(forwardersRoute.projectId)));
        return;
      }
      requireMethod(request.method, "POST");
      const body = await readJsonBody(request, maxBodyBytes);
      await verifyProjectAccess(options.store, request, url, forwardersRoute.projectId, body);
      sendJson(response, 201, createSuccessPayload(await options.store.createForwarder(forwardersRoute.projectId, parseForwarderInput(body))));
      return;
    }
    if (request.method === "PUT") {
      const body = await readJsonBody(request, maxBodyBytes);
      await verifyProjectAccess(options.store, request, url, forwardersRoute.projectId, body);
      sendJson(response, 200, createSuccessPayload(await options.store.updateForwarder(forwardersRoute.projectId, forwardersRoute.forwarderId, parseForwarderInput(body))));
      return;
    }
    requireMethod(request.method, "DELETE");
    await verifyProjectAccess(options.store, request, url, forwardersRoute.projectId, null);
    await options.store.deleteForwarder(forwardersRoute.projectId, forwardersRoute.forwarderId);
    sendJson(response, 200, createSuccessPayload({}));
    return;
  }

  const firmwareRoute = routeFirmwarePath(url.pathname);
  if (firmwareRoute !== null) {
    if (firmwareRoute.firmwareId === undefined) {
      if (request.method === "GET") {
        await verifyProjectAccess(options.store, request, url, firmwareRoute.projectId, null);
        sendJson(response, 200, createSuccessPayload(await options.store.listFirmware(firmwareRoute.projectId)));
        return;
      }
      requireMethod(request.method, "POST");
      const body = await readJsonBody(request, maxBodyBytes);
      await verifyProjectAccess(options.store, request, url, firmwareRoute.projectId, body);
      sendJson(response, 201, createSuccessPayload(await options.store.addFirmware(firmwareRoute.projectId, parseFirmwareData(body))));
      return;
    }
    requireMethod(request.method, "DELETE");
    await verifyProjectAccess(options.store, request, url, firmwareRoute.projectId, null);
    await options.store.deleteFirmware(firmwareRoute.projectId, firmwareRoute.firmwareId);
    sendJson(response, 200, createSuccessPayload({}));
    return;
  }

  const remoteDebugRoute = routeRemoteDebugPath(url.pathname);
  if (remoteDebugRoute !== null) {
    const dispatcher = options.remoteDebugDispatcher;
    if (dispatcher === undefined) {
      throw createAppError(503, "REMOTE_DEBUG_UNAVAILABLE", "Remote debug is unavailable because the TCP gateway is not configured.", remoteDebugRoute);
    }
    if (remoteDebugRoute.action === "status") {
      requireMethod(request.method, "GET");
      await verifyProjectAccess(options.store, request, url, remoteDebugRoute.projectId, null);
      const online = dispatcher.isDeviceConnected(remoteDebugRoute.projectId, remoteDebugRoute.deviceId);
      const session = online
        ? remoteDebugRuntime.getSnapshot(remoteDebugRoute.projectId, remoteDebugRoute.deviceId)
        : remoteDebugRuntime.markOffline(remoteDebugRoute.projectId, remoteDebugRoute.deviceId);
      sendJson(response, 200, createSuccessPayload({
        online,
        projectId: remoteDebugRoute.projectId,
        deviceId: remoteDebugRoute.deviceId,
        session
      }));
      return;
    }

    if (remoteDebugRoute.action === "logs") {
      await verifyProjectAccess(options.store, request, url, remoteDebugRoute.projectId, null);
      if (request.method === "GET") {
        const page = remoteDebugRuntime.listLogs(remoteDebugRoute.projectId, remoteDebugRoute.deviceId, parseRemoteDebugLogLimit(url));
        sendJson(response, 200, createSuccessPayload({
          projectId: remoteDebugRoute.projectId,
          deviceId: remoteDebugRoute.deviceId,
          ...page
        }));
        return;
      }
      requireMethod(request.method, "DELETE");
      const cleared = remoteDebugRuntime.clearLogs(remoteDebugRoute.projectId, remoteDebugRoute.deviceId);
      sendJson(response, 200, createSuccessPayload({
        projectId: remoteDebugRoute.projectId,
        deviceId: remoteDebugRoute.deviceId,
        cleared
      }));
      return;
    }

    requireMethod(request.method, "POST");
    if (remoteDebugRoute.action === "write") {
      const body = await readJsonBody(request, maxBodyBytes);
      await verifyProjectAccess(options.store, request, url, remoteDebugRoute.projectId, body);
      const input = parseRemoteDebugWriteInput(body);
      if (!dispatcher.writeRemoteDebug(remoteDebugRoute.projectId, remoteDebugRoute.deviceId, input.data)) {
        throw createAppError(409, "REMOTE_DEBUG_DEVICE_OFFLINE", "The device has no active TCP connection for remote debug.", remoteDebugRoute);
      }
      const entry = remoteDebugRuntime.recordTransmit(remoteDebugRoute.projectId, remoteDebugRoute.deviceId, input.data, input.byteLength);
      options.eventHub.publish({ type: "remote_debug_log", ...entry });
      sendJson(response, 200, createSuccessPayload({ byteLength: input.byteLength, entry }));
      return;
    }

    await verifyProjectAccess(options.store, request, url, remoteDebugRoute.projectId, null);
    const dispatched = remoteDebugRoute.action === "open"
      ? dispatcher.openRemoteDebug(remoteDebugRoute.projectId, remoteDebugRoute.deviceId)
      : dispatcher.closeRemoteDebug(remoteDebugRoute.projectId, remoteDebugRoute.deviceId);
    if (!dispatched) {
      throw createAppError(409, "REMOTE_DEBUG_DEVICE_OFFLINE", "The device has no active TCP connection for remote debug.", remoteDebugRoute);
    }
    const session = remoteDebugRoute.action === "open"
      ? remoteDebugRuntime.markOpened(remoteDebugRoute.projectId, remoteDebugRoute.deviceId)
      : remoteDebugRuntime.markClosed(remoteDebugRoute.projectId, remoteDebugRoute.deviceId);
    sendJson(response, 200, createSuccessPayload(remoteDebugRoute.action === "open"
      ? { online: true, projectId: remoteDebugRoute.projectId, deviceId: remoteDebugRoute.deviceId, session }
      : { closed: true, projectId: remoteDebugRoute.projectId, deviceId: remoteDebugRoute.deviceId, session }));
    return;
  }

  const verifyRoute = routeVerifyPath(url.pathname);
  if (verifyRoute !== null) {
    requireMethod(request.method, "POST");
    const body = await readJsonBody(request, maxBodyBytes);
    await verifyProjectAccess(options.store, request, url, verifyRoute.projectId, body);
    const timeoutMs = parseVerifyTimeoutMs(body);
    const session = await options.store.startVerify(verifyRoute.projectId, verifyRoute.deviceId, timeoutMs);
    const result = await waitForVerifyResult(options.store, session, timeoutMs);
    const completedSession = await options.store.checkVerify(verifyRoute.projectId, verifyRoute.deviceId, session.id);
    options.eventHub.publish({ type: "device_verified", verify: completedSession });
    sendJson(response, 200, createSuccessPayload(result));
    return;
  }

  const shadowRoute = routeShadowPath(url.pathname);
  if (shadowRoute !== null) {
    if (request.method === "GET") {
      await verifyProjectAccess(options.store, request, url, shadowRoute.projectId, null);
      sendJson(response, 200, createSuccessPayload(await options.store.getShadow(shadowRoute.projectId, shadowRoute.deviceId)));
      return;
    }
    requireMethod(request.method, "PUT");
    const body = await readJsonBody(request, maxBodyBytes);
    await verifyProjectAccess(options.store, request, url, shadowRoute.projectId, body);
    const shadow = await options.store.updateShadowDesired(shadowRoute.projectId, shadowRoute.deviceId, parseShadowDesired(body));
    options.eventHub.publish({ type: "shadow_updated", shadow });
    sendJson(response, 200, createSuccessPayload(shadow));
    return;
  }

  const simulateRoute = routeSimulatePath(url.pathname);
  if (simulateRoute !== null) {
    requireMethod(request.method, "POST");
    const body = await readJsonBody(request, maxBodyBytes);
    const input = parseSimulateInput(body);
    if (input.projectId !== simulateRoute.projectId || input.deviceId !== simulateRoute.deviceId) {
      throw createAppError(400, "SIMULATE_ROUTE_MISMATCH", "Simulate request projectId and deviceId must match the request path.", { path: simulateRoute, inputProjectId: input.projectId, inputDeviceId: input.deviceId });
    }
    await verifyProjectAccess(options.store, request, url, simulateRoute.projectId, body);
    const device = await options.store.simulateReport(input);
    sendJson(response, 200, createSuccessPayload(device));
    return;
  }

  const otaProgressRoute = routeOTAProgressPath(url.pathname);
  if (otaProgressRoute !== null) {
    requireMethod(request.method, "POST");
    const body = await readJsonBody(request, maxBodyBytes);
    await verifyProjectAccess(options.store, request, url, otaProgressRoute.projectId, body);
    const input = parseOtaProgress(body);
    const current = await options.store.getOTATask(otaProgressRoute.projectId, otaProgressRoute.deviceId, otaProgressRoute.otaId);
    if (current === null) throw createAppError(404, "OTA_TASK_NOT_FOUND", "OTA task was not found for this device.", otaProgressRoute);
    assertOtaTransition(current.status, input.status);
    if (input.progress < current.progress) {
      throw createAppError(409, "OTA_PROGRESS_REGRESSION", "OTA progress cannot move backwards.", {
        currentProgress: current.progress,
        nextProgress: input.progress
      });
    }
    const ota = await options.store.updateOTATask(otaProgressRoute.projectId, otaProgressRoute.deviceId, otaProgressRoute.otaId, input.status, input.progress);
    options.eventHub.publish({ type: "firmware_progress", ota });
    sendJson(response, 200, createSuccessPayload(ota));
    return;
  }

  const otaRoute = routeOTAPath(url.pathname);
  if (otaRoute !== null) {
    if (request.method === "POST") {
      const body = await readJsonBody(request, maxBodyBytes);
      await verifyProjectAccess(options.store, request, url, otaRoute.projectId, body);
      const firmwareId = parseOtaFirmwareId(body);
      const firmware = (await options.store.listFirmware(otaRoute.projectId)).find((candidate) => candidate.id === firmwareId);
      if (firmware === undefined) throw createAppError(404, "FIRMWARE_NOT_FOUND", "Firmware was not found for this project.", { projectId: otaRoute.projectId, firmwareId });
      if (firmware.downloadUrl.length === 0) throw createAppError(409, "FIRMWARE_SOURCE_MISSING", "Firmware has no download URL. Recreate the firmware record with downloadUrl before starting OTA.", { projectId: otaRoute.projectId, firmwareId });
      const { ota, command } = await options.store.createOTATaskWithCommand(otaRoute.projectId, otaRoute.deviceId, firmwareId, {
        name: "ota_update",
        payload: {
          firmwareId: firmware.id,
          version: firmware.version,
          fileName: firmware.fileName,
          fileSize: firmware.fileSize,
          md5: firmware.md5,
          downloadUrl: firmware.downloadUrl
        }
      });
      options.eventHub.publish({ type: "firmware_progress", ota });
      options.eventHub.publish({ type: "command_queued", command });
      options.commandDispatcher.dispatchCommand(command);
      sendJson(response, 201, createSuccessPayload(ota));
      return;
    }
    requireMethod(request.method, "GET");
    await verifyProjectAccess(options.store, request, url, otaRoute.projectId, null);
    const otaIdParameter = url.searchParams.get("otaId");
    if (otaIdParameter === null || otaIdParameter.trim().length === 0) {
      sendJson(response, 200, createSuccessPayload(await options.store.listOTATasks(otaRoute.projectId, otaRoute.deviceId)));
      return;
    }
    const otaId = requireProjectId(otaIdParameter);
    const ota = await options.store.getOTATask(otaRoute.projectId, otaRoute.deviceId, otaId);
    if (ota === null) throw createAppError(404, "OTA_TASK_NOT_FOUND", "OTA task was not found for this device.", { ...otaRoute, otaId });
    sendJson(response, 200, createSuccessPayload(ota));
    return;
  }

  const latestRoute = routeDevicePath(url.pathname);
  if (latestRoute !== null) {
    requireMethod(request.method, "GET");
    await verifyProjectAccess(options.store, request, url, latestRoute.projectId, null);
    const device = await options.store.getDevice(latestRoute.projectId, latestRoute.deviceId);
    if (device === null) {
      throw createAppError(404, "DEVICE_NOT_FOUND", "Device was not found.", latestRoute);
    }
    sendJson(response, 200, createSuccessPayload(createDeviceStatusResponse(options, device)));
    return;
  }

  const diagnosticsRoute = routeDeviceDiagnosticsPath(url.pathname);
  if (diagnosticsRoute !== null) {
    requireMethod(request.method, "GET");
    await verifyProjectAccess(options.store, request, url, diagnosticsRoute.projectId, null);
    const device = await options.store.getDevice(diagnosticsRoute.projectId, diagnosticsRoute.deviceId);
    if (device === null) throw createAppError(404, "DEVICE_NOT_FOUND", "Device was not found.", diagnosticsRoute);
    const commands = (await options.store.listCommands())
      .filter((command) => command.projectId === diagnosticsRoute.projectId && command.deviceId === diagnosticsRoute.deviceId);
    const activeCommands = commands.filter((command) => command.status === "queued" || command.status === "dispatched" || command.status === "acked");
    const lastFailure = commands
      .filter((command) => command.failureCode !== null)
      .sort((left, right) => (right.failureAt ?? right.createdAt).localeCompare(left.failureAt ?? left.createdAt))[0] ?? null;
    sendJson(response, 200, createSuccessPayload({
      device: createDeviceStatusResponse(options, device),
      tcp: getDeviceConnectionStatus(options, device),
      activeCommands,
      lastFailure: lastFailure === null ? null : {
        commandId: lastFailure.id,
        code: lastFailure.failureCode,
        at: lastFailure.failureAt
      }
    }));
    return;
  }

  const commandStatusRoute = routeCommandStatusPath(url.pathname);
  if (commandStatusRoute !== null) {
    requireMethod(request.method, "GET");
    await verifyProjectAccess(options.store, request, url, commandStatusRoute.projectId, null);
    const command = await options.store.getCommand(commandStatusRoute.projectId, commandStatusRoute.deviceId, commandStatusRoute.commandId);
    if (command === null) throw createAppError(404, "COMMAND_NOT_FOUND", "Command was not found for this device.", commandStatusRoute);
    const device = await options.store.getDevice(commandStatusRoute.projectId, commandStatusRoute.deviceId);
    if (device === null) throw createAppError(404, "DEVICE_NOT_FOUND", "Device was not found.", commandStatusRoute);
    sendJson(response, 200, createSuccessPayload({
      command,
      device: createDeviceStatusResponse(options, device)
    }));
    return;
  }

  const commandRoute = routeCommandPath(url.pathname);
  if (commandRoute !== null) {
    requireMethod(request.method, "POST");
    const body = await readJsonBody(request, maxBodyBytes);
    await verifyProjectAccess(options.store, request, url, commandRoute.projectId, body);
    const input = parseCommandInput(body);
    const queued = await options.store.enqueueCommandWithResult(commandRoute.projectId, commandRoute.deviceId, input);
    for (const command of queued.superseded) options.eventHub.publish({ type: "command_superseded", command });
    if (!queued.reused) {
      options.eventHub.publish({
        type: "command_queued",
        command: queued.command
      });
      options.commandDispatcher.dispatchCommand(queued.command);
    }
    sendJson(response, 201, createSuccessPayload(queued.command));
    return;
  }

  const nextCommandRoute = routeNextCommandPath(url.pathname);
  if (nextCommandRoute !== null) {
    requireMethod(request.method, "GET");
    await verifyProjectAccess(options.store, request, url, nextCommandRoute.projectId, null);
    const command = await options.store.getNextCommand(nextCommandRoute.projectId, nextCommandRoute.deviceId);
    sendJson(response, 200, createSuccessPayload(command));
    return;
  }

  const ackCommandRoute = routeAckCommandPath(url.pathname);
  if (ackCommandRoute !== null) {
    requireMethod(request.method, "POST");
    await verifyProjectAccess(options.store, request, url, ackCommandRoute.projectId, null);
    const probe = await options.store.acknowledgeProbe(
      ackCommandRoute.projectId,
      ackCommandRoute.deviceId,
      ackCommandRoute.commandId,
      "http"
    );
    if (probe !== null) {
      sendJson(response, 200, createSuccessPayload(probe));
      return;
    }
    const command = await options.store.acknowledgeCommand(
      ackCommandRoute.projectId,
      ackCommandRoute.deviceId,
      ackCommandRoute.commandId
    );
    if (command.status === "state_confirmed") {
      options.eventHub.publish({ type: "command_state_confirmed", command });
    } else if (command.status !== "superseded") {
      options.eventHub.publish({ type: "command_acked", command });
    }
    sendJson(response, 200, createSuccessPayload(command));
    return;
  }

  throw createAppError(404, "ROUTE_NOT_FOUND", "API route was not found.", {
    pathname: url.pathname
  });
};

const sendError = (response: ServerResponse, error: unknown): void => {
  if (typeof error === "object" && error !== null && isAppError(error)) {
    sendJson(response, error.statusCode, {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    });
    return;
  }

  sendJson(response, 500, {
    ok: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected server error.",
      details: null
    }
  });
};

export const createApp = async (options: AppOptions): Promise<RequestListener> => {
  const rateLimits = new Map<string, RateLimitEntry>();
  const remoteDebugRuntime = createRemoteDebugRuntime(options.eventHub, () => new Date().toISOString());
  let lastRateLimitCleanupAt = 0;
  options.eventHub.subscribe((event) => {
    if (event.type !== "device_report") return;
    dispatchDeviceForwarders(options, event.device);
    const report: DeviceReportInput = {
      ...event.device.lastReport,
      token: ""
    };
    void dispatchTriggeredRules(options, event.device.projectId, event.device.deviceId, report).catch((error: unknown) => {
      console.error("rule_dispatch_failed", {
        projectId: event.device.projectId,
        deviceId: event.device.deviceId,
        reason: error instanceof Error ? error.message : "Unknown rule dispatch failure."
      });
    });
  });
  return (request: IncomingMessage, response: ServerResponse): void => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const startedAt = process.hrtime.bigint();
      const clientIp = readClientIp(request);
      configureSecurityHeaders(response);
      configureResponseCompression(response, readHeaderValue(request.headers["accept-encoding"]));
      configureCors(request, response, url, options.corsOrigins);
      if (url.pathname.startsWith("/api/")) {
        response.once("finish", () => {
          console.log(JSON.stringify({
            method: request.method ?? "UNKNOWN",
            path: url.pathname,
            status: response.statusCode,
            durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
            ip: clientIp,
            userAgent: readHeaderValue(request.headers["user-agent"]) ?? ""
          }));
        });
      }

      if (url.pathname.startsWith("/api/") && url.pathname !== "/api/v1/events") {
        const now = Date.now();
        if (now - lastRateLimitCleanupAt >= rateLimitWindowMs) {
          for (const [ip, entry] of rateLimits) {
            if (entry.resetAt <= now) rateLimits.delete(ip);
          }
          lastRateLimitCleanupAt = now;
        }
        const existing = rateLimits.get(clientIp);
        const entry = existing === undefined || existing.resetAt <= now ? { count: 0, resetAt: now + rateLimitWindowMs } : existing;
        if (entry.count >= rateLimitMaxRequests) {
          response.setHeader("Retry-After", Math.max(1, Math.ceil((entry.resetAt - now) / 1000)));
          sendJson(response, 429, { ok: false, error: { code: "RATE_LIMITED", message: "Too many requests. Retry after the indicated delay.", details: null } });
          return;
        }
        rateLimits.set(clientIp, { ...entry, count: entry.count + 1 });
      }

      if (url.pathname === "/") {
        redirect(response, "/admin");
        return;
      }

      if (url.pathname === "/admin") {
        await sendStaticFile(response, options.publicDir, "admin.html");
        return;
      }

      if (url.pathname === "/docs") {
        await sendStaticFile(response, options.publicDir, "admin.html");
        return;
      }

      if (url.pathname.startsWith("/assets/")) {
        await sendStaticFile(response, options.publicDir, url.pathname.replace(/^\//, ""));
        return;
      }

      if (url.pathname === "/favicon.ico") {
        sendText(response, 404, "Not found");
        return;
      }

      await handleApi(request, response, options, remoteDebugRuntime, url);
    })().catch((error: unknown) => {
      sendError(response, error);
    });
  };
};
