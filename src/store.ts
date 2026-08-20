import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { createAppError } from "./errors.js";
import { isJsonObject } from "./validation.js";
import type {
  AgentKeyRecord,
  AppState,
  CommandFailureCode,
  CommandPollResult,
  DashboardSnapshot,
  DeviceCommand,
  DeviceCommandInput,
  DeviceMetadata,
  DeviceRecord,
  DeviceRegistrationInputV2,
  DeviceReport,
  DeviceReportInput,
  DeviceHourlyReportBucket,
  DeviceShadow,
  DeviceStatusItem,
  DeviceStatusSummary,
  EnhancedDeviceRecord,
  FirmwareRecord,
  ForwarderInput,
  ForwarderRecord,
  JsonObject,
  JsonValue,
  OTATask,
  ProbeResult,
  ProbeTransport,
  ProjectInput,
  ProjectAccountAdminRecord,
  ProjectAccountRecord,
  ProjectAccountRegistrationInput,
  ProjectAccountReviewInput,
  ProjectUserIdentity,
  ProjectUserSession,
  ProjectNameInput,
  ProjectRecord,
  RuleAction,
  RuleCondition,
  RuleInput,
  RuleRecord,
  SimulateInput,
  VerifyResult,
  VerifySession,
  WebhookDelivery
} from "./types.js";

export type FirmwareData = {
  readonly version: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly md5: string;
  readonly downloadUrl: string;
};

export type RuleTrigger = {
  readonly rule: RuleRecord;
  readonly actions: readonly RuleAction[];
};

export type OTATaskWithCommand = {
  readonly ota: OTATask;
  readonly command: DeviceCommand;
};

export type CommandQueueResult = {
  readonly command: DeviceCommand;
  readonly superseded: readonly DeviceCommand[];
  readonly reused: boolean;
};

export type DeviceReportSaveResult = {
  readonly device: DeviceRecord;
  readonly stateConfirmed: readonly DeviceCommand[];
};

export type CommandLifecycleSweepResult = {
  readonly expired: readonly DeviceCommand[];
  readonly requeued: readonly DeviceCommand[];
  readonly failed: readonly DeviceCommand[];
};

export type BatchCommandQueueResult = {
  readonly commands: readonly DeviceCommand[];
  readonly superseded: readonly DeviceCommand[];
};

export type DataStore = {
  readonly createProject: (input: ProjectInput) => Promise<ProjectRecord>;
  readonly listProjects: () => Promise<readonly ProjectRecord[]>;
  readonly listProjectAccounts: () => Promise<readonly ProjectAccountAdminRecord[]>;
  readonly registerProjectAccount: (input: ProjectAccountRegistrationInput) => Promise<ProjectAccountAdminRecord>;
  readonly reviewProjectAccount: (accountId: string, input: ProjectAccountReviewInput) => Promise<ProjectAccountAdminRecord>;
  readonly loginProjectAccount: (username: string, password: string) => Promise<ProjectUserSession>;
  readonly getProjectUserSession: (sessionToken: string) => Promise<ProjectUserIdentity>;
  readonly verifyProjectUserSession: (sessionToken: string, projectId: string) => Promise<ProjectUserIdentity>;
  readonly updateProjectName: (projectId: string, input: ProjectNameInput) => Promise<ProjectRecord>;
  readonly deleteProject: (projectId: string) => Promise<void>;
  readonly listCommands: () => Promise<readonly DeviceCommand[]>;
  readonly verifyProjectToken: (projectId: string, token: string) => Promise<ProjectRecord>;
  readonly resetToken: (projectId: string) => Promise<string>;
  readonly listDevices: (projectId: string | null) => Promise<readonly DeviceRecord[]>;
  readonly getDevice: (projectId: string, deviceId: string) => Promise<DeviceRecord | null>;
  readonly markDeviceSeen: (projectId: string, deviceId: string) => Promise<DeviceRecord>;
  readonly markDeviceHeartbeat: (projectId: string, deviceId: string) => Promise<DeviceRecord>;
  readonly saveReport: (input: DeviceReportInput) => Promise<DeviceRecord>;
  readonly saveReportWithCommandState: (input: DeviceReportInput) => Promise<DeviceReportSaveResult>;
  readonly registerDevice: (projectId: string, deviceId: string) => Promise<DeviceRecord>;
  readonly enqueueCommand: (projectId: string, deviceId: string, input: DeviceCommandInput) => Promise<DeviceCommand>;
  readonly enqueueCommands: (projectId: string, deviceIds: readonly string[], input: DeviceCommandInput) => Promise<readonly DeviceCommand[]>;
  readonly enqueueCommandWithResult: (projectId: string, deviceId: string, input: DeviceCommandInput) => Promise<CommandQueueResult>;
  readonly enqueueCommandsWithResult: (projectId: string, deviceIds: readonly string[], input: DeviceCommandInput) => Promise<BatchCommandQueueResult>;
  readonly expireCommands: () => Promise<readonly DeviceCommand[]>;
  readonly listPendingCommands: (projectId: string, deviceId: string) => Promise<readonly DeviceCommand[]>;
  readonly getNextCommand: (projectId: string, deviceId: string) => Promise<CommandPollResult>;
  readonly getCommand: (projectId: string, deviceId: string, commandId: string) => Promise<DeviceCommand | null>;
  readonly markCommandDispatched: (projectId: string, deviceId: string, commandId: string) => Promise<DeviceCommand>;
  readonly markCommandDispatchFailed: (projectId: string, deviceId: string, commandId: string) => Promise<DeviceCommand>;
  readonly acknowledgeCommand: (projectId: string, deviceId: string, commandId: string) => Promise<DeviceCommand>;
  readonly advanceCommandLifecycle: () => Promise<CommandLifecycleSweepResult>;
  readonly enqueueProbe: (projectId: string, deviceId: string, payload: JsonObject) => Promise<DeviceCommand>;
  readonly setProbeTransport: (projectId: string, deviceId: string, commandId: string, transport: ProbeTransport) => Promise<void>;
  readonly listPendingProbes: (projectId: string, deviceId: string) => Promise<readonly DeviceCommand[]>;
  readonly acknowledgeProbe: (projectId: string, deviceId: string, commandId: string, transport: ProbeTransport) => Promise<ProbeResult | null>;
  readonly waitForProbe: (projectId: string, deviceId: string, commandId: string, timeoutMs: number) => Promise<ProbeResult>;
  readonly getProbeStatus: (projectId: string, deviceId: string) => Promise<ProbeResult | null>;
  readonly createAgentKey: (projectId: string, label: string) => Promise<AgentKeyRecord>;
  readonly listAgentKeys: (projectId: string) => Promise<readonly AgentKeyRecord[]>;
  readonly deleteAgentKey: (projectId: string, keyId: string) => Promise<void>;
  readonly verifyAgentKey: (projectId: string, key: string) => Promise<ProjectRecord>;
  readonly touchAgentKey: (projectId: string, keyId: string) => Promise<void>;
  readonly saveDeviceMetadata: (projectId: string, deviceId: string, metadata: DeviceMetadata) => Promise<void>;
  readonly getDeviceMetadata: (projectId: string, deviceId: string) => Promise<DeviceMetadata | null>;
  readonly registerDeviceV2: (input: DeviceRegistrationInputV2) => Promise<EnhancedDeviceRecord>;
  readonly startVerify: (projectId: string, deviceId: string, timeoutMs: number) => Promise<VerifySession>;
  readonly checkVerify: (projectId: string, deviceId: string, verifyId: string) => Promise<VerifySession>;
  readonly getDeviceStatusSummary: (projectId: string, typeFilter?: string) => Promise<DeviceStatusSummary>;
  readonly listDeviceStatuses: (projectId: string) => Promise<readonly DeviceStatusItem[]>;
  readonly getDashboardSnapshot: (projectId: string) => Promise<DashboardSnapshot>;
  readonly getShadow: (projectId: string, deviceId: string) => Promise<DeviceShadow>;
  readonly updateShadowDesired: (projectId: string, deviceId: string, desired: JsonObject) => Promise<DeviceShadow>;
  readonly createRule: (projectId: string, input: RuleInput) => Promise<RuleRecord>;
  readonly listRules: (projectId: string) => Promise<readonly RuleRecord[]>;
  readonly updateRule: (projectId: string, ruleId: string, input: RuleInput) => Promise<RuleRecord>;
  readonly deleteRule: (projectId: string, ruleId: string) => Promise<void>;
  readonly evaluateRules: (projectId: string, deviceId: string, report: DeviceReportInput) => Promise<readonly RuleTrigger[]>;
  readonly createForwarder: (projectId: string, input: ForwarderInput) => Promise<ForwarderRecord>;
  readonly listForwarders: (projectId: string) => Promise<readonly ForwarderRecord[]>;
  readonly updateForwarder: (projectId: string, forwarderId: string, input: ForwarderInput) => Promise<ForwarderRecord>;
  readonly deleteForwarder: (projectId: string, forwarderId: string) => Promise<void>;
  readonly addFirmware: (projectId: string, firmwareData: FirmwareData) => Promise<FirmwareRecord>;
  readonly listFirmware: (projectId: string) => Promise<readonly FirmwareRecord[]>;
  readonly deleteFirmware: (projectId: string, firmwareId: string) => Promise<void>;
  readonly createOTATask: (projectId: string, deviceId: string, firmwareId: string) => Promise<OTATask>;
  readonly createOTATaskWithCommand: (projectId: string, deviceId: string, firmwareId: string, commandInput: DeviceCommandInput) => Promise<OTATaskWithCommand>;
  readonly listOTATasks: (projectId: string, deviceId: string) => Promise<readonly OTATask[]>;
  readonly updateOTATask: (projectId: string, deviceId: string, otaId: string, status: OTATask["status"], progress: number) => Promise<OTATask>;
  readonly getOTATask: (projectId: string, deviceId: string, otaId: string) => Promise<OTATask | null>;
  readonly simulateReport: (input: SimulateInput) => Promise<DeviceRecord>;
  readonly logWebhookDelivery: (webhookId: string, eventType: string, status: WebhookDelivery["status"], statusCode: number | null, durationMs: number) => Promise<WebhookDelivery>;
  readonly flush: () => Promise<void>;
  readonly close: () => Promise<void>;
};

type StoreOptions = {
  readonly dataFilePath: string;
  readonly createId: () => string;
  readonly createToken: () => string;
  readonly now: () => string;
  readonly accountCredentialKey?: string;
  readonly commandLifecycle?: CommandLifecycleSettings;
  readonly commandTtlMs?: number;
};

export type CommandLifecycleSettings = {
  readonly ackTimeoutMs: number;
  readonly stateConfirmTimeoutMs: number;
  readonly maxDispatchAttempts: number;
};

type StateUpdate<T> = {
  readonly state: AppState;
  readonly result: T;
};

type StateMigration = {
  readonly state: AppState;
  readonly changed: boolean;
};

type ProbeState = {
  readonly command: DeviceCommand;
  readonly result: ProbeResult | null;
  readonly transport: ProbeTransport | null;
  readonly waiters: readonly ((result: ProbeResult) => void)[];
};

type ProjectUserSessionState = {
  readonly accountId: string;
  readonly expiresAt: number;
};

type ProjectDeletion = {
  readonly forwarderIds: ReadonlySet<string>;
};

type CommandAcknowledgement = {
  readonly command: DeviceCommand;
  readonly outcome: "acked" | "state_confirmed" | "already_acked" | "expired" | "superseded";
};

const onlineWindowMs = 15_000;
const commandTtlMs = 5 * 60 * 1_000;
const defaultCommandLifecycleSettings: CommandLifecycleSettings = {
  ackTimeoutMs: 12_000,
  stateConfirmTimeoutMs: 12_000,
  maxDispatchAttempts: 3
};
const maxPendingCommandsPerDevice = 32;
const reportBucketRetentionHours = 48;
const dashboardWindowHours = 24 as const;
const hourMs = 60 * 60 * 1_000;

const createEmptyState = (): AppState => ({
  projects: [],
  projectAccounts: [],
  devices: [],
  commands: [],
  agentKeys: [],
  deviceMetadata: {},
  rules: [],
  forwarders: [],
  firmware: [],
  otaTasks: [],
  shadows: {},
  reportBuckets: [],
  ruleTriggerTimes: {}
});

const updateAppState = (state: AppState, changes: Partial<AppState>): AppState => ({
  projects: changes.projects ?? state.projects,
  projectAccounts: changes.projectAccounts ?? state.projectAccounts,
  devices: changes.devices ?? state.devices,
  commands: changes.commands ?? state.commands,
  agentKeys: changes.agentKeys ?? state.agentKeys,
  deviceMetadata: changes.deviceMetadata ?? state.deviceMetadata,
  rules: changes.rules ?? state.rules,
  forwarders: changes.forwarders ?? state.forwarders,
  firmware: changes.firmware ?? state.firmware,
  otaTasks: changes.otaTasks ?? state.otaTasks,
  shadows: changes.shadows ?? state.shadows,
  reportBuckets: changes.reportBuckets ?? state.reportBuckets,
  ruleTriggerTimes: changes.ruleTriggerTimes ?? state.ruleTriggerTimes
});

const projectHasToken = (project: ProjectRecord): boolean => typeof project.token === "string" && project.token.trim().length > 0;

const isRecord = (value: JsonValue | undefined): value is JsonObject => value !== undefined && isJsonObject(value);

const isFileNotFoundError = (error: unknown): boolean => {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
};

const createLegacyDeviceKey = (projectId: string, deviceId: string): string => `${projectId}/${deviceId}`;

const createDeviceKey = (projectId: string, deviceId: string): string => JSON.stringify([projectId, deviceId]);

const parseStoredState = (value: JsonValue, dataFilePath: string): AppState => {
  if (!isJsonObject(value)) {
    throw createAppError(500, "INVALID_STATE_FILE", "State file must contain a JSON object.", { dataFilePath });
  }
  const projects = value.projects;
  const projectAccounts = value.projectAccounts;
  const devices = value.devices;
  const commands = value.commands;
  if (!Array.isArray(projects) || !Array.isArray(devices) || !Array.isArray(commands)) {
    throw createAppError(500, "INVALID_STATE_FILE", "State file is missing required arrays.", { dataFilePath });
  }
  const agentKeys = value.agentKeys;
  const rules = value.rules;
  const forwarders = value.forwarders;
  const firmware = value.firmware;
  const otaTasks = value.otaTasks;
  const deviceMetadata = value.deviceMetadata;
  const shadows = value.shadows;
  const reportBuckets = value.reportBuckets;
  const ruleTriggerTimes = value.ruleTriggerTimes;
  if ((projectAccounts !== undefined && !Array.isArray(projectAccounts)) || (agentKeys !== undefined && !Array.isArray(agentKeys)) || (rules !== undefined && !Array.isArray(rules)) || (forwarders !== undefined && !Array.isArray(forwarders)) || (firmware !== undefined && !Array.isArray(firmware)) || (otaTasks !== undefined && !Array.isArray(otaTasks)) || (deviceMetadata !== undefined && !isRecord(deviceMetadata)) || (shadows !== undefined && !isRecord(shadows)) || (reportBuckets !== undefined && !Array.isArray(reportBuckets)) || (ruleTriggerTimes !== undefined && !isRecord(ruleTriggerTimes))) {
    throw createAppError(500, "INVALID_STATE_FILE", "State file has invalid optional state fields.", { dataFilePath });
  }
  return {
    projects: projects as readonly ProjectRecord[],
    projectAccounts: (projectAccounts ?? []) as readonly ProjectAccountRecord[],
    devices: devices as readonly DeviceRecord[],
    commands: commands as readonly DeviceCommand[],
    agentKeys: (agentKeys ?? []) as readonly AgentKeyRecord[],
    deviceMetadata: (deviceMetadata ?? {}) as Record<string, DeviceMetadata>,
    rules: (rules ?? []) as readonly RuleRecord[],
    forwarders: (forwarders ?? []) as readonly ForwarderRecord[],
    firmware: (firmware ?? []) as readonly FirmwareRecord[],
    otaTasks: (otaTasks ?? []) as readonly OTATask[],
    shadows: (shadows ?? {}) as Record<string, DeviceShadow>,
    reportBuckets: (reportBuckets ?? []) as readonly DeviceHourlyReportBucket[],
    ruleTriggerTimes: (ruleTriggerTimes ?? {}) as Readonly<Record<string, string>>
  };
};

const readStateFile = async (dataFilePath: string): Promise<AppState> => {
  try {
    const content = await readFile(dataFilePath, "utf8");
    return parseStoredState(JSON.parse(content) as JsonValue, dataFilePath);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw createAppError(500, "STATE_FILE_PARSE_FAILED", "State file is not valid JSON.", { dataFilePath, reason: error.message });
    }
    throw error;
  }
};

const createBackupFilePath = (dataFilePath: string): string => dataFilePath.endsWith(".json") ? `${dataFilePath.slice(0, -5)}.backup.json` : `${dataFilePath}.backup`;

const readStateWithBackup = async (dataFilePath: string): Promise<AppState> => {
  const backupFilePath = createBackupFilePath(dataFilePath);
  let primaryState: AppState;
  try {
    primaryState = await readStateFile(dataFilePath);
  } catch (primaryError) {
    if (isFileNotFoundError(primaryError)) {
      try {
        return await readStateFile(backupFilePath);
      } catch (backupError) {
        if (isFileNotFoundError(backupError)) return createEmptyState();
        throw backupError;
      }
    }
    try {
      return await readStateFile(backupFilePath);
    } catch {
      throw primaryError;
    }
  }
  await copyFile(dataFilePath, backupFilePath);
  return primaryState;
};

const writeStateFile = async (dataFilePath: string, state: AppState): Promise<void> => {
  await mkdir(dirname(dataFilePath), { recursive: true });
  const temporaryFilePath = `${dataFilePath}.tmp`;
  await writeFile(temporaryFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryFilePath, dataFilePath);
};

const migrateState = (state: AppState, createToken: () => string, now: string): StateMigration => {
  let changed = false;
  const projects = state.projects.map((project) => {
    if (projectHasToken(project)) return project;
    changed = true;
    return { ...project, token: createToken(), updatedAt: now };
  });
  const commands = state.commands.map((command) => {
    const createdAtMs = Date.parse(command.createdAt);
    const expiresAtMs = (Number.isFinite(createdAtMs) ? createdAtMs : Date.parse(now)) + commandTtlMs;
    const expiresAt = typeof command.expiresAt === "string" && Number.isFinite(Date.parse(command.expiresAt))
      ? command.expiresAt
      : new Date(expiresAtMs).toISOString();
    const legacyStatus = command.status as string;
    const status = legacyStatus === "pending" ? "queued" : command.status;
    const normalized = {
      ...command,
      status,
      expiresAt,
      dispatchedAt: command.dispatchedAt ?? null,
      lastDispatchedAt: command.lastDispatchedAt ?? command.dispatchedAt ?? null,
      acknowledgedAt: command.acknowledgedAt ?? null,
      stateReportedAt: command.stateReportedAt ?? null,
      stateConfirmedAt: command.stateConfirmedAt ?? null,
      dispatchAttempts: Number.isInteger(command.dispatchAttempts) && command.dispatchAttempts >= 0 ? command.dispatchAttempts : 0,
      failureCode: command.failureCode ?? null,
      failureAt: command.failureAt ?? null
    } as DeviceCommand;
    if (
      status !== command.status ||
      expiresAt !== command.expiresAt ||
      command.dispatchedAt === undefined ||
      command.lastDispatchedAt === undefined ||
      command.stateReportedAt === undefined ||
      command.stateConfirmedAt === undefined ||
      command.dispatchAttempts === undefined ||
      command.failureCode === undefined ||
      command.failureAt === undefined
    ) changed = true;
    return normalized;
  });
  const devices = state.devices.map((device) => {
    const brightness = device.lastReport.values.find((value) => value.key === "brightness")?.value;
    const hasBrightness = typeof brightness === "number" && Number.isInteger(brightness) && brightness >= 0 && brightness <= 100;
    const normalized = {
      ...device,
      activityConfirmed: typeof device.activityConfirmed === "boolean" ? device.activityConfirmed : true,
      lastHeartbeatAt: device.lastHeartbeatAt ?? null,
      lastReportAt: device.lastReportAt ?? (hasBrightness ? device.lastReport.reportedAt : null),
      lastAckAt: device.lastAckAt ?? null
    } as DeviceRecord;
    if (device.activityConfirmed === undefined || device.lastHeartbeatAt === undefined || device.lastReportAt === undefined || device.lastAckAt === undefined) changed = true;
    return normalized;
  });
  const rules = state.rules.map((rule) => {
    if (Array.isArray(rule.sourceDeviceIds)) return rule;
    changed = true;
    return { ...rule, sourceDeviceIds: [] };
  });
  const firmware = state.firmware.map((record) => {
    if (typeof record.downloadUrl === "string") return record;
    changed = true;
    return { ...record, downloadUrl: "" };
  });
  const deviceMetadata = { ...state.deviceMetadata };
  for (const device of state.devices) {
    const legacyKey = createLegacyDeviceKey(device.projectId, device.deviceId);
    const key = createDeviceKey(device.projectId, device.deviceId);
    const metadata = state.deviceMetadata[legacyKey];
    if (metadata !== undefined && deviceMetadata[key] === undefined) {
      deviceMetadata[key] = metadata;
      changed = true;
    }
  }
  const shadows = { ...state.shadows };
  for (const shadow of Object.values(state.shadows)) {
    const key = createDeviceKey(shadow.projectId, shadow.deviceId);
    if (shadows[key] === undefined) {
      shadows[key] = shadow;
      changed = true;
    }
  }
  return { state: updateAppState(state, { projects, devices, commands, deviceMetadata, rules, firmware, shadows }), changed };
};

const projectMatches = (project: ProjectRecord, projectId: string): boolean => project.projectId === projectId;
const deviceMatches = (device: DeviceRecord, projectId: string, deviceId: string): boolean => device.projectId === projectId && device.deviceId === deviceId;
const commandMatches = (command: DeviceCommand, projectId: string, deviceId: string, commandId: string): boolean => command.projectId === projectId && command.deviceId === deviceId && command.id === commandId;

const findProject = (state: AppState, projectId: string): ProjectRecord | null => state.projects.find((project) => projectMatches(project, projectId)) ?? null;

const requireProject = (state: AppState, projectId: string): ProjectRecord => {
  const project = findProject(state, projectId);
  if (project === null) throw createAppError(404, "PROJECT_NOT_FOUND", "Project was not found. Create the project before using its projectId.", { projectId });
  return project;
};

const requireProjectToken = (state: AppState, projectId: string, token: string): ProjectRecord => {
  const project = requireProject(state, projectId);
  if (project.token !== token) throw createAppError(401, "INVALID_PROJECT_TOKEN", "Project token is invalid.", { projectId });
  return project;
};

const ensureProject = (state: AppState, projectId: string, now: string): readonly ProjectRecord[] => {
  requireProject(state, projectId);
  return state.projects.map((project) => projectMatches(project, projectId) ? { ...project, updatedAt: now } : project);
};

const deriveAccountCredentialKey = (credentialKey: string | undefined): Buffer => {
  if (credentialKey === undefined || credentialKey.trim().length === 0) {
    throw createAppError(503, "ACCOUNT_CREDENTIAL_KEY_REQUIRED", "ACCOUNT_CREDENTIAL_KEY must be configured before creating or viewing project account passwords.", null);
  }
  return createHash("sha256").update(credentialKey).digest();
};

const encryptAccountPassword = (password: string, credentialKey: string | undefined): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveAccountCredentialKey(credentialKey), iv);
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${ciphertext.toString("base64")}`;
};

const decryptAccountPassword = (encryptedPassword: string, credentialKey: string | undefined): string => {
  const [ivValue, authTagValue, ciphertextValue] = encryptedPassword.split(".");
  if (ivValue === undefined || authTagValue === undefined || ciphertextValue === undefined) {
    throw createAppError(500, "INVALID_ACCOUNT_PASSWORD", "Stored project account password cannot be decrypted.", null);
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveAccountCredentialKey(credentialKey), Buffer.from(ivValue, "base64"));
    decipher.setAuthTag(Buffer.from(authTagValue, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw createAppError(500, "INVALID_ACCOUNT_PASSWORD", "Stored project account password cannot be decrypted. Check ACCOUNT_CREDENTIAL_KEY.", null);
  }
};

const hashAccountPassword = (password: string): string => {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("base64")}.${hash.toString("base64")}`;
};

const accountPasswordMatches = (password: string, passwordHash: string): boolean => {
  const [saltValue, hashValue] = passwordHash.split(".");
  if (saltValue === undefined || hashValue === undefined) return false;
  const expected = Buffer.from(hashValue, "base64");
  const actual = scryptSync(password, Buffer.from(saltValue, "base64"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

const requireUnusedUsername = (state: AppState, username: string): void => {
  if (state.projectAccounts.some((account) => account.username === username)) {
    throw createAppError(409, "USERNAME_ALREADY_EXISTS", "The login username is already in use.", { username });
  }
};

const requireUnboundProject = (state: AppState, projectId: string): void => {
  if (state.projectAccounts.some((account) => account.projectId === projectId)) {
    throw createAppError(409, "PROJECT_ACCOUNT_ALREADY_EXISTS", "The project already has a bound login account.", { projectId });
  }
};

const createGeneratedProjectUsername = (state: AppState): string => {
  const username = `user${randomInt(100_000, 1_000_000)}`;
  return state.projectAccounts.some((account) => account.username === username) ? createGeneratedProjectUsername(state) : username;
};

const createGeneratedProjectAccountInput = (state: AppState): NonNullable<ProjectInput["account"]> => ({
  username: createGeneratedProjectUsername(state),
  password: `mcu${randomInt(100_000, 1_000_000)}`
});

const createProjectAccount = (input: ProjectAccountRegistrationInput, status: ProjectAccountRecord["status"], projectId: string | null, id: string, now: string, credentialKey: string | undefined): ProjectAccountRecord => ({
  id,
  username: input.username,
  passwordHash: hashAccountPassword(input.password),
  encryptedPassword: encryptAccountPassword(input.password, credentialKey),
  status,
  projectId,
  requestedProjectId: input.projectId,
  requestedProjectName: input.projectName,
  createdAt: now,
  reviewedAt: status === "pending" ? null : now
});

const toProjectAccountAdminRecord = (account: ProjectAccountRecord, credentialKey: string | undefined): ProjectAccountAdminRecord => ({
  id: account.id,
  username: account.username,
  password: decryptAccountPassword(account.encryptedPassword, credentialKey),
  status: account.status,
  projectId: account.projectId,
  requestedProjectId: account.requestedProjectId,
  requestedProjectName: account.requestedProjectName,
  createdAt: account.createdAt,
  reviewedAt: account.reviewedAt
});

const toProjectUserIdentity = (account: ProjectAccountRecord): ProjectUserIdentity => {
  if (account.projectId === null) throw createAppError(403, "ACCOUNT_NOT_APPROVED", "The account is not approved for a project.", { accountId: account.id });
  return { id: account.id, username: account.username, projectId: account.projectId };
};

const appendProject = (state: AppState, input: ProjectInput, token: string, createAccountId: () => string, now: string, credentialKey: string | undefined): StateUpdate<ProjectRecord> => {
  if (findProject(state, input.projectId) !== null) throw createAppError(409, "PROJECT_ALREADY_EXISTS", "Project already exists.", { projectId: input.projectId });
  const project: ProjectRecord = { projectId: input.projectId, token, name: input.name ?? input.projectId, createdAt: now, updatedAt: now };
  const accountInput = input.account ?? createGeneratedProjectAccountInput(state);
  requireUnusedUsername(state, accountInput.username);
  requireUnboundProject(state, input.projectId);
  const account = createProjectAccount({ ...accountInput, projectId: input.projectId, projectName: project.name }, "approved", input.projectId, createAccountId(), now, credentialKey);
  return { state: updateAppState(state, { projects: [...state.projects, project], projectAccounts: [...state.projectAccounts, account] }), result: project };
};

const appendProjectAccountRegistration = (state: AppState, input: ProjectAccountRegistrationInput, accountId: string, now: string, credentialKey: string | undefined): StateUpdate<ProjectAccountRecord> => {
  if (findProject(state, input.projectId) !== null || state.projectAccounts.some((account) => account.requestedProjectId === input.projectId)) {
    throw createAppError(409, "PROJECT_ID_ALREADY_REQUESTED", "The project ID already exists or is pending review.", { projectId: input.projectId });
  }
  requireUnusedUsername(state, input.username);
  const account = createProjectAccount(input, "pending", null, accountId, now, credentialKey);
  return { state: updateAppState(state, { projectAccounts: [...state.projectAccounts, account] }), result: account };
};

const reviewProjectAccount = (state: AppState, accountId: string, input: ProjectAccountReviewInput, token: string, now: string): StateUpdate<ProjectAccountRecord> => {
  const account = state.projectAccounts.find((candidate) => candidate.id === accountId);
  if (account === undefined) throw createAppError(404, "PROJECT_ACCOUNT_NOT_FOUND", "Project account was not found.", { accountId });
  if (account.status !== "pending") throw createAppError(409, "PROJECT_ACCOUNT_ALREADY_REVIEWED", "Project account has already been reviewed.", { accountId, status: account.status });
  if (input.decision === "reject") {
    const rejected: ProjectAccountRecord = { ...account, status: "rejected", reviewedAt: now };
    return { state: updateAppState(state, { projectAccounts: state.projectAccounts.map((candidate) => candidate.id === accountId ? rejected : candidate) }), result: rejected };
  }
  if (account.requestedProjectId === null || account.requestedProjectName === null) {
    throw createAppError(500, "INVALID_PROJECT_ACCOUNT", "Pending project account has no requested project information.", { accountId });
  }
  if (findProject(state, account.requestedProjectId) !== null) throw createAppError(409, "PROJECT_ALREADY_EXISTS", "Project already exists.", { projectId: account.requestedProjectId });
  requireUnboundProject(state, account.requestedProjectId);
  const project: ProjectRecord = { projectId: account.requestedProjectId, token, name: account.requestedProjectName, createdAt: now, updatedAt: now };
  const approved: ProjectAccountRecord = { ...account, status: "approved", projectId: project.projectId, reviewedAt: now };
  return { state: updateAppState(state, { projects: [...state.projects, project], projectAccounts: state.projectAccounts.map((candidate) => candidate.id === accountId ? approved : candidate) }), result: approved };
};

const renameProject = (state: AppState, projectId: string, input: ProjectNameInput, now: string): StateUpdate<ProjectRecord> => {
  requireProject(state, projectId);
  const projects = state.projects.map((project) => projectMatches(project, projectId) ? { ...project, name: input.name, updatedAt: now } : project);
  const nextState = updateAppState(state, { projects });
  return { state: nextState, result: requireProject(nextState, projectId) };
};

const deviceKeyBelongsToProject = (key: string, projectId: string): boolean => {
  try {
    const parts = JSON.parse(key) as JsonValue;
    return Array.isArray(parts) && parts.length === 2 && parts[0] === projectId;
  } catch {
    return key.startsWith(`${projectId}/`);
  }
};

const omitDeviceMapProject = <T>(records: Readonly<Record<string, T>>, projectId: string): Record<string, T> => {
  return Object.fromEntries(Object.entries(records).filter(([key]) => !deviceKeyBelongsToProject(key, projectId)));
};

const omitProjectRecords = <T extends { readonly projectId: string }>(records: readonly T[], projectId: string): readonly T[] => {
  return records.filter((record) => record.projectId !== projectId);
};

const ruleTriggerKeyBelongsToRule = (key: string, ruleId: string): boolean => {
  try {
    const parts = JSON.parse(key) as JsonValue;
    return Array.isArray(parts) && parts.length === 2 && parts[0] === ruleId;
  } catch {
    return false;
  }
};

const omitRuleTriggerTimes = (records: Readonly<Record<string, string>>, ruleIds: ReadonlySet<string>): Readonly<Record<string, string>> => {
  return Object.fromEntries(Object.entries(records).filter(([key]) => ![...ruleIds].some((ruleId) => ruleTriggerKeyBelongsToRule(key, ruleId))));
};

const deleteProjectFromState = (state: AppState, projectId: string): StateUpdate<ProjectDeletion> => {
  requireProject(state, projectId);
  const forwarderIds = new Set(state.forwarders.filter((forwarder) => forwarder.projectId === projectId).map((forwarder) => forwarder.id));
  const ruleIds = new Set(state.rules.filter((rule) => rule.projectId === projectId).map((rule) => rule.id));
  return {
    state: updateAppState(state, {
      projects: omitProjectRecords(state.projects, projectId),
      projectAccounts: state.projectAccounts.filter((account) => account.projectId !== projectId),
      devices: omitProjectRecords(state.devices, projectId),
      commands: omitProjectRecords(state.commands, projectId),
      agentKeys: omitProjectRecords(state.agentKeys, projectId),
      deviceMetadata: omitDeviceMapProject(state.deviceMetadata, projectId),
      rules: omitProjectRecords(state.rules, projectId),
      forwarders: omitProjectRecords(state.forwarders, projectId),
      firmware: omitProjectRecords(state.firmware, projectId),
      otaTasks: omitProjectRecords(state.otaTasks, projectId),
      shadows: omitDeviceMapProject(state.shadows, projectId),
      reportBuckets: omitProjectRecords(state.reportBuckets, projectId),
      ruleTriggerTimes: omitRuleTriggerTimes(state.ruleTriggerTimes, ruleIds)
    }),
    result: { forwarderIds }
  };
};

const createReport = (input: DeviceReportInput, now: string): DeviceReport => ({
  projectId: input.projectId,
  deviceId: input.deviceId,
  values: [...input.values],
  relays: [...input.relays],
  alarms: [...input.alarms],
  reportedAt: now
});

const getBrightness = (input: DeviceReportInput): number | null => {
  const brightness = input.values.find((value) => value.key === "brightness")?.value;
  return typeof brightness === "number" && Number.isInteger(brightness) && brightness >= 0 && brightness <= 100 ? brightness : null;
};

const applyReport = (state: AppState, input: DeviceReportInput, now: string, simulated: boolean): StateUpdate<DeviceRecord> => {
  const report = createReport(input, now);
  const existing = state.devices.find((device) => deviceMatches(device, input.projectId, input.deviceId));
  const updatedDevice: DeviceRecord = {
    projectId: input.projectId,
    deviceId: input.deviceId,
    createdAt: existing?.createdAt ?? now,
    lastSeenAt: now,
    lastHeartbeatAt: existing?.lastHeartbeatAt ?? null,
    lastReportAt: getBrightness(input) === null ? existing?.lastReportAt ?? null : now,
    lastAckAt: existing?.lastAckAt ?? null,
    lastReport: report,
    activityConfirmed: !simulated,
    simulated
  };
  const devices = existing === undefined ? [...state.devices, updatedDevice] : state.devices.map((device) => deviceMatches(device, input.projectId, input.deviceId) ? updatedDevice : device);
  return { state: updateAppState(state, { projects: ensureProject(state, input.projectId, now), devices }), result: updatedDevice };
};

const startOfUtcHour = (timestamp: string): string => {
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) throw createAppError(500, "INVALID_CLOCK", "Store clock returned an invalid timestamp.", { timestamp });
  return new Date(Math.floor(timestampMs / hourMs) * hourMs).toISOString();
};

const addRealReportBucket = (state: AppState, input: DeviceReportInput, now: string): AppState => {
  const startedAt = startOfUtcHour(now);
  const retentionStartedAt = new Date(Date.parse(startedAt) - (reportBucketRetentionHours - 1) * hourMs).toISOString();
  const activeAlarmReport = input.alarms.some((alarm) => alarm.active) ? 1 : 0;
  const existing = state.reportBuckets.find((bucket) => bucket.projectId === input.projectId && bucket.deviceId === input.deviceId && bucket.startedAt === startedAt);
  const nextBucket: DeviceHourlyReportBucket = existing === undefined
    ? { projectId: input.projectId, deviceId: input.deviceId, startedAt, reportCount: 1, activeAlarmReports: activeAlarmReport }
    : { ...existing, reportCount: existing.reportCount + 1, activeAlarmReports: existing.activeAlarmReports + activeAlarmReport };
  const retainedBuckets = state.reportBuckets.filter((bucket) => bucket.startedAt >= retentionStartedAt && bucket !== existing);
  return updateAppState(state, { reportBuckets: [...retainedBuckets, nextBucket] });
};

const registerDevice = (state: AppState, projectId: string, deviceId: string, now: string): StateUpdate<DeviceRecord> => {
  const existing = state.devices.find((device) => deviceMatches(device, projectId, deviceId));
  if (existing !== undefined) return { state, result: existing };
  requireProject(state, projectId);
  const device: DeviceRecord = {
    projectId,
    deviceId,
    createdAt: now,
    lastSeenAt: now,
    lastHeartbeatAt: null,
    lastReportAt: null,
    lastAckAt: null,
    lastReport: { projectId, deviceId, values: [], relays: [], alarms: [], reportedAt: now },
    activityConfirmed: false
  };
  return { state: updateAppState(state, { projects: ensureProject(state, projectId, now), devices: [...state.devices, device] }), result: device };
};

const isStateReplacementCommand = (name: string): boolean => /^(set|update|configure)(?:[_:.-]|[A-Z])/.test(name);
const isActiveCommand = (status: DeviceCommand["status"]): boolean => status === "queued" || status === "dispatched" || status === "acked";
const isDispatchableCommand = (status: DeviceCommand["status"]): boolean => status === "queued" || status === "dispatched";

const createQueuedCommand = (projectId: string, deviceId: string, input: DeviceCommandInput, commandId: string, now: string, ttlMs: number): DeviceCommand => ({
  id: commandId,
  projectId,
  deviceId,
  name: input.name,
  payload: input.payload,
  status: "queued",
  createdAt: now,
  expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(),
  dispatchedAt: null,
  lastDispatchedAt: null,
  acknowledgedAt: null,
  stateReportedAt: null,
  stateConfirmedAt: null,
  dispatchAttempts: 0,
  failureCode: null,
  failureAt: null
});

const supersedePendingStateCommands = (state: AppState, projectId: string, deviceId: string, input: DeviceCommandInput): StateUpdate<readonly DeviceCommand[]> => {
  if (!isStateReplacementCommand(input.name)) return { state, result: [] };
  const superseded: DeviceCommand[] = [];
  const commands = state.commands.map((command) => {
    if (command.projectId !== projectId || command.deviceId !== deviceId || command.name !== input.name || command.status !== "queued") return command;
    const replacement: DeviceCommand = { ...command, status: "superseded" };
    superseded.push(replacement);
    return replacement;
  });
  return superseded.length === 0 ? { state, result: [] } : { state: updateAppState(state, { commands }), result: superseded };
};

const assertPendingCommandCapacity = (state: AppState, projectId: string, deviceId: string): void => {
  const pendingCount = state.commands.filter((command) => command.projectId === projectId && command.deviceId === deviceId && isActiveCommand(command.status)).length;
  if (pendingCount >= maxPendingCommandsPerDevice) {
    throw createAppError(429, "COMMAND_QUEUE_FULL", "The device command queue is full. Wait for the device to confirm queued commands before sending more.", {
      projectId,
      deviceId,
      limit: maxPendingCommandsPerDevice
    });
  }
};

const appendCommand = (state: AppState, projectId: string, deviceId: string, input: DeviceCommandInput, commandId: string, now: string, ttlMs: number): StateUpdate<CommandQueueResult> => {
  const activeState = expireActiveCommands(state, now);
  const requestedCommandId = input.commandId ?? commandId;
  const existing = activeState.commands.find((command) => commandMatches(command, projectId, deviceId, requestedCommandId));
  if (existing !== undefined) {
    if (existing.name !== input.name || !jsonValuesEqual(existing.payload, input.payload)) {
      throw createAppError(409, "COMMAND_ID_CONFLICT", "commandId already exists with a different command payload.", { projectId, deviceId, commandId: requestedCommandId });
    }
    return { state: activeState, result: { command: existing, superseded: [], reused: true } };
  }
  const replacement = supersedePendingStateCommands(activeState, projectId, deviceId, input);
  assertPendingCommandCapacity(replacement.state, projectId, deviceId);
  const command = createQueuedCommand(projectId, deviceId, input, requestedCommandId, now, ttlMs);
  return {
    state: updateAppState(replacement.state, { projects: ensureProject(replacement.state, projectId, now), commands: [...replacement.state.commands, command] }),
    result: { command, superseded: replacement.result, reused: false }
  };
};

const appendCommands = (state: AppState, projectId: string, deviceIds: readonly string[], input: DeviceCommandInput, createId: () => string, now: string, ttlMs: number): StateUpdate<BatchCommandQueueResult> => {
  requireProject(state, projectId);
  let nextState = state;
  const commands: DeviceCommand[] = [];
  const superseded: DeviceCommand[] = [];
  for (const deviceId of deviceIds) {
    const update = appendCommand(nextState, projectId, deviceId, input, createId(), now, ttlMs);
    nextState = update.state;
    commands.push(update.result.command);
    superseded.push(...update.result.superseded);
  }
  return { state: nextState, result: { commands, superseded } };
};

const appendOTATask = (state: AppState, projectId: string, deviceId: string, firmwareId: string, otaId: string, now: string): StateUpdate<OTATask> => {
  requireProject(state, projectId);
  if (!state.firmware.some((firmware) => firmware.projectId === projectId && firmware.id === firmwareId)) throw createAppError(404, "FIRMWARE_NOT_FOUND", "Firmware was not found for this project.", { projectId, firmwareId });
  const activeTask = state.otaTasks.find((task) => task.projectId === projectId && task.deviceId === deviceId && (task.status === "pending" || task.status === "downloading" || task.status === "installing"));
  if (activeTask !== undefined) {
    throw createAppError(409, "OTA_TASK_ALREADY_ACTIVE", "An active OTA task already exists for this device.", { projectId, deviceId, otaId: activeTask.id });
  }
  const task: OTATask = { id: otaId, projectId, deviceId, firmwareId, status: "pending", progress: 0, createdAt: now, completedAt: null };
  return { state: updateAppState(state, { otaTasks: [...state.otaTasks, task] }), result: task };
};

const expireActiveCommands = (state: AppState, now: string): AppState => {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return state;
  let changed = false;
  const commands = state.commands.map((command) => {
    if (!isActiveCommand(command.status) || Date.parse(command.expiresAt) > nowMs) return command;
    changed = true;
    return { ...command, status: "expired" as const };
  });
  return changed ? updateAppState(state, { commands }) : state;
};

const markCommandAcknowledged = (state: AppState, projectId: string, deviceId: string, commandId: string, now: string): StateUpdate<CommandAcknowledgement> => {
  const nextState = expireActiveCommands(state, now);
  const existing = nextState.commands.find((command) => commandMatches(command, projectId, deviceId, commandId));
  if (existing === undefined) throw createAppError(404, "COMMAND_NOT_FOUND", "Command was not found for this device.", { projectId, deviceId, commandId });
  if (existing.status === "expired") return { state: nextState, result: { command: existing, outcome: "expired" } };
  if (existing.status === "superseded") return { state: nextState, result: { command: existing, outcome: "superseded" } };
  if (existing.status === "acked" || existing.status === "state_confirmed") return { state: nextState, result: { command: existing, outcome: "already_acked" } };
  if (existing.status !== "queued" && existing.status !== "dispatched") return { state: nextState, result: { command: existing, outcome: "superseded" } };
  const acknowledged: DeviceCommand = existing.stateReportedAt === null
    ? { ...existing, status: "acked", acknowledgedAt: now }
    : { ...existing, status: "state_confirmed", acknowledgedAt: now, stateConfirmedAt: now };
  return {
    state: updateAppState(nextState, { commands: nextState.commands.map((command) => commandMatches(command, projectId, deviceId, commandId) ? acknowledged : command) }),
    result: { command: acknowledged, outcome: acknowledged.status === "state_confirmed" ? "state_confirmed" : "acked" }
  };
};

const markDeviceSeenInState = (state: AppState, projectId: string, deviceId: string, now: string): StateUpdate<DeviceRecord> => {
  const existing = state.devices.find((device) => deviceMatches(device, projectId, deviceId));
  if (existing === undefined) throw createAppError(404, "DEVICE_NOT_FOUND", "Device was not found.", { projectId, deviceId });
  const device: DeviceRecord = { ...existing, lastSeenAt: now, activityConfirmed: true };
  return { state: updateAppState(state, { devices: state.devices.map((candidate) => candidate === existing ? device : candidate) }), result: device };
};

const markDeviceSeenIfExists = (state: AppState, projectId: string, deviceId: string, now: string): AppState => {
  const existing = state.devices.find((device) => deviceMatches(device, projectId, deviceId));
  if (existing === undefined) return state;
  return markDeviceSeenInState(state, projectId, deviceId, now).state;
};

const markDeviceHeartbeatInState = (state: AppState, projectId: string, deviceId: string, now: string): StateUpdate<DeviceRecord> => {
  const update = markDeviceSeenInState(state, projectId, deviceId, now);
  const device: DeviceRecord = { ...update.result, lastHeartbeatAt: now };
  return { state: updateAppState(update.state, { devices: update.state.devices.map((candidate) => candidate === update.result ? device : candidate) }), result: device };
};

const markDeviceAckInState = (state: AppState, projectId: string, deviceId: string, now: string): AppState => {
  const existing = state.devices.find((device) => deviceMatches(device, projectId, deviceId));
  if (existing === undefined) return state;
  const device: DeviceRecord = { ...existing, lastSeenAt: now, lastAckAt: now, activityConfirmed: true };
  return updateAppState(state, { devices: state.devices.map((candidate) => candidate === existing ? device : candidate) });
};

const updateCommand = (state: AppState, command: DeviceCommand): AppState => {
  return updateAppState(state, { commands: state.commands.map((candidate) => commandMatches(candidate, command.projectId, command.deviceId, command.id) ? command : candidate) });
};

const requireActiveCommand = (state: AppState, projectId: string, deviceId: string, commandId: string): DeviceCommand => {
  const command = state.commands.find((candidate) => commandMatches(candidate, projectId, deviceId, commandId));
  if (command === undefined) throw createAppError(404, "COMMAND_NOT_FOUND", "Command was not found for this device.", { projectId, deviceId, commandId });
  if (!isDispatchableCommand(command.status)) throw createAppError(409, "COMMAND_NOT_DISPATCHABLE", "Command is not waiting for TCP dispatch.", { projectId, deviceId, commandId, status: command.status });
  return command;
};

const markCommandDispatchedInState = (state: AppState, projectId: string, deviceId: string, commandId: string, now: string): StateUpdate<DeviceCommand> => {
  const nextState = expireActiveCommands(state, now);
  const command = requireActiveCommand(nextState, projectId, deviceId, commandId);
  const dispatched: DeviceCommand = {
    ...command,
    status: "dispatched",
    dispatchedAt: command.dispatchedAt ?? now,
    lastDispatchedAt: now,
    dispatchAttempts: command.dispatchAttempts + 1,
    failureCode: null,
    failureAt: null
  };
  return { state: updateCommand(nextState, dispatched), result: dispatched };
};

const markCommandDispatchFailedInState = (state: AppState, projectId: string, deviceId: string, commandId: string, now: string): StateUpdate<DeviceCommand> => {
  const nextState = expireActiveCommands(state, now);
  const command = requireActiveCommand(nextState, projectId, deviceId, commandId);
  const queued: DeviceCommand = { ...command, status: "queued", failureCode: "DISPATCH_FAILED", failureAt: now };
  return { state: updateCommand(nextState, queued), result: queued };
};

const advanceCommandLifecycleInState = (state: AppState, now: string, settings: CommandLifecycleSettings): StateUpdate<CommandLifecycleSweepResult> => {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw createAppError(500, "INVALID_CLOCK", "Store clock returned an invalid timestamp.", { now });
  const expired: DeviceCommand[] = [];
  const requeued: DeviceCommand[] = [];
  const failed: DeviceCommand[] = [];
  let changed = false;
  const commands = state.commands.map((command) => {
    if (!isActiveCommand(command.status)) return command;
    const expiresAtMs = Date.parse(command.expiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
      const next: DeviceCommand = { ...command, status: "expired" };
      expired.push(next);
      changed = true;
      return next;
    }
    if (command.status === "dispatched") {
      const lastDispatchedAtMs = Date.parse(command.lastDispatchedAt ?? command.dispatchedAt ?? "");
      if (Number.isFinite(lastDispatchedAtMs) && nowMs - lastDispatchedAtMs >= settings.ackTimeoutMs) {
        if (command.dispatchAttempts >= settings.maxDispatchAttempts) {
          const next: DeviceCommand = { ...command, status: "failed", failureCode: "ACK_TIMEOUT", failureAt: now };
          failed.push(next);
          changed = true;
          return next;
        }
        const next: DeviceCommand = { ...command, status: "queued", failureCode: "ACK_TIMEOUT", failureAt: now };
        requeued.push(next);
        changed = true;
        return next;
      }
    }
    if (command.status === "acked") {
      const acknowledgedAtMs = Date.parse(command.acknowledgedAt ?? "");
      if (Number.isFinite(acknowledgedAtMs) && nowMs - acknowledgedAtMs >= settings.stateConfirmTimeoutMs) {
        const next: DeviceCommand = { ...command, status: "failed", failureCode: "STATE_REPORT_TIMEOUT", failureAt: now };
        failed.push(next);
        changed = true;
        return next;
      }
    }
    return command;
  });
  return changed ? { state: updateAppState(state, { commands }), result: { expired, requeued, failed } } : { state, result: { expired, requeued, failed } };
};

const sortByCreatedAt = (commands: readonly DeviceCommand[]): readonly DeviceCommand[] => [...commands].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
const createProbeKey = createDeviceKey;
const createProbeTimeout = (): ProbeResult => ({ reachable: false, latencyMs: null, transport: null, checkedAt: null });

const createDefaultMetadata = (deviceId: string): DeviceMetadata => ({ name: deviceId, type: "", location: "", metadata: {}, template: null });

const createEnhancedDevice = (device: DeviceRecord, metadata: DeviceMetadata): EnhancedDeviceRecord => ({ ...device, ...metadata });

const reportAsJson = (report: DeviceReportInput | DeviceReport): JsonObject => {
  const values: Record<string, JsonValue> = {};
  for (const value of report.values) values[value.key] = value.value;
  for (const relay of report.relays) values[relay.key] = relay.state;
  for (const alarm of report.alarms) values[alarm.key] = alarm.active;
  return values;
};

const jsonValuesEqual = (left: JsonValue | undefined, right: JsonValue | undefined): boolean => {
  if (left === right) return true;
  if (left === undefined || right === undefined || typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => jsonValuesEqual(value, right[index]));
  }
  if (!isJsonObject(left) || !isJsonObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => jsonValuesEqual(left[key], right[key]));
};

const calculateDelta = (desired: JsonObject, reported: JsonObject): JsonObject => {
  const delta: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(desired)) {
    if (!jsonValuesEqual(value, reported[key])) delta[key] = value;
  }
  return delta;
};

const createShadow = (projectId: string, deviceId: string, now: string): DeviceShadow => ({ projectId, deviceId, desired: {}, reported: {}, delta: {}, version: 0, updatedAt: now });

const updateShadowReported = (state: AppState, input: DeviceReportInput, now: string): AppState => {
  const key = createDeviceKey(input.projectId, input.deviceId);
  const current = state.shadows[key] ?? createShadow(input.projectId, input.deviceId, now);
  const reported = reportAsJson(input);
  const shadow: DeviceShadow = { ...current, reported, delta: calculateDelta(current.desired, reported), version: current.version + 1, updatedAt: now };
  return updateAppState(state, { shadows: { ...state.shadows, [key]: shadow } });
};

const commandTargetBrightness = (command: DeviceCommand): number | null => {
  if (command.name !== "set_light") return null;
  const percent = command.payload.percent;
  return typeof percent === "number" && Number.isInteger(percent) && percent >= 0 && percent <= 100 ? percent : null;
};

const reportFollowsDispatch = (command: DeviceCommand, reportedAt: string): boolean => {
  if (command.dispatchedAt === null) return false;
  const dispatchedAt = Date.parse(command.dispatchedAt);
  const reportedAtMs = Date.parse(reportedAt);
  return Number.isFinite(dispatchedAt) && Number.isFinite(reportedAtMs) && reportedAtMs > dispatchedAt;
};

const applyCommandStateReport = (state: AppState, input: DeviceReportInput, reportedAt: string): StateUpdate<readonly DeviceCommand[]> => {
  const brightness = getBrightness(input);
  if (brightness === null) return { state, result: [] };
  const stateConfirmed: DeviceCommand[] = [];
  let changed = false;
  const commands = state.commands.map((command) => {
    if (command.projectId !== input.projectId || command.deviceId !== input.deviceId || !isDispatchableCommand(command.status) && command.status !== "acked") return command;
    if (commandTargetBrightness(command) !== brightness || !reportFollowsDispatch(command, reportedAt)) return command;
    if (command.status === "acked") {
      const confirmed: DeviceCommand = { ...command, status: "state_confirmed", stateReportedAt: reportedAt, stateConfirmedAt: reportedAt };
      stateConfirmed.push(confirmed);
      changed = true;
      return confirmed;
    }
    if (command.status === "dispatched" && command.stateReportedAt === null) {
      changed = true;
      return { ...command, stateReportedAt: reportedAt };
    }
    return command;
  });
  return changed ? { state: updateAppState(state, { commands }), result: stateConfirmed } : { state, result: [] };
};

const conditionMatches = (condition: RuleCondition, values: JsonObject): boolean => {
  const reported = values[condition.field];
  if (typeof reported !== "string" && typeof reported !== "number" && typeof reported !== "boolean") return false;
  if (condition.operator === "==") return reported === condition.value;
  if (condition.operator === "!=") return reported !== condition.value;
  if ((typeof reported !== "number" && typeof reported !== "string") || typeof reported !== typeof condition.value) return false;
  if (condition.operator === ">") return reported > condition.value;
  if (condition.operator === "<") return reported < condition.value;
  if (condition.operator === ">=") return reported >= condition.value;
  return reported <= condition.value;
};

const cooldownExpired = (lastTriggeredAt: string | null, cooldownMs: number, now: string): boolean => {
  if (lastTriggeredAt === null) return true;
  const elapsedMs = Date.parse(now) - Date.parse(lastTriggeredAt);
  return !Number.isFinite(elapsedMs) || elapsedMs >= cooldownMs;
};

const createRuleTriggerKey = (ruleId: string, deviceId: string): string => JSON.stringify([ruleId, deviceId]);

const evaluateRulesInState = (state: AppState, projectId: string, deviceId: string, report: DeviceReportInput, now: string): StateUpdate<readonly RuleTrigger[]> => {
  requireProject(state, projectId);
  const values = reportAsJson(report);
  const eligibleRules = state.rules.filter((rule) => {
    if (rule.projectId !== projectId || !rule.enabled) return false;
    if (rule.sourceDeviceIds.length > 0 && !rule.sourceDeviceIds.includes(deviceId)) return false;
    const lastTriggeredAt = state.ruleTriggerTimes[createRuleTriggerKey(rule.id, deviceId)] ?? null;
    if (!cooldownExpired(lastTriggeredAt, rule.cooldownMs, now)) return false;
    const matches = rule.conditions.map((condition) => conditionMatches(condition, values));
    return rule.logic === "all" ? matches.every(Boolean) : matches.some(Boolean);
  });
  const triggeredIds = new Set(eligibleRules.map((rule) => rule.id));
  const rules = state.rules.map((rule) => triggeredIds.has(rule.id) ? { ...rule, lastTriggeredAt: now } : rule);
  const triggeredRules = rules.filter((rule) => triggeredIds.has(rule.id));
  const ruleTriggerTimes = { ...state.ruleTriggerTimes };
  for (const rule of triggeredRules) ruleTriggerTimes[createRuleTriggerKey(rule.id, deviceId)] = now;
  return {
    state: updateAppState(state, { rules, ruleTriggerTimes }),
    result: triggeredRules.map((rule) => ({ rule, actions: rule.actions }))
  };
};

const templateMissingKeys = (metadata: DeviceMetadata | null, report: DeviceReportInput): readonly string[] => {
  if (metadata?.template === null || metadata === null) return [];
  const reported = reportAsJson(report);
  const template = metadata.template;
  return [...template.values, ...template.relays, ...template.alarms].map((entry) => entry.key).filter((key) => reported[key] === undefined);
};

const createVerifyResult = (metadata: DeviceMetadata | null, report: DeviceReportInput, seenAt: string): VerifyResult => {
  const missingTemplate = templateMissingKeys(metadata, report);
  return { online: true, firstSeenAt: seenAt, dataComplete: missingTemplate.length === 0, missingTemplate };
};

const createVerifyTimeoutResult = (): VerifyResult => ({ online: false, firstSeenAt: null, dataComplete: false, missingTemplate: [] });

const isOnline = (lastSeenAt: string, now: string): boolean => {
  const elapsedMs = Date.parse(now) - Date.parse(lastSeenAt);
  return Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs <= onlineWindowMs;
};

const isDeviceOnline = (device: DeviceRecord, now: string): boolean => device.simulated !== true && device.activityConfirmed && isOnline(device.lastSeenAt, now);

const compareAttentionDevices = (left: DashboardSnapshot["attentionDevices"][number], right: DashboardSnapshot["attentionDevices"][number]): number => {
  if (left.activeAlarmCount !== right.activeAlarmCount) return right.activeAlarmCount - left.activeAlarmCount;
  if (left.online !== right.online) return left.online ? 1 : -1;
  const leftSeenAt = Date.parse(left.lastSeenAt);
  const rightSeenAt = Date.parse(right.lastSeenAt);
  if (leftSeenAt !== rightSeenAt) return leftSeenAt - rightSeenAt;
  return left.deviceId.localeCompare(right.deviceId);
};

const createDashboardSnapshot = (state: AppState, projectId: string, now: string): DashboardSnapshot => {
  requireProject(state, projectId);
  const currentHourStartedAt = startOfUtcHour(now);
  const windowStartedAt = new Date(Date.parse(currentHourStartedAt) - (dashboardWindowHours - 1) * hourMs).toISOString();
  const hourlyStartedAt = Array.from({ length: dashboardWindowHours }, (_, index) => new Date(Date.parse(windowStartedAt) + index * hourMs).toISOString());
  const projectDevices = state.devices.filter((device) => device.projectId === projectId);
  const realDevices = projectDevices.filter((device) => device.simulated !== true);
  const onlineDevices = realDevices.filter((device) => isDeviceOnline(device, now));
  const activeAlarmCounts = realDevices.map((device) => device.lastReport.alarms.filter((alarm) => alarm.active).length);
  const relays = realDevices.flatMap((device) => device.lastReport.relays);
  const alarms = realDevices.flatMap((device) => device.lastReport.alarms);
  const projectBuckets = state.reportBuckets.filter((bucket) => bucket.projectId === projectId && bucket.startedAt >= windowStartedAt && bucket.startedAt <= currentHourStartedAt);
  const hourly = hourlyStartedAt.map((startedAt) => {
    const buckets = projectBuckets.filter((bucket) => bucket.startedAt === startedAt);
    return {
      startedAt,
      reports: buckets.reduce((total, bucket) => total + bucket.reportCount, 0),
      activeAlarmReports: buckets.reduce((total, bucket) => total + bucket.activeAlarmReports, 0),
      activeDevices: new Set(buckets.map((bucket) => bucket.deviceId)).size
    };
  });
  const projectCommands = state.commands.filter((command) => command.projectId === projectId);
  const pendingCommands = projectCommands.filter((command) => isActiveCommand(command.status)).length;
  const acknowledgedCommands = projectCommands.filter((command) => command.status === "acked" || command.status === "state_confirmed").length;
  const expiredCommands = projectCommands.filter((command) => command.status === "expired" || command.status === "superseded" || command.status === "failed").length;
  const terminalCommands = acknowledgedCommands + expiredCommands;
  const projectRules = state.rules.filter((rule) => rule.projectId === projectId);
  const projectOtaTasks = state.otaTasks.filter((task) => task.projectId === projectId);
  const lastReportedAt = realDevices
    .filter((device) => device.activityConfirmed)
    .map((device) => device.lastReport.reportedAt)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
  const attentionDevices = projectDevices.map((device) => ({
    deviceId: device.deviceId,
    online: isDeviceOnline(device, now),
    simulated: device.simulated === true,
    activeAlarmCount: device.lastReport.alarms.filter((alarm) => alarm.active).length,
    lastSeenAt: device.lastSeenAt
  })).sort(compareAttentionDevices).slice(0, 5);
  return {
    projectId,
    generatedAt: now,
    windowStartedAt,
    windowHours: dashboardWindowHours,
    devices: {
      total: realDevices.length,
      online: onlineDevices.length,
      offline: realDevices.length - onlineDevices.length,
      simulated: projectDevices.length - realDevices.length,
      activeAlarmDevices: activeAlarmCounts.filter((count) => count > 0).length
    },
    telemetry: {
      relayTotal: relays.length,
      relayOn: relays.filter((relay) => relay.state === "on").length,
      relayOff: relays.filter((relay) => relay.state === "off").length,
      activeAlarmCount: activeAlarmCounts.reduce((total, count) => total + count, 0),
      hasRelayData: relays.length > 0,
      hasAlarmData: alarms.length > 0
    },
    reports: {
      total: hourly.reduce((total, bucket) => total + bucket.reports, 0),
      activeAlarmReports: hourly.reduce((total, bucket) => total + bucket.activeAlarmReports, 0),
      activeDevices: new Set(projectBuckets.map((bucket) => bucket.deviceId)).size,
      lastReportedAt,
      hourly
    },
    commands: {
      total: projectCommands.length,
      pending: pendingCommands,
      acked: acknowledgedCommands,
      expired: expiredCommands,
      acknowledgementRate: terminalCommands === 0 ? null : acknowledgedCommands / terminalCommands
    },
    automation: {
      rulesEnabled: projectRules.filter((rule) => rule.enabled).length,
      rulesTotal: projectRules.length,
      otaActive: projectOtaTasks.filter((task) => task.status === "pending" || task.status === "downloading" || task.status === "installing").length,
      otaSuccess: projectOtaTasks.filter((task) => task.status === "success").length,
      otaFailed: projectOtaTasks.filter((task) => task.status === "failed").length
    },
    attentionDevices
  };
};

export const createDataStore = async (options: StoreOptions): Promise<DataStore> => {
  const loadedState = await readStateWithBackup(options.dataFilePath);
  const migration = migrateState(loadedState, options.createToken, options.now());
  let state = migration.state;
  let writeChain: Promise<void> = Promise.resolve();
  let flushChain: Promise<void> = Promise.resolve();
  let dirty = false;
  const probes = new Map<string, ProbeState>();
  const verifySessions = new Map<string, VerifySession>();
  const projectUserSessions = new Map<string, ProjectUserSessionState>();
  let webhookDeliveries: readonly WebhookDelivery[] = [];
  const lifecycleSettings = options.commandLifecycle ?? defaultCommandLifecycleSettings;
  const configuredCommandTtlMs = options.commandTtlMs ?? commandTtlMs;
  if (
    !Number.isInteger(lifecycleSettings.ackTimeoutMs) || lifecycleSettings.ackTimeoutMs <= 0 ||
    !Number.isInteger(lifecycleSettings.stateConfirmTimeoutMs) || lifecycleSettings.stateConfirmTimeoutMs <= 0 ||
    !Number.isInteger(lifecycleSettings.maxDispatchAttempts) || lifecycleSettings.maxDispatchAttempts < 1
    || !Number.isInteger(configuredCommandTtlMs) || configuredCommandTtlMs <= 0
  ) {
    throw createAppError(500, "INVALID_COMMAND_LIFECYCLE_CONFIG", "Command lifecycle settings must contain positive integer timeouts and retry limits.", null);
  }

  const write = <T>(updateState: () => StateUpdate<T>): Promise<T> => {
    const operation = writeChain.then(async () => {
      const update = updateState();
      const changed = update.state !== state;
      state = update.state;
      if (changed) dirty = true;
      return update.result;
    });
    writeChain = operation.then(() => undefined, () => undefined);
    return operation;
  };

  const flush = (): Promise<void> => {
    const operation = flushChain.then(async () => {
      await writeChain;
      if (!dirty) return;
      const stateToWrite = state;
      await writeStateFile(options.dataFilePath, stateToWrite);
      if (state === stateToWrite) dirty = false;
    });
    flushChain = operation.then(() => undefined, () => undefined);
    return operation;
  };

  const resolveVerifySessions = (input: DeviceReportInput, reportedAt: string): void => {
    const metadata = state.deviceMetadata[createDeviceKey(input.projectId, input.deviceId)] ?? null;
    for (const [verifyId, session] of verifySessions) {
      if (session.projectId !== input.projectId || session.deviceId !== input.deviceId || session.status !== "waiting") continue;
      verifySessions.set(verifyId, { ...session, status: "success", completedAt: reportedAt, result: createVerifyResult(metadata, input, reportedAt) });
    }
  };

  const resolveProjectUserSession = (sessionToken: string): ProjectUserIdentity => {
    const session = projectUserSessions.get(sessionToken);
    if (session === undefined || session.expiresAt <= Date.now()) {
      projectUserSessions.delete(sessionToken);
      throw createAppError(401, "INVALID_USER_SESSION", "User session is missing, invalid, or expired.", null);
    }
    const account = state.projectAccounts.find((candidate) => candidate.id === session.accountId);
    if (account === undefined || account.status !== "approved") throw createAppError(401, "INVALID_USER_SESSION", "User session account is no longer available.", null);
    return toProjectUserIdentity(account);
  };

  if (migration.changed) await writeStateFile(options.dataFilePath, state);
  const flushTimer = setInterval(() => {
    void flush().catch((error: unknown) => console.error("state_flush_failed", error));
  }, 500);
  flushTimer.unref();
  let closed = false;

  return {
    createProject: async (input: ProjectInput) => write(() => appendProject(state, input, options.createToken(), options.createId, options.now(), options.accountCredentialKey)),
    listProjects: async () => state.projects,
    listProjectAccounts: async () => state.projectAccounts.map((account) => toProjectAccountAdminRecord(account, options.accountCredentialKey)),
    registerProjectAccount: async (input: ProjectAccountRegistrationInput) => {
      const account = await write(() => appendProjectAccountRegistration(state, input, options.createId(), options.now(), options.accountCredentialKey));
      return toProjectAccountAdminRecord(account, options.accountCredentialKey);
    },
    reviewProjectAccount: async (accountId: string, input: ProjectAccountReviewInput) => {
      const account = await write(() => reviewProjectAccount(state, accountId, input, options.createToken(), options.now()));
      return toProjectAccountAdminRecord(account, options.accountCredentialKey);
    },
    loginProjectAccount: async (username: string, password: string) => {
      const account = state.projectAccounts.find((candidate) => candidate.username === username);
      if (account === undefined || !accountPasswordMatches(password, account.passwordHash)) {
        throw createAppError(401, "INVALID_LOGIN", "Username or password is incorrect.", null);
      }
      if (account.status === "pending") throw createAppError(403, "ACCOUNT_PENDING_REVIEW", "Registration is pending administrator review.", null);
      if (account.status === "rejected") throw createAppError(403, "ACCOUNT_REJECTED", "Registration was rejected by the administrator.", null);
      const sessionToken = options.createToken();
      projectUserSessions.set(sessionToken, { accountId: account.id, expiresAt: Date.now() + 12 * 60 * 60 * 1_000 });
      return { sessionToken, user: toProjectUserIdentity(account) };
    },
    getProjectUserSession: async (sessionToken: string) => resolveProjectUserSession(sessionToken),
    verifyProjectUserSession: async (sessionToken: string, projectId: string) => {
      const user = resolveProjectUserSession(sessionToken);
      if (user.projectId !== projectId) {
        throw createAppError(403, "PROJECT_ACCESS_DENIED", "Project user can access only the project bound to the account.", { requestedProjectId: projectId, accountProjectId: user.projectId });
      }
      return user;
    },
    updateProjectName: async (projectId: string, input: ProjectNameInput) => write(() => renameProject(state, projectId, input, options.now())),
    deleteProject: async (projectId: string) => {
      const deletion = await write(() => deleteProjectFromState(state, projectId));
      const timeoutResult = createProbeTimeout();
      for (const [key, probe] of probes) {
        if (probe.command.projectId !== projectId) continue;
        probes.delete(key);
        for (const waiter of probe.waiters) waiter(timeoutResult);
      }
      for (const [verifyId, session] of verifySessions) {
        if (session.projectId === projectId) verifySessions.delete(verifyId);
      }
      webhookDeliveries = webhookDeliveries.filter((delivery) => !deletion.forwarderIds.has(delivery.webhookId));
    },
    listCommands: async () => write(() => {
      const nextState = expireActiveCommands(state, options.now());
      return { state: nextState, result: nextState.commands };
    }),
    verifyProjectToken: async (projectId: string, token: string) => requireProjectToken(state, projectId, token),
    resetToken: async (projectId: string) => write(() => {
      requireProject(state, projectId);
      const token = options.createToken();
      return { state: updateAppState(state, { projects: state.projects.map((project) => projectMatches(project, projectId) ? { ...project, token, updatedAt: options.now() } : project) }), result: token };
    }),
    listDevices: async (projectId: string | null) => projectId === null || projectId.length === 0 ? state.devices : state.devices.filter((device) => device.projectId === projectId),
    getDevice: async (projectId: string, deviceId: string) => state.devices.find((device) => deviceMatches(device, projectId, deviceId)) ?? null,
    markDeviceSeen: async (projectId: string, deviceId: string) => write(() => markDeviceSeenInState(state, projectId, deviceId, options.now())),
    markDeviceHeartbeat: async (projectId: string, deviceId: string) => write(() => markDeviceHeartbeatInState(state, projectId, deviceId, options.now())),
    saveReport: async (input: DeviceReportInput) => {
      const result = await (async (): Promise<DeviceReportSaveResult> => {
        const reportedAt = options.now();
        const saved = await write(() => {
          const reportUpdate = applyReport(state, input, reportedAt, false);
          const bucketState = addRealReportBucket(reportUpdate.state, input, reportedAt);
          const shadowState = updateShadowReported(bucketState, input, reportedAt);
          const commandUpdate = applyCommandStateReport(shadowState, input, reportedAt);
          return { state: commandUpdate.state, result: { device: reportUpdate.result, stateConfirmed: commandUpdate.result } };
        });
        resolveVerifySessions(input, reportedAt);
        return saved;
      })();
      return result.device;
    },
    saveReportWithCommandState: async (input: DeviceReportInput) => {
      const reportedAt = options.now();
      const result = await write(() => {
        const reportUpdate = applyReport(state, input, reportedAt, false);
        const bucketState = addRealReportBucket(reportUpdate.state, input, reportedAt);
        const shadowState = updateShadowReported(bucketState, input, reportedAt);
        const commandUpdate = applyCommandStateReport(shadowState, input, reportedAt);
        return { state: commandUpdate.state, result: { device: reportUpdate.result, stateConfirmed: commandUpdate.result } };
      });
      resolveVerifySessions(input, reportedAt);
      return result;
    },
    registerDevice: async (projectId: string, deviceId: string) => write(() => registerDevice(state, projectId, deviceId, options.now())),
    enqueueCommand: async (projectId: string, deviceId: string, input: DeviceCommandInput) => (await write(() => appendCommand(state, projectId, deviceId, input, options.createId(), options.now(), configuredCommandTtlMs))).command,
    enqueueCommands: async (projectId: string, deviceIds: readonly string[], input: DeviceCommandInput) => (await write(() => appendCommands(state, projectId, deviceIds, input, options.createId, options.now(), configuredCommandTtlMs))).commands,
    enqueueCommandWithResult: async (projectId: string, deviceId: string, input: DeviceCommandInput) => write(() => appendCommand(state, projectId, deviceId, input, options.createId(), options.now(), configuredCommandTtlMs)),
    enqueueCommandsWithResult: async (projectId: string, deviceIds: readonly string[], input: DeviceCommandInput) => write(() => appendCommands(state, projectId, deviceIds, input, options.createId, options.now(), configuredCommandTtlMs)),
    expireCommands: async () => write(() => {
      const update = advanceCommandLifecycleInState(state, options.now(), lifecycleSettings);
      return { state: update.state, result: update.result.expired };
    }),
    listPendingCommands: async (projectId: string, deviceId: string) => write(() => {
      const nextState = expireActiveCommands(state, options.now());
      return { state: nextState, result: sortByCreatedAt(nextState.commands.filter((command) => command.projectId === projectId && command.deviceId === deviceId && isDispatchableCommand(command.status))) };
    }),
    getNextCommand: async (projectId: string, deviceId: string) => write(() => {
      const now = options.now();
      const nextState = expireActiveCommands(state, now);
      const firstActive = sortByCreatedAt(nextState.commands).find((candidate) => {
        if (candidate.projectId !== projectId || candidate.deviceId !== deviceId || !isActiveCommand(candidate.status)) return false;
        return candidate.status !== "acked" || candidate.name === "set_light";
      });
      const command = firstActive === undefined || !isDispatchableCommand(firstActive.status) ? undefined : firstActive;
      return { state: nextState, result: command === undefined ? { hasCommand: false } : { hasCommand: true, command } };
    }),
    getCommand: async (projectId: string, deviceId: string, commandId: string) => state.commands.find((command) => commandMatches(command, projectId, deviceId, commandId)) ?? null,
    markCommandDispatched: async (projectId: string, deviceId: string, commandId: string) => write(() => markCommandDispatchedInState(state, projectId, deviceId, commandId, options.now())),
    markCommandDispatchFailed: async (projectId: string, deviceId: string, commandId: string) => write(() => markCommandDispatchFailedInState(state, projectId, deviceId, commandId, options.now())),
    acknowledgeCommand: async (projectId: string, deviceId: string, commandId: string) => {
      const acknowledgement = await write(() => {
        const now = options.now();
        const acknowledgementUpdate = markCommandAcknowledged(state, projectId, deviceId, commandId, now);
        if (acknowledgementUpdate.result.outcome === "expired") return acknowledgementUpdate;
        return { state: markDeviceAckInState(acknowledgementUpdate.state, projectId, deviceId, now), result: acknowledgementUpdate.result };
      });
      if (acknowledgement.outcome === "expired") {
        throw createAppError(409, "COMMAND_EXPIRED", "Command has expired and can no longer be acknowledged.", { projectId, deviceId, commandId });
      }
      return acknowledgement.command;
    },
    advanceCommandLifecycle: async () => write(() => advanceCommandLifecycleInState(state, options.now(), lifecycleSettings)),
    enqueueProbe: async (projectId: string, deviceId: string, payload: JsonObject) => {
      await writeChain;
      requireProject(state, projectId);
      const key = createProbeKey(projectId, deviceId);
      const existing = probes.get(key);
      if (existing !== undefined && existing.result === null) {
        throw createAppError(409, "PROBE_ALREADY_RUNNING", "A device probe is already running for this device.", { projectId, deviceId, commandId: existing.command.id });
      }
      const createdAt = options.now();
      const command = createQueuedCommand(projectId, deviceId, { name: "__probe__", payload }, options.createId(), createdAt, configuredCommandTtlMs);
      probes.set(key, { command, result: null, transport: null, waiters: [] });
      return command;
    },
    setProbeTransport: async (projectId: string, deviceId: string, commandId: string, transport: ProbeTransport) => {
      const key = createProbeKey(projectId, deviceId);
      const probe = probes.get(key);
      if (probe === undefined || probe.command.id !== commandId || probe.result !== null) return;
      probes.set(key, { ...probe, transport });
    },
    listPendingProbes: async (projectId: string, deviceId: string) => {
      const probe = probes.get(createProbeKey(projectId, deviceId));
      return probe === undefined || probe.result !== null ? [] : [probe.command];
    },
    acknowledgeProbe: async (projectId: string, deviceId: string, commandId: string, transport: ProbeTransport) => {
      const key = createProbeKey(projectId, deviceId);
      const probe = probes.get(key);
      if (probe === undefined || probe.command.id !== commandId || probe.result !== null) return null;
      await write(() => ({ state: markDeviceSeenIfExists(state, projectId, deviceId, options.now()), result: undefined }));
      const checkedAt = options.now();
      const latencyMs = Math.max(0, Date.parse(checkedAt) - Date.parse(probe.command.createdAt));
      const result: ProbeResult = { reachable: true, latencyMs: Number.isFinite(latencyMs) ? latencyMs : null, transport: probe.transport ?? transport, checkedAt };
      probes.set(key, { ...probe, result, waiters: [] });
      for (const waiter of probe.waiters) waiter(result);
      return result;
    },
    waitForProbe: async (projectId: string, deviceId: string, commandId: string, timeoutMs: number) => {
      const key = createProbeKey(projectId, deviceId);
      const probe = probes.get(key);
      if (probe === undefined || probe.command.id !== commandId) throw createAppError(404, "PROBE_NOT_FOUND", "Probe was not found for this device.", { projectId, deviceId, commandId });
      if (probe.result !== null) return probe.result;
      return new Promise<ProbeResult>((resolve) => {
        const timeout = setTimeout(() => {
          const current = probes.get(key);
          if (current === undefined || current.command.id !== commandId || current.result !== null) return;
          const result = createProbeTimeout();
          probes.set(key, { ...current, result, waiters: [] });
          for (const waiter of current.waiters) waiter(result);
        }, timeoutMs);
        const waiter = (result: ProbeResult): void => { clearTimeout(timeout); resolve(result); };
        probes.set(key, { ...probe, waiters: [...probe.waiters, waiter] });
      });
    },
    getProbeStatus: async (projectId: string, deviceId: string) => probes.get(createProbeKey(projectId, deviceId))?.result ?? null,
    createAgentKey: async (projectId: string, label: string) => write(() => {
      requireProject(state, projectId);
      const key: AgentKeyRecord = { id: options.createId(), projectId, key: options.createToken(), label, createdAt: options.now(), lastUsedAt: null };
      return { state: updateAppState(state, { agentKeys: [...state.agentKeys, key] }), result: key };
    }),
    listAgentKeys: async (projectId: string) => state.agentKeys.filter((key) => key.projectId === projectId),
    deleteAgentKey: async (projectId: string, keyId: string) => write(() => {
      const existing = state.agentKeys.find((key) => key.projectId === projectId && key.id === keyId);
      if (existing === undefined) throw createAppError(404, "AGENT_KEY_NOT_FOUND", "Agent key was not found for this project.", { projectId, keyId });
      return { state: updateAppState(state, { agentKeys: state.agentKeys.filter((key) => key !== existing) }), result: undefined };
    }),
    verifyAgentKey: async (projectId: string, key: string) => write(() => {
      const project = requireProject(state, projectId);
      const existing = state.agentKeys.find((agentKey) => agentKey.projectId === projectId && agentKey.key === key);
      if (existing === undefined) throw createAppError(401, "INVALID_AGENT_KEY", "Agent key is invalid.", { projectId });
      const usedKey: AgentKeyRecord = { ...existing, lastUsedAt: options.now() };
      return {
        state: updateAppState(state, { agentKeys: state.agentKeys.map((agentKey) => agentKey === existing ? usedKey : agentKey) }),
        result: project
      };
    }),
    touchAgentKey: async (projectId: string, keyId: string) => write(() => {
      const existing = state.agentKeys.find((key) => key.projectId === projectId && key.id === keyId);
      if (existing === undefined) throw createAppError(404, "AGENT_KEY_NOT_FOUND", "Agent key was not found for this project.", { projectId, keyId });
      return { state: updateAppState(state, { agentKeys: state.agentKeys.map((key) => key === existing ? { ...key, lastUsedAt: options.now() } : key) }), result: undefined };
    }),
    saveDeviceMetadata: async (projectId: string, deviceId: string, metadata: DeviceMetadata) => write(() => {
      requireProject(state, projectId);
      return { state: updateAppState(state, { deviceMetadata: { ...state.deviceMetadata, [createDeviceKey(projectId, deviceId)]: metadata } }), result: undefined };
    }),
    getDeviceMetadata: async (projectId: string, deviceId: string) => state.deviceMetadata[createDeviceKey(projectId, deviceId)] ?? null,
    registerDeviceV2: async (input: DeviceRegistrationInputV2) => write(() => {
      const now = options.now();
      const deviceUpdate = registerDevice(state, input.projectId, input.deviceId, now);
      const key = createDeviceKey(input.projectId, input.deviceId);
      const existing = deviceUpdate.state.deviceMetadata[key] ?? createDefaultMetadata(input.deviceId);
      const metadata: DeviceMetadata = {
        name: input.name ?? existing.name,
        type: input.type ?? existing.type,
        location: input.location ?? existing.location,
        metadata: input.metadata ?? existing.metadata,
        template: input.template ?? existing.template
      };
      const nextState = updateAppState(deviceUpdate.state, { deviceMetadata: { ...deviceUpdate.state.deviceMetadata, [key]: metadata } });
      return { state: nextState, result: createEnhancedDevice(deviceUpdate.result, metadata) };
    }),
    startVerify: async (projectId: string, deviceId: string, timeoutMs: number) => {
      await writeChain;
      requireProject(state, projectId);
      const startedAt = options.now();
      const session: VerifySession = { id: options.createId(), projectId, deviceId, status: "waiting", startedAt, completedAt: null, result: null };
      verifySessions.set(session.id, session);
      const timeout = setTimeout(() => {
        const current = verifySessions.get(session.id);
        if (current === undefined || current.status !== "waiting") return;
        const completedAt = options.now();
        verifySessions.set(session.id, { ...current, status: "timeout", completedAt, result: createVerifyTimeoutResult() });
      }, timeoutMs);
      timeout.unref();
      return session;
    },
    checkVerify: async (projectId: string, deviceId: string, verifyId: string) => {
      const session = verifySessions.get(verifyId);
      if (session === undefined || session.projectId !== projectId || session.deviceId !== deviceId) throw createAppError(404, "VERIFY_NOT_FOUND", "Verification session was not found for this device.", { projectId, deviceId, verifyId });
      return session;
    },
    getDeviceStatusSummary: async (projectId: string, typeFilter?: string) => {
      const now = options.now();
      const devices = state.devices.filter((device) => {
        if (device.projectId !== projectId) return false;
        const metadata = state.deviceMetadata[createDeviceKey(projectId, device.deviceId)] ?? createDefaultMetadata(device.deviceId);
        return typeFilter === undefined || metadata.type === typeFilter;
      });
      const online = devices.filter((device) => isDeviceOnline(device, now)).length;
      const alarmActive = devices.reduce((count, device) => count + device.lastReport.alarms.filter((alarm) => alarm.active).length, 0);
      const byType: Record<string, number> = {};
      for (const device of devices) {
        const metadata = state.deviceMetadata[createDeviceKey(projectId, device.deviceId)] ?? createDefaultMetadata(device.deviceId);
        const type = metadata.type.length === 0 ? "unknown" : metadata.type;
        byType[type] = (byType[type] ?? 0) + 1;
      }
      return { total: devices.length, online, offline: devices.length - online, alarmActive, byType };
    },
    listDeviceStatuses: async (projectId: string) => {
      const now = options.now();
      return state.devices.filter((device) => device.projectId === projectId).map((device) => {
        const metadata = state.deviceMetadata[createDeviceKey(projectId, device.deviceId)] ?? createDefaultMetadata(device.deviceId);
        return { deviceId: device.deviceId, online: isDeviceOnline(device, now), lastSeenAt: device.lastSeenAt, name: metadata.name, type: metadata.type, alarmCount: device.lastReport.alarms.filter((alarm) => alarm.active).length };
      });
    },
    getDashboardSnapshot: async (projectId: string) => write(() => {
      const now = options.now();
      const nextState = expireActiveCommands(state, now);
      return { state: nextState, result: createDashboardSnapshot(nextState, projectId, now) };
    }),
    getShadow: async (projectId: string, deviceId: string) => state.shadows[createDeviceKey(projectId, deviceId)] ?? createShadow(projectId, deviceId, options.now()),
    updateShadowDesired: async (projectId: string, deviceId: string, desired: JsonObject) => write(() => {
      requireProject(state, projectId);
      const now = options.now();
      const key = createDeviceKey(projectId, deviceId);
      const current = state.shadows[key] ?? createShadow(projectId, deviceId, now);
      const shadow: DeviceShadow = { ...current, desired, delta: calculateDelta(desired, current.reported), version: current.version + 1, updatedAt: now };
      return { state: updateAppState(state, { shadows: { ...state.shadows, [key]: shadow } }), result: shadow };
    }),
    createRule: async (projectId: string, input: RuleInput) => write(() => {
      requireProject(state, projectId);
      const rule: RuleRecord = { id: options.createId(), projectId, ...input, sourceDeviceIds: input.sourceDeviceIds ?? [], lastTriggeredAt: null, createdAt: options.now() };
      return { state: updateAppState(state, { rules: [...state.rules, rule] }), result: rule };
    }),
    listRules: async (projectId: string) => state.rules.filter((rule) => rule.projectId === projectId),
    updateRule: async (projectId: string, ruleId: string, input: RuleInput) => write(() => {
      const existing = state.rules.find((rule) => rule.projectId === projectId && rule.id === ruleId);
      if (existing === undefined) throw createAppError(404, "RULE_NOT_FOUND", "Rule was not found for this project.", { projectId, ruleId });
      const rule: RuleRecord = { ...existing, ...input, sourceDeviceIds: input.sourceDeviceIds ?? existing.sourceDeviceIds };
      return { state: updateAppState(state, { rules: state.rules.map((candidate) => candidate === existing ? rule : candidate) }), result: rule };
    }),
    deleteRule: async (projectId: string, ruleId: string) => write(() => {
      const existing = state.rules.find((rule) => rule.projectId === projectId && rule.id === ruleId);
      if (existing === undefined) throw createAppError(404, "RULE_NOT_FOUND", "Rule was not found for this project.", { projectId, ruleId });
      const ruleTriggerTimes = omitRuleTriggerTimes(state.ruleTriggerTimes, new Set([ruleId]));
      return { state: updateAppState(state, { rules: state.rules.filter((rule) => rule !== existing), ruleTriggerTimes }), result: undefined };
    }),
    evaluateRules: async (projectId: string, deviceId: string, report: DeviceReportInput) => write(() => evaluateRulesInState(state, projectId, deviceId, report, options.now())),
    createForwarder: async (projectId: string, input: ForwarderInput) => write(() => {
      requireProject(state, projectId);
      const forwarder: ForwarderRecord = { id: options.createId(), projectId, ...input, createdAt: options.now() };
      return { state: updateAppState(state, { forwarders: [...state.forwarders, forwarder] }), result: forwarder };
    }),
    listForwarders: async (projectId: string) => state.forwarders.filter((forwarder) => forwarder.projectId === projectId),
    updateForwarder: async (projectId: string, forwarderId: string, input: ForwarderInput) => write(() => {
      const existing = state.forwarders.find((forwarder) => forwarder.projectId === projectId && forwarder.id === forwarderId);
      if (existing === undefined) throw createAppError(404, "FORWARDER_NOT_FOUND", "Forwarder was not found for this project.", { projectId, forwarderId });
      const forwarder: ForwarderRecord = { ...existing, ...input };
      return { state: updateAppState(state, { forwarders: state.forwarders.map((candidate) => candidate === existing ? forwarder : candidate) }), result: forwarder };
    }),
    deleteForwarder: async (projectId: string, forwarderId: string) => write(() => {
      const existing = state.forwarders.find((forwarder) => forwarder.projectId === projectId && forwarder.id === forwarderId);
      if (existing === undefined) throw createAppError(404, "FORWARDER_NOT_FOUND", "Forwarder was not found for this project.", { projectId, forwarderId });
      return { state: updateAppState(state, { forwarders: state.forwarders.filter((forwarder) => forwarder !== existing) }), result: undefined };
    }),
    addFirmware: async (projectId: string, firmwareData: FirmwareData) => write(() => {
      requireProject(state, projectId);
      const firmware: FirmwareRecord = { id: options.createId(), projectId, ...firmwareData, uploadedAt: options.now() };
      return { state: updateAppState(state, { firmware: [...state.firmware, firmware] }), result: firmware };
    }),
    listFirmware: async (projectId: string) => state.firmware.filter((firmware) => firmware.projectId === projectId),
    deleteFirmware: async (projectId: string, firmwareId: string) => write(() => {
      const existing = state.firmware.find((firmware) => firmware.projectId === projectId && firmware.id === firmwareId);
      if (existing === undefined) throw createAppError(404, "FIRMWARE_NOT_FOUND", "Firmware was not found for this project.", { projectId, firmwareId });
      if (state.otaTasks.some((task) => task.projectId === projectId && task.firmwareId === firmwareId)) {
        throw createAppError(409, "FIRMWARE_IN_USE", "Firmware is still referenced by an OTA task and cannot be deleted.", { projectId, firmwareId });
      }
      return { state: updateAppState(state, { firmware: state.firmware.filter((firmware) => firmware !== existing) }), result: undefined };
    }),
    createOTATask: async (projectId: string, deviceId: string, firmwareId: string) => write(() => {
      return appendOTATask(state, projectId, deviceId, firmwareId, options.createId(), options.now());
    }),
    createOTATaskWithCommand: async (projectId: string, deviceId: string, firmwareId: string, commandInput: DeviceCommandInput) => write(() => {
      const now = options.now();
      const otaUpdate = appendOTATask(state, projectId, deviceId, firmwareId, options.createId(), now);
      const commandUpdate = appendCommand(otaUpdate.state, projectId, deviceId, {
        ...commandInput,
        payload: { ...commandInput.payload, otaId: otaUpdate.result.id }
      }, options.createId(), now, configuredCommandTtlMs);
      return { state: commandUpdate.state, result: { ota: otaUpdate.result, command: commandUpdate.result.command } };
    }),
    listOTATasks: async (projectId: string, deviceId: string) => state.otaTasks
      .filter((task) => task.projectId === projectId && task.deviceId === deviceId)
      .slice()
      .reverse(),
    updateOTATask: async (projectId: string, deviceId: string, otaId: string, status: OTATask["status"], progress: number) => write(() => {
      const existing = state.otaTasks.find((task) => task.projectId === projectId && task.deviceId === deviceId && task.id === otaId);
      if (existing === undefined) throw createAppError(404, "OTA_TASK_NOT_FOUND", "OTA task was not found for this device.", { projectId, deviceId, otaId });
      const completedAt = status === "success" || status === "failed" ? options.now() : null;
      const task: OTATask = { ...existing, status, progress, completedAt };
      return { state: updateAppState(state, { otaTasks: state.otaTasks.map((candidate) => candidate === existing ? task : candidate) }), result: task };
    }),
    getOTATask: async (projectId: string, deviceId: string, otaId: string) => state.otaTasks.find((task) => task.projectId === projectId && task.deviceId === deviceId && task.id === otaId) ?? null,
    simulateReport: async (input: SimulateInput) => {
      const existing = state.devices.find((device) => deviceMatches(device, input.projectId, input.deviceId));
      if (existing?.activityConfirmed === true && existing.simulated !== true) {
        throw createAppError(409, "SIMULATION_DEVICE_CONFLICT", "A confirmed real device cannot be overwritten by simulated data.", { projectId: input.projectId, deviceId: input.deviceId });
      }
      const report: DeviceReportInput = {
        projectId: input.projectId,
        token: input.token,
        deviceId: input.deviceId,
        values: input.values ?? existing?.lastReport.values ?? [],
        relays: input.relays ?? existing?.lastReport.relays ?? [],
        alarms: input.alarms ?? existing?.lastReport.alarms ?? []
      };
      const reportedAt = options.now();
      return write(() => applyReport(state, report, reportedAt, true));
    },
    logWebhookDelivery: async (webhookId: string, eventType: string, status: WebhookDelivery["status"], statusCode: number | null, durationMs: number) => {
      const delivery: WebhookDelivery = { id: options.createId(), webhookId, eventType, status, statusCode, durationMs, deliveredAt: options.now() };
      webhookDeliveries = [...webhookDeliveries, delivery].slice(-1_000);
      return delivery;
    },
    flush,
    close: async () => {
      if (!closed) {
        closed = true;
        clearInterval(flushTimer);
      }
      await flush();
    }
  };
};
