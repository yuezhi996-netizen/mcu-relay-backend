import type { JsonObject, JsonValue } from "../types";

export type ProjectAccess = {
  readonly projectId: string;
  readonly token: string;
};

export type AgentKeySummary = {
  readonly id: string;
  readonly projectId: string;
  readonly label: string;
  readonly keyPreview: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
};

export type CreatedAgentKey = {
  readonly id: string;
  readonly projectId: string;
  readonly label: string;
  readonly key: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
};

export type RuleOperator = ">" | "<" | ">=" | "<=" | "==" | "!=";
export type AutomationRuleCondition = {
  readonly field: string;
  readonly operator: RuleOperator;
  readonly value: string | number | boolean;
};
export type AutomationRuleAction = {
  readonly deviceId: string;
  readonly command: {
    readonly name: string;
    readonly payload: JsonObject;
  };
};
export type AutomationRuleInput = {
  readonly name: string;
  readonly enabled: boolean;
  readonly sourceDeviceIds: readonly string[];
  readonly conditions: readonly AutomationRuleCondition[];
  readonly logic: "all" | "any";
  readonly actions: readonly AutomationRuleAction[];
  readonly cooldownMs: number;
};
export type AutomationRuleRecord = AutomationRuleInput & {
  readonly id: string;
  readonly projectId: string;
  readonly lastTriggeredAt: string | null;
  readonly createdAt: string;
};

export type ForwarderFilter = {
  readonly deviceIds: readonly string[];
  readonly keys: readonly string[];
};
export type AutomationForwarderInput = {
  readonly name: string;
  readonly type: "webhook";
  readonly enabled: boolean;
  readonly config: { readonly url: string };
  readonly filter: ForwarderFilter;
};
export type AutomationForwarderRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly type: "webhook" | "mqtt";
  readonly enabled: boolean;
  readonly url: string | null;
  readonly filter: ForwarderFilter | null;
  readonly createdAt: string;
};

export type FirmwareInput = {
  readonly version: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly md5: string;
  readonly downloadUrl: string;
};
export type FirmwareRecord = FirmwareInput & {
  readonly id: string;
  readonly projectId: string;
  readonly uploadedAt: string;
};

export type OtaStatus = "pending" | "downloading" | "installing" | "success" | "failed";
export type OtaTask = {
  readonly id: string;
  readonly projectId: string;
  readonly deviceId: string;
  readonly firmwareId: string;
  readonly status: OtaStatus;
  readonly progress: number;
  readonly createdAt: string;
  readonly completedAt: string | null;
};

const readProperty = (value: object, key: string): unknown => key in value ? Reflect.get(value, key) as unknown : undefined;
const expectObject = (value: unknown, label: string): object => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} 必须是对象。`);
  return value;
};
const expectArray = (value: unknown, label: string): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组。`);
  return value;
};
const expectString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} 必须是非空字符串。`);
  return value;
};
const expectTimestamp = (value: unknown, label: string): string => {
  const timestamp = expectString(value, label);
  if (Number.isNaN(Date.parse(timestamp))) throw new Error(`${label} 必须是有效时间。`);
  return timestamp;
};
const expectBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean") throw new Error(`${label} 必须是布尔值。`);
  return value;
};
const expectNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} 必须是有限数字。`);
  return value;
};
const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.keys(value).every((key) => isJsonValue(readProperty(value, key)));
};
const expectJsonObject = (value: unknown, label: string): JsonObject => {
  const object = expectObject(value, label);
  if (!isJsonValue(object)) throw new Error(`${label} 包含非 JSON 数据。`);
  return object as JsonObject;
};
const expectStringArray = (value: unknown, label: string): readonly string[] => expectArray(value, label).map((item, index) => expectString(item, `${label}[${index}]`));

export const parseJsonObjectText = (text: string, label: string): JsonObject => {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new Error(`${label} JSON 格式无效：${error instanceof Error ? error.message : "无法解析"}`);
  }
  return expectJsonObject(value, label);
};

const parseCondition = (value: unknown, label: string): AutomationRuleCondition => {
  const object = expectObject(value, label);
  const operator = expectString(readProperty(object, "operator"), `${label}.operator`);
  if (operator !== ">" && operator !== "<" && operator !== ">=" && operator !== "<=" && operator !== "==" && operator !== "!=") throw new Error(`${label}.operator 必须是 >、<、>=、<=、== 或 !=。`);
  const conditionValue = readProperty(object, "value");
  if (typeof conditionValue !== "string" && typeof conditionValue !== "number" && typeof conditionValue !== "boolean") throw new Error(`${label}.value 必须是字符串、数字或布尔值。`);
  return { field: expectString(readProperty(object, "field"), `${label}.field`), operator, value: conditionValue };
};
const parseAction = (value: unknown, label: string): AutomationRuleAction => {
  const object = expectObject(value, label);
  const command = expectObject(readProperty(object, "command"), `${label}.command`);
  return {
    deviceId: expectString(readProperty(object, "deviceId"), `${label}.deviceId`),
    command: {
      name: expectString(readProperty(command, "name"), `${label}.command.name`),
      payload: expectJsonObject(readProperty(command, "payload"), `${label}.command.payload`)
    }
  };
};
export const parseRuleConditionsText = (text: string): readonly AutomationRuleCondition[] => {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new Error(`条件 JSON 格式无效：${error instanceof Error ? error.message : "无法解析"}`);
  }
  const conditions = expectArray(value, "条件").map((item, index) => parseCondition(item, `条件[${index}]`));
  if (conditions.length === 0) throw new Error("条件至少需要一项，否则规则会无条件触发。");
  return conditions;
};
export const parseRuleActionsText = (text: string): readonly AutomationRuleAction[] => {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new Error(`动作 JSON 格式无效：${error instanceof Error ? error.message : "无法解析"}`);
  }
  const actions = expectArray(value, "动作").map((item, index) => parseAction(item, `动作[${index}]`));
  if (actions.length === 0) throw new Error("动作至少需要一项。");
  return actions;
};

const parseRule = (value: unknown, index: number): AutomationRuleRecord => {
  const label = `规则[${index}]`;
  const object = expectObject(value, label);
  const logic = expectString(readProperty(object, "logic"), `${label}.logic`);
  if (logic !== "all" && logic !== "any") throw new Error(`${label}.logic 必须是 all 或 any。`);
  const cooldownMs = expectNumber(readProperty(object, "cooldownMs"), `${label}.cooldownMs`);
  if (!Number.isInteger(cooldownMs) || cooldownMs < 0) throw new Error(`${label}.cooldownMs 必须是非负整数。`);
  const sourceDeviceIdsValue = readProperty(object, "sourceDeviceIds");
  return {
    id: expectString(readProperty(object, "id"), `${label}.id`),
    projectId: expectString(readProperty(object, "projectId"), `${label}.projectId`),
    name: expectString(readProperty(object, "name"), `${label}.name`),
    enabled: expectBoolean(readProperty(object, "enabled"), `${label}.enabled`),
    sourceDeviceIds: sourceDeviceIdsValue === undefined ? [] : expectStringArray(sourceDeviceIdsValue, `${label}.sourceDeviceIds`),
    conditions: expectArray(readProperty(object, "conditions"), `${label}.conditions`).map((item, conditionIndex) => parseCondition(item, `${label}.conditions[${conditionIndex}]`)),
    logic,
    actions: expectArray(readProperty(object, "actions"), `${label}.actions`).map((item, actionIndex) => parseAction(item, `${label}.actions[${actionIndex}]`)),
    cooldownMs,
    lastTriggeredAt: readProperty(object, "lastTriggeredAt") === null ? null : expectTimestamp(readProperty(object, "lastTriggeredAt"), `${label}.lastTriggeredAt`),
    createdAt: expectTimestamp(readProperty(object, "createdAt"), `${label}.createdAt`)
  };
};
export const parseRules = (value: unknown): readonly AutomationRuleRecord[] => expectArray(value, "规则列表").map(parseRule);
export const parseCreatedRule = (value: unknown): AutomationRuleRecord => parseRule(value, 0);

const parseAgentKeySummary = (value: unknown, index: number): AgentKeySummary => {
  const label = `Agent Key[${index}]`;
  const object = expectObject(value, label);
  return {
    id: expectString(readProperty(object, "id"), `${label}.id`),
    projectId: expectString(readProperty(object, "projectId"), `${label}.projectId`),
    label: expectString(readProperty(object, "label"), `${label}.label`),
    keyPreview: expectString(readProperty(object, "keyPreview"), `${label}.keyPreview`),
    createdAt: expectTimestamp(readProperty(object, "createdAt"), `${label}.createdAt`),
    lastUsedAt: readProperty(object, "lastUsedAt") === null ? null : expectTimestamp(readProperty(object, "lastUsedAt"), `${label}.lastUsedAt`)
  };
};
export const parseAgentKeySummaries = (value: unknown): readonly AgentKeySummary[] => expectArray(value, "Agent Key 列表").map(parseAgentKeySummary);
export const parseCreatedAgentKey = (value: unknown): CreatedAgentKey => {
  const object = expectObject(value, "新 Agent Key");
  return {
    id: expectString(readProperty(object, "id"), "新 Agent Key.id"),
    projectId: expectString(readProperty(object, "projectId"), "新 Agent Key.projectId"),
    label: expectString(readProperty(object, "label"), "新 Agent Key.label"),
    key: expectString(readProperty(object, "key"), "新 Agent Key.key"),
    createdAt: expectTimestamp(readProperty(object, "createdAt"), "新 Agent Key.createdAt"),
    lastUsedAt: readProperty(object, "lastUsedAt") === null ? null : expectTimestamp(readProperty(object, "lastUsedAt"), "新 Agent Key.lastUsedAt")
  };
};

const parseFilter = (value: unknown, label: string): ForwarderFilter | null => {
  if (value === null) return null;
  const object = expectObject(value, label);
  return {
    deviceIds: expectStringArray(readProperty(object, "deviceIds"), `${label}.deviceIds`),
    keys: expectStringArray(readProperty(object, "keys"), `${label}.keys`)
  };
};
const parseForwarder = (value: unknown, index: number): AutomationForwarderRecord => {
  const label = `转发器[${index}]`;
  const object = expectObject(value, label);
  const type = expectString(readProperty(object, "type"), `${label}.type`);
  if (type !== "webhook" && type !== "mqtt") throw new Error(`${label}.type 必须是 webhook 或 mqtt。`);
  const config = expectJsonObject(readProperty(object, "config"), `${label}.config`);
  const url = type === "webhook" ? parseHttpUrl(expectString(config.url, `${label}.config.url`), `${label}.config.url`) : null;
  return {
    id: expectString(readProperty(object, "id"), `${label}.id`),
    projectId: expectString(readProperty(object, "projectId"), `${label}.projectId`),
    name: expectString(readProperty(object, "name"), `${label}.name`),
    type,
    enabled: expectBoolean(readProperty(object, "enabled"), `${label}.enabled`),
    url,
    filter: parseFilter(readProperty(object, "filter"), `${label}.filter`),
    createdAt: expectTimestamp(readProperty(object, "createdAt"), `${label}.createdAt`)
  };
};
export const parseWebhookForwarders = (value: unknown): readonly AutomationForwarderRecord[] => expectArray(value, "转发器列表").map(parseForwarder).filter((forwarder) => forwarder.type === "webhook");
export const parseCreatedForwarder = (value: unknown): AutomationForwarderRecord => parseForwarder(value, 0);

const parseFirmware = (value: unknown, index: number): FirmwareRecord => {
  const label = `固件[${index}]`;
  const object = expectObject(value, label);
  const fileSize = expectNumber(readProperty(object, "fileSize"), `${label}.fileSize`);
  if (!Number.isInteger(fileSize) || fileSize < 0) throw new Error(`${label}.fileSize 必须是非负整数。`);
  return {
    id: expectString(readProperty(object, "id"), `${label}.id`),
    projectId: expectString(readProperty(object, "projectId"), `${label}.projectId`),
    version: expectString(readProperty(object, "version"), `${label}.version`),
    fileName: expectString(readProperty(object, "fileName"), `${label}.fileName`),
    fileSize,
    md5: expectString(readProperty(object, "md5"), `${label}.md5`),
    downloadUrl: parseHttpUrl(expectString(readProperty(object, "downloadUrl"), `${label}.downloadUrl`), `${label}.downloadUrl`),
    uploadedAt: expectTimestamp(readProperty(object, "uploadedAt"), `${label}.uploadedAt`)
  };
};
export const parseFirmwareList = (value: unknown): readonly FirmwareRecord[] => expectArray(value, "固件列表").map(parseFirmware);
export const parseCreatedFirmware = (value: unknown): FirmwareRecord => parseFirmware(value, 0);

export const parseHttpUrl = (value: string, label: string): string => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${label} 必须是有效 URL。`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${label} 必须使用 HTTP 或 HTTPS。`);
  if (url.username.length > 0 || url.password.length > 0) throw new Error(`${label} 不能包含内嵌账号或密码。`);
  return url.toString();
};

export const parseCommaSeparatedList = (value: string): readonly string[] => [...new Set(value.split(",").map((item) => item.trim()).filter((item) => item.length > 0))];

export const parseOtaTask = (value: unknown): OtaTask => {
  const object = expectObject(value, "OTA 任务");
  const status = expectString(readProperty(object, "status"), "OTA 任务.status");
  if (status !== "pending" && status !== "downloading" && status !== "installing" && status !== "success" && status !== "failed") throw new Error("OTA 任务.status 无效。");
  const progress = expectNumber(readProperty(object, "progress"), "OTA 任务.progress");
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new Error("OTA 任务.progress 必须是 0 到 100 的整数。");
  return {
    id: expectString(readProperty(object, "id"), "OTA 任务.id"),
    projectId: expectString(readProperty(object, "projectId"), "OTA 任务.projectId"),
    deviceId: expectString(readProperty(object, "deviceId"), "OTA 任务.deviceId"),
    firmwareId: expectString(readProperty(object, "firmwareId"), "OTA 任务.firmwareId"),
    status,
    progress,
    createdAt: expectTimestamp(readProperty(object, "createdAt"), "OTA 任务.createdAt"),
    completedAt: readProperty(object, "completedAt") === null ? null : expectTimestamp(readProperty(object, "completedAt"), "OTA 任务.completedAt")
  };
};
