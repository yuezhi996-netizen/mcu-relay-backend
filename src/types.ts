export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonArray = readonly JsonValue[];
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export type RelayState = "on" | "off";
export type DataValue = string | number | boolean;

export type DeviceValue = {
  readonly key: string;
  readonly value: DataValue;
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

export type DeviceReportInput = {
  readonly projectId: string;
  readonly token: string;
  readonly deviceId: string;
  readonly values: readonly DeviceValue[];
  readonly relays: readonly RelayOutput[];
  readonly alarms: readonly AlarmState[];
};

export type BatchDeviceReportInput = {
  readonly projectId: string;
  readonly token: string;
  readonly reports: readonly DeviceReportInput[];
};

export type DeviceRegistrationInput = {
  readonly projectId: string;
  readonly token: string;
  readonly deviceId: string;
};

export type DeviceImportItem = {
  readonly deviceId: string;
  readonly values: readonly DeviceValue[] | null;
  readonly relays: readonly RelayOutput[] | null;
  readonly alarms: readonly AlarmState[] | null;
};

export type DeviceImportInput = {
  readonly projectId: string;
  readonly token: string;
  readonly devices: readonly DeviceImportItem[];
};

export type DeviceReport = {
  readonly projectId: string;
  readonly deviceId: string;
  readonly values: readonly DeviceValue[];
  readonly relays: readonly RelayOutput[];
  readonly alarms: readonly AlarmState[];
  readonly reportedAt: string;
};

export type ProjectRecord = {
  readonly projectId: string;
  readonly token: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ProjectAccountStatus = "pending" | "approved" | "rejected";

export type ProjectAccountInput = {
  readonly username: string;
  readonly password: string;
};

export type ProjectAccountRegistrationInput = ProjectAccountInput & {
  readonly projectId: string;
  readonly projectName: string;
};

export type ProjectAccountRecord = {
  readonly id: string;
  readonly username: string;
  readonly passwordHash: string;
  readonly encryptedPassword: string;
  readonly status: ProjectAccountStatus;
  readonly projectId: string | null;
  readonly requestedProjectId: string | null;
  readonly requestedProjectName: string | null;
  readonly createdAt: string;
  readonly reviewedAt: string | null;
};

export type ProjectAccountAdminRecord = {
  readonly id: string;
  readonly username: string;
  readonly password: string;
  readonly status: ProjectAccountStatus;
  readonly projectId: string | null;
  readonly requestedProjectId: string | null;
  readonly requestedProjectName: string | null;
  readonly createdAt: string;
  readonly reviewedAt: string | null;
};

export type ProjectUserIdentity = {
  readonly id: string;
  readonly username: string;
  readonly projectId: string;
};

export type ProjectUserSession = {
  readonly sessionToken: string;
  readonly user: ProjectUserIdentity;
};

export type ProjectAccountReviewInput = {
  readonly decision: "approve" | "reject";
};

export type ProjectInput = {
  readonly projectId: string;
  readonly name?: string;
  readonly account?: ProjectAccountInput;
};

export type ProjectNameInput = {
  readonly name: string;
};

export type DeviceRecord = {
  readonly projectId: string;
  readonly deviceId: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly lastHeartbeatAt: string | null;
  readonly lastReportAt: string | null;
  readonly lastAckAt: string | null;
  readonly lastReport: DeviceReport;
  readonly activityConfirmed: boolean;
  readonly simulated?: boolean;
};

export type DeviceHourlyReportBucket = {
  readonly projectId: string;
  readonly deviceId: string;
  readonly startedAt: string;
  readonly reportCount: number;
  readonly activeAlarmReports: number;
};

export type DashboardHourlyReport = {
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
    readonly hourly: readonly DashboardHourlyReport[];
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

export type CommandStatus = "queued" | "dispatched" | "acked" | "state_confirmed" | "failed" | "expired" | "superseded";

export type CommandFailureCode = "DEVICE_OFFLINE" | "DEVICE_HEARTBEAT_ONLY" | "DISPATCH_FAILED" | "ACK_TIMEOUT" | "STATE_REPORT_TIMEOUT" | "INVALID_DEVICE_REPORT";

export type DeviceCommandInput = {
  readonly commandId?: string;
  readonly name: string;
  readonly payload: JsonObject;
};

export type BatchDeviceCommandInput = {
  readonly projectId: string;
  readonly deviceIds: readonly string[];
  readonly command: DeviceCommandInput;
};

export type BatchDeviceCommandResult = {
  readonly count: number;
  readonly dispatched: number;
  readonly queuedOffline: number;
  readonly commands: readonly DeviceCommand[];
};

export type DeviceCommandAckInput = {
  readonly projectId: string;
  readonly token: string;
  readonly deviceId: string;
  readonly commandId: string;
};

export type DeviceCommand = Omit<DeviceCommandInput, "commandId"> & {
  readonly id: string;
  readonly projectId: string;
  readonly deviceId: string;
  readonly status: CommandStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly dispatchedAt: string | null;
  readonly lastDispatchedAt: string | null;
  readonly acknowledgedAt: string | null;
  readonly stateReportedAt: string | null;
  readonly stateConfirmedAt: string | null;
  readonly dispatchAttempts: number;
  readonly failureCode: CommandFailureCode | null;
  readonly failureAt: string | null;
};

export type DeviceHealth = "offline" | "heartbeat_only" | "stale_state" | "ready";

export type DeviceConnectionStatus = {
  readonly connected: boolean;
  readonly connectedAt: string | null;
};

export type AppState = {
  readonly projects: readonly ProjectRecord[];
  readonly projectAccounts: readonly ProjectAccountRecord[];
  readonly devices: readonly DeviceRecord[];
  readonly commands: readonly DeviceCommand[];
  readonly agentKeys: readonly AgentKeyRecord[];
  readonly deviceMetadata: Record<string, DeviceMetadata>;
  readonly rules: readonly RuleRecord[];
  readonly forwarders: readonly ForwarderRecord[];
  readonly firmware: readonly FirmwareRecord[];
  readonly otaTasks: readonly OTATask[];
  readonly shadows: Record<string, DeviceShadow>;
  readonly reportBuckets: readonly DeviceHourlyReportBucket[];
  readonly ruleTriggerTimes: Readonly<Record<string, string>>;
};

export type CommandPollResult =
  | {
      readonly hasCommand: false;
    }
  | {
      readonly hasCommand: true;
      readonly command: DeviceCommand;
  };

export type ProbeTransport = "tcp" | "http" | "mqtt" | "both";

export type ProbeResult = {
  readonly reachable: boolean;
  readonly latencyMs: number | null;
  readonly transport: ProbeTransport | null;
  readonly checkedAt: string | null;
};

export type CommandDispatcher = {
  readonly dispatchCommand: (command: DeviceCommand) => boolean;
};

export type RemoteDebugDispatcher = {
  readonly isDeviceConnected: (projectId: string, deviceId: string) => boolean;
  readonly openRemoteDebug: (projectId: string, deviceId: string) => boolean;
  readonly writeRemoteDebug: (projectId: string, deviceId: string, data: string) => boolean;
  readonly closeRemoteDebug: (projectId: string, deviceId: string) => boolean;
};

export type RemoteDebugWriteInput = {
  readonly encoding: "base64";
  readonly data: string;
  readonly byteLength: number;
};

export type RemoteDebugDataInput = RemoteDebugWriteInput & {
  readonly projectId: string;
  readonly token: string;
  readonly deviceId: string;
};

export type AppError = {
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
  readonly details: JsonObject | null;
};

export type AgentKeyRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly key: string;
  readonly label: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
};

export type DeviceTemplateValue = {
  readonly key: string;
  readonly unit: string;
  readonly label: string;
};

export type DeviceTemplateRelay = {
  readonly key: string;
  readonly label: string;
};

export type DeviceTemplateAlarm = {
  readonly key: string;
  readonly label: string;
};

export type DeviceTemplate = {
  readonly values: readonly DeviceTemplateValue[];
  readonly relays: readonly DeviceTemplateRelay[];
  readonly alarms: readonly DeviceTemplateAlarm[];
};

export type DeviceRegistrationInputV2 = {
  readonly projectId: string;
  readonly token: string;
  readonly deviceId: string;
  readonly name?: string;
  readonly type?: string;
  readonly location?: string;
  readonly metadata?: JsonObject;
  readonly template?: DeviceTemplate;
};

export type DeviceMetadata = {
  readonly name: string;
  readonly type: string;
  readonly location: string;
  readonly metadata: JsonObject;
  readonly template: DeviceTemplate | null;
};

export type EnhancedDeviceRecord = DeviceRecord & DeviceMetadata;

export type DeviceStatusItem = {
  readonly deviceId: string;
  readonly online: boolean;
  readonly lastSeenAt: string;
  readonly name: string;
  readonly type: string;
  readonly alarmCount: number;
};

export type DeviceStatusSummary = {
  readonly total: number;
  readonly online: number;
  readonly offline: number;
  readonly alarmActive: number;
  readonly byType: Record<string, number>;
};

export type VerifySession = {
  readonly id: string;
  readonly projectId: string;
  readonly deviceId: string;
  readonly status: "waiting" | "success" | "timeout";
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly result: VerifyResult | null;
};

export type VerifyResult = {
  readonly online: boolean;
  readonly firstSeenAt: string | null;
  readonly dataComplete: boolean;
  readonly missingTemplate: readonly string[];
};

export type DeviceShadow = {
  readonly deviceId: string;
  readonly projectId: string;
  readonly desired: JsonObject;
  readonly reported: JsonObject;
  readonly delta: JsonObject;
  readonly version: number;
  readonly updatedAt: string;
};

export type RuleCondition = {
  readonly field: string;
  readonly operator: ">" | "<" | ">=" | "<=" | "==" | "!=";
  readonly value: number | string | boolean;
};

export type RuleAction = {
  readonly deviceId: string;
  readonly command: DeviceCommandInput;
};

export type RuleRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly conditions: readonly RuleCondition[];
  readonly logic: "all" | "any";
  readonly actions: readonly RuleAction[];
  readonly sourceDeviceIds: readonly string[];
  readonly cooldownMs: number;
  readonly lastTriggeredAt: string | null;
  readonly createdAt: string;
};

export type ForwarderType = "mqtt" | "webhook";

export type ForwarderRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly type: ForwarderType;
  readonly enabled: boolean;
  readonly config: JsonObject;
  readonly filter: { readonly deviceIds: readonly string[]; readonly keys: readonly string[] } | null;
  readonly createdAt: string;
};

export type FirmwareRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly version: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly md5: string;
  readonly downloadUrl: string;
  readonly uploadedAt: string;
};

export type OTATask = {
  readonly id: string;
  readonly projectId: string;
  readonly deviceId: string;
  readonly firmwareId: string;
  readonly status: "pending" | "downloading" | "installing" | "success" | "failed";
  readonly progress: number;
  readonly createdAt: string;
  readonly completedAt: string | null;
};

export type SimulateInput = {
  readonly projectId: string;
  readonly token: string;
  readonly deviceId: string;
  readonly values?: readonly DeviceValue[];
  readonly relays?: readonly RelayOutput[];
  readonly alarms?: readonly AlarmState[];
};

export type AIChatMessage = {
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
};

export type AIChatRequest = {
  readonly projectId: string;
  readonly token: string;
  readonly messages: readonly AIChatMessage[];
  readonly context?: string;
};

export type AIToolCall = {
  readonly name: string;
  readonly arguments: JsonObject;
  readonly result?: JsonValue;
};

export type WebhookDelivery = {
  readonly id: string;
  readonly webhookId: string;
  readonly eventType: string;
  readonly status: "success" | "failed";
  readonly statusCode: number | null;
  readonly durationMs: number;
  readonly deliveredAt: string;
};

export type RuleInput = {
  readonly name: string;
  readonly enabled: boolean;
  readonly conditions: readonly RuleCondition[];
  readonly logic: "all" | "any";
  readonly actions: readonly RuleAction[];
  readonly sourceDeviceIds?: readonly string[];
  readonly cooldownMs: number;
};

export type ForwarderInput = {
  readonly name: string;
  readonly type: ForwarderType;
  readonly enabled: boolean;
  readonly config: JsonObject;
  readonly filter: { readonly deviceIds: readonly string[]; readonly keys: readonly string[] } | null;
};

export type VerifyRequest = {
  readonly projectId: string;
  readonly token: string;
  readonly deviceId: string;
  readonly timeoutMs: number;
};
