export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export type RelayState = "on" | "off";
export type DeviceValue = {
  readonly key: string;
  readonly value: string | number | boolean;
  readonly unit: string;
};
export type RelayOutput = {
  readonly key: string;
  readonly state: RelayState;
};
export type AlarmState = {
  readonly key: string;
  readonly active: boolean;
};
export type ProjectRecord = {
  readonly projectId: string;
  readonly token: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly account?: ProjectAccount | null;
};

export type ProjectAccount = {
  readonly id: string;
  readonly username: string;
  readonly password: string;
  readonly status: "pending" | "approved" | "rejected";
  readonly projectId: string | null;
  readonly requestedProjectId: string | null;
  readonly requestedProjectName: string | null;
  readonly createdAt: string;
  readonly reviewedAt: string | null;
};

export type ProjectUserSession = {
  readonly sessionToken: string;
  readonly user: {
    readonly id: string;
    readonly username: string;
    readonly projectId: string;
  };
};
export type DeviceReport = {
  readonly projectId: string;
  readonly deviceId: string;
  readonly values: readonly DeviceValue[];
  readonly relays: readonly RelayOutput[];
  readonly alarms: readonly AlarmState[];
  readonly reportedAt: string;
};
export type DeviceRecord = {
  readonly projectId: string;
  readonly deviceId: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly lastReport: DeviceReport;
  readonly activityConfirmed: boolean;
  readonly simulated?: boolean;
};
export type DeviceCommand = {
  readonly id: string;
  readonly projectId: string;
  readonly deviceId: string;
  readonly name: string;
  readonly payload: JsonObject;
  readonly status: "pending" | "acked" | "expired";
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly acknowledgedAt: string | null;
};
export type BatchDeviceCommandResult = {
  readonly count: number;
  readonly dispatched: number;
  readonly queuedOffline: number;
  readonly commands: readonly DeviceCommand[];
};
export type DashboardHourBucket = {
  readonly startedAt: string;
  readonly reports: number;
  readonly activeAlarmReports: number;
  readonly activeDevices: number;
};
export type DashboardAttentionDevice = {
  readonly deviceId: string;
  readonly online: boolean;
  readonly simulated: boolean;
  readonly activeAlarmCount: number;
  readonly lastSeenAt: string;
};
export type DashboardSnapshot = {
  readonly projectId: string;
  readonly generatedAt: string;
  readonly windowStartedAt: string;
  readonly windowHours: 24;
  readonly devices: {
    readonly total: number;
    readonly online: number;
    readonly offline: number;
    readonly simulated: number;
    readonly activeAlarmDevices: number;
  };
  readonly telemetry: {
    readonly relayTotal: number;
    readonly relayOn: number;
    readonly relayOff: number;
    readonly activeAlarmCount: number;
    readonly hasRelayData: boolean;
    readonly hasAlarmData: boolean;
  };
  readonly reports: {
    readonly total: number;
    readonly activeAlarmReports: number;
    readonly activeDevices: number;
    readonly lastReportedAt: string | null;
    readonly hourly: readonly DashboardHourBucket[];
  };
  readonly commands: {
    readonly total: number;
    readonly pending: number;
    readonly acked: number;
    readonly expired: number;
    readonly acknowledgementRate: number | null;
  };
  readonly automation: {
    readonly rulesEnabled: number;
    readonly rulesTotal: number;
    readonly otaActive: number;
    readonly otaSuccess: number;
    readonly otaFailed: number;
  };
  readonly attentionDevices: readonly DashboardAttentionDevice[];
};
export type ProbeResult = {
  readonly reachable: boolean;
  readonly latencyMs: number | null;
  readonly transport: "tcp" | "http" | "mqtt" | "both" | null;
  readonly checkedAt: string | null;
};
export type OperationalMetrics = {
  readonly generatedAt: string;
  readonly ready: boolean;
  readonly uptimeSeconds: number;
  readonly process: {
    readonly pid: number;
    readonly nodeVersion: string;
    readonly rssBytes: number;
    readonly heapUsedBytes: number;
    readonly heapTotalBytes: number;
  };
  readonly resources: {
    readonly projectsTotal: number;
    readonly devicesTotal: number;
    readonly devicesOnline: number;
    readonly commandsTotal: number;
    readonly commandsPending: number;
    readonly commandsAcked: number;
    readonly commandsExpired: number;
  };
  readonly gateways: {
    readonly tcp: string;
    readonly mqtt: string;
  };
};
export type ApiPayload<T> = {
  readonly ok: true;
  readonly data: T;
};
export const eventNames = [
  "connected",
  "device_report",
  "command_queued",
  "command_acked",
  "command_expired",
  "device_verified",
  "device_online",
  "device_offline",
  "rule_triggered",
  "shadow_updated",
  "firmware_progress",
  "forwarder_delivery",
  "alarm_triggered"
] as const;
export type EventName = typeof eventNames[number];
export type ServerStatus = "connecting" | "running" | "error";

const readDashboardProperty = (value: object, key: string): unknown => key in value ? Reflect.get(value, key) as unknown : undefined;
const expectDashboardObject = (value: unknown, path: string): object => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path} 必须是对象。`);
  return value;
};
const expectDashboardArray = (value: unknown, path: string): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${path} 必须是数组。`);
  return value;
};
const expectDashboardString = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${path} 必须是非空字符串。`);
  return value;
};
const expectDashboardTimestamp = (value: unknown, path: string): string => {
  const timestamp = expectDashboardString(value, path);
  if (Number.isNaN(Date.parse(timestamp))) throw new Error(`${path} 必须是有效时间。`);
  return timestamp;
};
const expectDashboardNullableTimestamp = (value: unknown, path: string): string | null => value === null ? null : expectDashboardTimestamp(value, path);
const expectDashboardBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== "boolean") throw new Error(`${path} 必须是布尔值。`);
  return value;
};
const expectDashboardCount = (value: unknown, path: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${path} 必须是非负整数。`);
  return value;
};
const expectDashboardRate = (value: unknown, path: string): number | null => {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${path} 必须是 0 到 1 之间的数字或 null。`);
  return value;
};
const parseDashboardHourBucket = (value: unknown, index: number): DashboardHourBucket => {
  const path = `仪表盘.reports.hourly[${index}]`;
  const object = expectDashboardObject(value, path);
  return {
    startedAt: expectDashboardTimestamp(readDashboardProperty(object, "startedAt"), `${path}.startedAt`),
    reports: expectDashboardCount(readDashboardProperty(object, "reports"), `${path}.reports`),
    activeAlarmReports: expectDashboardCount(readDashboardProperty(object, "activeAlarmReports"), `${path}.activeAlarmReports`),
    activeDevices: expectDashboardCount(readDashboardProperty(object, "activeDevices"), `${path}.activeDevices`)
  };
};
const parseDashboardAttentionDevice = (value: unknown, index: number): DashboardAttentionDevice => {
  const path = `仪表盘.attentionDevices[${index}]`;
  const object = expectDashboardObject(value, path);
  return {
    deviceId: expectDashboardString(readDashboardProperty(object, "deviceId"), `${path}.deviceId`),
    online: expectDashboardBoolean(readDashboardProperty(object, "online"), `${path}.online`),
    simulated: expectDashboardBoolean(readDashboardProperty(object, "simulated"), `${path}.simulated`),
    activeAlarmCount: expectDashboardCount(readDashboardProperty(object, "activeAlarmCount"), `${path}.activeAlarmCount`),
    lastSeenAt: expectDashboardTimestamp(readDashboardProperty(object, "lastSeenAt"), `${path}.lastSeenAt`)
  };
};

export const parseDashboardSnapshot = (value: unknown): DashboardSnapshot => {
  const root = expectDashboardObject(value, "仪表盘");
  const devices = expectDashboardObject(readDashboardProperty(root, "devices"), "仪表盘.devices");
  const telemetry = expectDashboardObject(readDashboardProperty(root, "telemetry"), "仪表盘.telemetry");
  const reports = expectDashboardObject(readDashboardProperty(root, "reports"), "仪表盘.reports");
  const commands = expectDashboardObject(readDashboardProperty(root, "commands"), "仪表盘.commands");
  const automation = expectDashboardObject(readDashboardProperty(root, "automation"), "仪表盘.automation");
  const hourly = expectDashboardArray(readDashboardProperty(reports, "hourly"), "仪表盘.reports.hourly").map(parseDashboardHourBucket);
  if (hourly.length !== 24) throw new Error("仪表盘.reports.hourly 必须包含 24 个小时桶。");
  const windowHours = readDashboardProperty(root, "windowHours");
  if (windowHours !== 24) throw new Error("仪表盘.windowHours 必须是 24。");
  const parsedDevices = {
    total: expectDashboardCount(readDashboardProperty(devices, "total"), "仪表盘.devices.total"),
    online: expectDashboardCount(readDashboardProperty(devices, "online"), "仪表盘.devices.online"),
    offline: expectDashboardCount(readDashboardProperty(devices, "offline"), "仪表盘.devices.offline"),
    simulated: expectDashboardCount(readDashboardProperty(devices, "simulated"), "仪表盘.devices.simulated"),
    activeAlarmDevices: expectDashboardCount(readDashboardProperty(devices, "activeAlarmDevices"), "仪表盘.devices.activeAlarmDevices")
  };
  if (parsedDevices.online + parsedDevices.offline !== parsedDevices.total) throw new Error("仪表盘设备在线与离线数量之和必须等于设备总数。");
  if (parsedDevices.activeAlarmDevices > parsedDevices.total) throw new Error("仪表盘活跃报警设备数量不能超过真实设备总数。");
  const parsedTelemetry = {
    relayTotal: expectDashboardCount(readDashboardProperty(telemetry, "relayTotal"), "仪表盘.telemetry.relayTotal"),
    relayOn: expectDashboardCount(readDashboardProperty(telemetry, "relayOn"), "仪表盘.telemetry.relayOn"),
    relayOff: expectDashboardCount(readDashboardProperty(telemetry, "relayOff"), "仪表盘.telemetry.relayOff"),
    activeAlarmCount: expectDashboardCount(readDashboardProperty(telemetry, "activeAlarmCount"), "仪表盘.telemetry.activeAlarmCount"),
    hasRelayData: expectDashboardBoolean(readDashboardProperty(telemetry, "hasRelayData"), "仪表盘.telemetry.hasRelayData"),
    hasAlarmData: expectDashboardBoolean(readDashboardProperty(telemetry, "hasAlarmData"), "仪表盘.telemetry.hasAlarmData")
  };
  if (parsedTelemetry.relayOn + parsedTelemetry.relayOff !== parsedTelemetry.relayTotal) throw new Error("仪表盘继电器开关数量之和必须等于继电器总数。");
  const parsedCommands = {
    total: expectDashboardCount(readDashboardProperty(commands, "total"), "仪表盘.commands.total"),
    pending: expectDashboardCount(readDashboardProperty(commands, "pending"), "仪表盘.commands.pending"),
    acked: expectDashboardCount(readDashboardProperty(commands, "acked"), "仪表盘.commands.acked"),
    expired: expectDashboardCount(readDashboardProperty(commands, "expired"), "仪表盘.commands.expired"),
    acknowledgementRate: expectDashboardRate(readDashboardProperty(commands, "acknowledgementRate"), "仪表盘.commands.acknowledgementRate")
  };
  if (parsedCommands.pending + parsedCommands.acked + parsedCommands.expired !== parsedCommands.total) throw new Error("仪表盘命令状态数量之和必须等于命令总数。");
  return {
    projectId: expectDashboardString(readDashboardProperty(root, "projectId"), "仪表盘.projectId"),
    generatedAt: expectDashboardTimestamp(readDashboardProperty(root, "generatedAt"), "仪表盘.generatedAt"),
    windowStartedAt: expectDashboardTimestamp(readDashboardProperty(root, "windowStartedAt"), "仪表盘.windowStartedAt"),
    windowHours,
    devices: parsedDevices,
    telemetry: parsedTelemetry,
    reports: {
      total: expectDashboardCount(readDashboardProperty(reports, "total"), "仪表盘.reports.total"),
      activeAlarmReports: expectDashboardCount(readDashboardProperty(reports, "activeAlarmReports"), "仪表盘.reports.activeAlarmReports"),
      activeDevices: expectDashboardCount(readDashboardProperty(reports, "activeDevices"), "仪表盘.reports.activeDevices"),
      lastReportedAt: expectDashboardNullableTimestamp(readDashboardProperty(reports, "lastReportedAt"), "仪表盘.reports.lastReportedAt"),
      hourly
    },
    commands: parsedCommands,
    automation: {
      rulesEnabled: expectDashboardCount(readDashboardProperty(automation, "rulesEnabled"), "仪表盘.automation.rulesEnabled"),
      rulesTotal: expectDashboardCount(readDashboardProperty(automation, "rulesTotal"), "仪表盘.automation.rulesTotal"),
      otaActive: expectDashboardCount(readDashboardProperty(automation, "otaActive"), "仪表盘.automation.otaActive"),
      otaSuccess: expectDashboardCount(readDashboardProperty(automation, "otaSuccess"), "仪表盘.automation.otaSuccess"),
      otaFailed: expectDashboardCount(readDashboardProperty(automation, "otaFailed"), "仪表盘.automation.otaFailed")
    },
    attentionDevices: expectDashboardArray(readDashboardProperty(root, "attentionDevices"), "仪表盘.attentionDevices").map(parseDashboardAttentionDevice)
  };
};

export const parseOperationalMetrics = (value: unknown): OperationalMetrics => {
  const root = expectDashboardObject(value, "运行指标");
  const process = expectDashboardObject(readDashboardProperty(root, "process"), "运行指标.process");
  const resources = expectDashboardObject(readDashboardProperty(root, "resources"), "运行指标.resources");
  const gateways = expectDashboardObject(readDashboardProperty(root, "gateways"), "运行指标.gateways");
  const devicesTotal = expectDashboardCount(readDashboardProperty(resources, "devices_total"), "运行指标.resources.devices_total");
  const devicesOnline = expectDashboardCount(readDashboardProperty(resources, "devices_online"), "运行指标.resources.devices_online");
  const commandsTotal = expectDashboardCount(readDashboardProperty(resources, "commands_total"), "运行指标.resources.commands_total");
  const commandsPending = expectDashboardCount(readDashboardProperty(resources, "commands_pending"), "运行指标.resources.commands_pending");
  const commandsAcked = expectDashboardCount(readDashboardProperty(resources, "commands_acked"), "运行指标.resources.commands_acked");
  const commandsExpired = expectDashboardCount(readDashboardProperty(resources, "commands_expired"), "运行指标.resources.commands_expired");
  if (devicesOnline > devicesTotal) throw new Error("运行指标在线设备数不能超过设备总数。");
  if (commandsPending + commandsAcked + commandsExpired !== commandsTotal) throw new Error("运行指标命令状态数量之和必须等于命令总数。");
  return {
    generatedAt: expectDashboardTimestamp(readDashboardProperty(root, "generated_at"), "运行指标.generated_at"),
    ready: expectDashboardBoolean(readDashboardProperty(root, "ready"), "运行指标.ready"),
    uptimeSeconds: expectDashboardCount(readDashboardProperty(root, "uptime_seconds"), "运行指标.uptime_seconds"),
    process: {
      pid: expectDashboardCount(readDashboardProperty(process, "pid"), "运行指标.process.pid"),
      nodeVersion: expectDashboardString(readDashboardProperty(process, "node_version"), "运行指标.process.node_version"),
      rssBytes: expectDashboardCount(readDashboardProperty(process, "rss_bytes"), "运行指标.process.rss_bytes"),
      heapUsedBytes: expectDashboardCount(readDashboardProperty(process, "heap_used_bytes"), "运行指标.process.heap_used_bytes"),
      heapTotalBytes: expectDashboardCount(readDashboardProperty(process, "heap_total_bytes"), "运行指标.process.heap_total_bytes")
    },
    resources: {
      projectsTotal: expectDashboardCount(readDashboardProperty(resources, "projects_total"), "运行指标.resources.projects_total"),
      devicesTotal,
      devicesOnline,
      commandsTotal,
      commandsPending,
      commandsAcked,
      commandsExpired
    },
    gateways: {
      tcp: expectDashboardString(readDashboardProperty(gateways, "tcp"), "运行指标.gateways.tcp"),
      mqtt: expectDashboardString(readDashboardProperty(gateways, "mqtt"), "运行指标.gateways.mqtt")
    }
  };
};
