import { createAppError } from "./errors.js";
import type {
  AlarmState,
  BatchDeviceCommandInput,
  BatchDeviceReportInput,
  DeviceImportInput,
  DeviceRegistrationInput,
  DeviceRegistrationInputV2,
  DataValue,
  DeviceCommandAckInput,
  DeviceCommandInput,
  DeviceReportInput,
  DeviceTemplate,
  DeviceTemplateAlarm,
  DeviceTemplateRelay,
  DeviceTemplateValue,
  DeviceValue,
  ForwarderInput,
  ForwarderType,
  JsonObject,
  JsonValue,
  ProjectAccountRegistrationInput,
  ProjectAccountReviewInput,
  ProjectInput,
  ProjectNameInput,
  RemoteDebugDataInput,
  RemoteDebugWriteInput,
  RelayOutput,
  RelayState,
  RuleAction,
  RuleCondition,
  RuleInput,
  SimulateInput,
  AIChatMessage,
  AIChatRequest,
  VerifyRequest,
} from "./types.js";

export const isJsonObject = (value: JsonValue): value is JsonObject => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const getRequiredString = (source: JsonObject, fieldName: string): string => {
  const value = source[fieldName];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw createAppError(400, "INVALID_FIELD", `${fieldName} must be a non-empty string.`, {
      field: fieldName
    });
  }

  return value.trim();
};

const getRequiredText = (source: JsonObject, fieldName: string): string => {
  const value = source[fieldName];
  if (typeof value !== "string") {
    throw createAppError(400, "INVALID_FIELD", `${fieldName} must be a string.`, {
      field: fieldName
    });
  }

  return value.trim();
};

const getRequiredBoolean = (source: JsonObject, fieldName: string): boolean => {
  const value = source[fieldName];
  if (typeof value !== "boolean") {
    throw createAppError(400, "INVALID_FIELD", `${fieldName} must be a boolean.`, {
      field: fieldName
    });
  }

  return value;
};

const getRequiredDataValue = (source: JsonObject, fieldName: string): DataValue => {
  const value = source[fieldName];
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  throw createAppError(400, "INVALID_FIELD", `${fieldName} must be a string, number, or boolean.`, {
    field: fieldName
  });
};

const parseRelayState = (source: JsonObject, fieldName: string): RelayState => {
  const state = getRequiredString(source, fieldName);
  if (state !== "on" && state !== "off") {
    throw createAppError(400, "INVALID_RELAY_STATE", `${fieldName} must be on or off.`, {
      state
    });
  }

  return state;
};

const parseDeviceValue = (value: JsonValue, index: number): DeviceValue => {
  if (!isJsonObject(value)) {
    throw createAppError(400, "INVALID_DEVICE_VALUE", "Each value must be an object.", {
      index
    });
  }

  const key = getRequiredString(value, "key");
  const dataValue = getRequiredDataValue(value, "value");
  if (key === "brightness" && (typeof dataValue !== "number" || !Number.isFinite(dataValue) || !Number.isInteger(dataValue) || dataValue < 0 || dataValue > 100)) {
    throw createAppError(400, "INVALID_DEVICE_REPORT", "values.brightness must be an integer between 0 and 100.", {
      key,
      value: dataValue
    });
  }

  return {
    key,
    value: dataValue,
    unit: getRequiredText(value, "unit")
  };
};

const parseValues = (source: JsonObject): readonly DeviceValue[] => {
  const values = source.values;
  if (!Array.isArray(values)) {
    throw createAppError(400, "INVALID_VALUES", "values must be an array.", null);
  }

  return values.map((value, index) => parseDeviceValue(value, index));
};

const parseRelayOutput = (value: JsonValue, index: number): RelayOutput => {
  if (!isJsonObject(value)) {
    throw createAppError(400, "INVALID_RELAY", "Each relay must be an object.", {
      index
    });
  }

  return {
    key: getRequiredString(value, "key"),
    state: parseRelayState(value, "state")
  };
};

const parseRelays = (source: JsonObject): readonly RelayOutput[] => {
  const relays = source.relays;
  if (!Array.isArray(relays)) {
    throw createAppError(400, "INVALID_RELAYS", "relays must be an array.", null);
  }

  return relays.map((relay, index) => parseRelayOutput(relay, index));
};

const parseAlarmState = (value: JsonValue, index: number): AlarmState => {
  if (!isJsonObject(value)) {
    throw createAppError(400, "INVALID_ALARM", "Each alarm must be an object.", {
      index
    });
  }

  return {
    key: getRequiredString(value, "key"),
    active: getRequiredBoolean(value, "active")
  };
};

const parseAlarms = (source: JsonObject): readonly AlarmState[] => {
  const alarms = source.alarms;
  if (!Array.isArray(alarms)) {
    throw createAppError(400, "INVALID_ALARMS", "alarms must be an array.", null);
  }

  return alarms.map((alarm, index) => parseAlarmState(alarm, index));
};

export const parseDeviceReportInput = (payload: JsonValue): DeviceReportInput => {
  if (!isJsonObject(payload)) {
    throw createAppError(400, "INVALID_BODY", "Request body must be a JSON object.", null);
  }

  const values = parseValues(payload);
  const relays = parseRelays(payload);
  const alarms = parseAlarms(payload);
  if (values.length + relays.length + alarms.length === 0) {
    throw createAppError(400, "EMPTY_REPORT", "A report must include at least one value, relay, or alarm.", null);
  }

  return {
    projectId: getRequiredString(payload, "projectId"),
    token: getRequiredString(payload, "token"),
    deviceId: getRequiredString(payload, "deviceId"),
    values,
    relays,
    alarms
  };
};

export const parseBatchReportInput = (payload: JsonValue): BatchDeviceReportInput => {
  if (!isJsonObject(payload)) throw createAppError(400, "INVALID_BODY", "Request body must be a JSON object.", null);
  const projectId = getRequiredString(payload, "projectId");
  const token = getRequiredString(payload, "token");
  const reports = payload.reports;
  if (!Array.isArray(reports) || reports.length === 0 || reports.length > 50) {
    throw createAppError(400, "INVALID_BATCH_REPORTS", "reports must contain between 1 and 50 reports.", null);
  }
  return {
    projectId,
    token,
    reports: reports.map((report) => {
      if (!isJsonObject(report)) throw createAppError(400, "INVALID_BATCH_REPORT", "Each report must be a JSON object.", null);
      return parseDeviceReportInput({ ...report, projectId, token });
    })
  };
};

export const parseDeviceRegistrationInput = (payload: JsonValue): DeviceRegistrationInput => {
  if (!isJsonObject(payload)) throw createAppError(400, "INVALID_BODY", "Request body must be a JSON object.", null);
  return { projectId: getRequiredString(payload, "projectId"), token: getRequiredString(payload, "token"), deviceId: getRequiredString(payload, "deviceId") };
};

export const parseDeviceImportInput = (payload: JsonValue): DeviceImportInput => {
  if (!isJsonObject(payload)) throw createAppError(400, "INVALID_BODY", "Request body must be a JSON object.", null);
  const projectId = getRequiredString(payload, "projectId");
  const token = getRequiredString(payload, "token");
  const devices = payload.devices;
  if (!Array.isArray(devices) || devices.length === 0 || devices.length > 100) throw createAppError(400, "INVALID_DEVICE_IMPORT", "devices must contain between 1 and 100 devices.", null);
  return { projectId, token, devices: devices.map((device) => {
    if (!isJsonObject(device)) throw createAppError(400, "INVALID_DEVICE_IMPORT", "Each device must be a JSON object.", null);
    return {
      deviceId: getRequiredString(device, "deviceId"),
      values: device.values === undefined ? null : parseValues(device),
      relays: device.relays === undefined ? null : parseRelays(device),
      alarms: device.alarms === undefined ? null : parseAlarms(device)
    };
  }) };
};

export const parseProjectInput = (payload: JsonValue): ProjectInput => {
  if (!isJsonObject(payload)) {
    throw createAppError(400, "INVALID_BODY", "Request body must be a JSON object.", null);
  }

  const projectId = getRequiredString(payload, "projectId");
  const name = payload.name === undefined ? projectId : getRequiredString(payload, "name");
  if (payload.account === undefined) return { projectId, name };
  if (!isJsonObject(payload.account)) throw createAppError(400, "INVALID_PROJECT_ACCOUNT", "account must be a JSON object.", null);
  return { projectId, name, account: { username: getRequiredString(payload.account, "username"), password: getRequiredString(payload.account, "password") } };
};

export const parseProjectAccountRegistrationInput = (payload: JsonValue): ProjectAccountRegistrationInput => {
  if (!isJsonObject(payload)) throw createAppError(400, "INVALID_BODY", "Request body must be a JSON object.", null);
  return {
    projectId: getRequiredString(payload, "projectId"),
    projectName: getRequiredString(payload, "projectName"),
    username: getRequiredString(payload, "username"),
    password: getRequiredString(payload, "password")
  };
};

export const parseProjectAccountLoginInput = (payload: JsonValue): { readonly username: string; readonly password: string } => {
  if (!isJsonObject(payload)) throw createAppError(400, "INVALID_BODY", "Request body must be a JSON object.", null);
  return { username: getRequiredString(payload, "username"), password: getRequiredString(payload, "password") };
};

export const parseProjectAccountReviewInput = (payload: JsonValue): ProjectAccountReviewInput => {
  if (!isJsonObject(payload)) throw createAppError(400, "INVALID_BODY", "Request body must be a JSON object.", null);
  const decision = getRequiredString(payload, "decision");
  if (decision !== "approve" && decision !== "reject") throw createAppError(400, "INVALID_ACCOUNT_REVIEW", "decision must be approve or reject.", { decision });
  return { decision };
};

export const parseProjectNameInput = (payload: JsonValue): ProjectNameInput => {
  if (!isJsonObject(payload)) {
    throw createAppError(400, "INVALID_BODY", "Request body must be a JSON object.", null);
  }
  return { name: getRequiredString(payload, "name") };
};

export const parseCommandInput = (payload: JsonValue): DeviceCommandInput => {
  if (!isJsonObject(payload)) {
    throw createAppError(400, "INVALID_BODY", "Request body must be a JSON object.", null);
  }

  const commandPayload: JsonValue | undefined = payload.payload;
  if (commandPayload === undefined || !isJsonObject(commandPayload)) {
    throw createAppError(400, "INVALID_COMMAND_PAYLOAD", "payload must be a JSON object.", {
      field: "payload"
    });
  }

  const name = getRequiredString(payload, "name");
  const commandId = payload.commandId === undefined ? undefined : getRequiredString(payload, "commandId");
  if (commandId !== undefined && (!/^[A-Za-z0-9._:-]{1,128}$/.test(commandId))) {
    throw createAppError(400, "INVALID_COMMAND_ID", "commandId must contain 1 to 128 letters, numbers, dots, underscores, colons, or hyphens.", {
      commandId
    });
  }
  if (name === "set_light") {
    const percent = commandPayload.percent;
    if (typeof percent !== "number" || !Number.isFinite(percent) || !Number.isInteger(percent) || percent < 0 || percent > 100) {
      throw createAppError(400, "INVALID_LIGHT_PERCENT", "set_light.payload.percent must be an integer between 0 and 100.", {
        percent: percent ?? null
      });
    }
  }

  return {
    ...(commandId === undefined ? {} : { commandId }),
    name,
    payload: commandPayload
  };
};

export const parseBatchCommandInput = (payload: JsonValue): BatchDeviceCommandInput => {
  if (!isJsonObject(payload)) {
    throw createAppError(400, "INVALID_BODY", "Request body must be a JSON object.", null);
  }
  const deviceIds = payload.deviceIds;
  if (!Array.isArray(deviceIds) || deviceIds.length === 0 || deviceIds.length > 50) {
    throw createAppError(400, "INVALID_BATCH_COMMAND_DEVICES", "deviceIds must contain between 1 and 50 device IDs.", null);
  }
  const parsedDeviceIds = deviceIds.map((deviceId, index) => {
    if (typeof deviceId !== "string" || deviceId.trim().length === 0) {
      throw createAppError(400, "INVALID_BATCH_COMMAND_DEVICE", "Each deviceId must be a non-empty string.", { index });
    }
    return deviceId.trim();
  });
  if (new Set(parsedDeviceIds).size !== parsedDeviceIds.length) {
    throw createAppError(400, "DUPLICATE_BATCH_COMMAND_DEVICE", "deviceIds must not contain duplicate device IDs.", null);
  }
  const command = payload.command;
  if (command === undefined) {
    throw createAppError(400, "INVALID_BATCH_COMMAND", "command is required.", null);
  }
  return {
    projectId: getRequiredString(payload, "projectId"),
    deviceIds: parsedDeviceIds,
    command: parseCommandInput(command)
  };
};

export const parseCommandAckInput = (payload: JsonValue): DeviceCommandAckInput => {
  if (!isJsonObject(payload)) {
    throw createAppError(400, "INVALID_BODY", "Request body must be a JSON object.", null);
  }

  return {
    projectId: getRequiredString(payload, "projectId"),
    token: getRequiredString(payload, "token"),
    deviceId: getRequiredString(payload, "deviceId"),
    commandId: getRequiredString(payload, "commandId")
  };
};

const maxRemoteDebugBytes = 16 * 1024;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const parseRemoteDebugWriteInput = (payload: JsonValue): RemoteDebugWriteInput => {
  if (!isJsonObject(payload)) {
    throw createAppError(400, "INVALID_REMOTE_DEBUG_BODY", "Remote debug payload must be a JSON object.", null);
  }
  if (payload.encoding !== "base64") {
    throw createAppError(400, "INVALID_REMOTE_DEBUG_ENCODING", "Remote debug encoding must be base64.", { encoding: payload.encoding ?? null });
  }
  if (typeof payload.data !== "string" || payload.data.length === 0 || !base64Pattern.test(payload.data)) {
    throw createAppError(400, "INVALID_REMOTE_DEBUG_DATA", "Remote debug data must be a non-empty canonical Base64 string.", null);
  }
  const bytes = Buffer.from(payload.data, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > maxRemoteDebugBytes || bytes.toString("base64") !== payload.data) {
    throw createAppError(400, "INVALID_REMOTE_DEBUG_DATA", `Remote debug data must contain between 1 and ${maxRemoteDebugBytes} bytes.`, {
      byteLength: bytes.byteLength,
      maxByteLength: maxRemoteDebugBytes
    });
  }
  return { encoding: "base64", data: payload.data, byteLength: bytes.byteLength };
};

export const parseRemoteDebugDataInput = (payload: JsonValue): RemoteDebugDataInput => {
  if (!isJsonObject(payload)) {
    throw createAppError(400, "INVALID_REMOTE_DEBUG_BODY", "Remote debug payload must be a JSON object.", null);
  }
  return {
    projectId: getRequiredString(payload, "projectId"),
    token: getRequiredString(payload, "token"),
    deviceId: getRequiredString(payload, "deviceId"),
    ...parseRemoteDebugWriteInput(payload)
  };
};

const getRequiredFiniteNumber = (source: JsonObject, fieldName: string): number => {
  const value = source[fieldName];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw createAppError(400, "INVALID_FIELD", `${fieldName} must be a finite number.`, {
      field: fieldName
    });
  }

  return value;
};

const getOptionalText = (source: JsonObject, fieldName: string): string | undefined => {
  const value = source[fieldName];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw createAppError(400, "INVALID_FIELD", `${fieldName} must be a string.`, {
      field: fieldName
    });
  }

  return value.trim();
};

const parseDeviceTemplateValue = (value: JsonValue, index: number): DeviceTemplateValue => {
  if (!isJsonObject(value)) {
    throw createAppError(400, "INVALID_DEVICE_TEMPLATE_VALUE", "Each template value must be an object.", { index });
  }

  return {
    key: getRequiredString(value, "key"),
    unit: getRequiredText(value, "unit"),
    label: getRequiredString(value, "label")
  };
};

const parseDeviceTemplateRelay = (value: JsonValue, index: number): DeviceTemplateRelay => {
  if (!isJsonObject(value)) {
    throw createAppError(400, "INVALID_DEVICE_TEMPLATE_RELAY", "Each template relay must be an object.", { index });
  }

  return {
    key: getRequiredString(value, "key"),
    label: getRequiredString(value, "label")
  };
};

const parseDeviceTemplateAlarm = (value: JsonValue, index: number): DeviceTemplateAlarm => {
  if (!isJsonObject(value)) {
    throw createAppError(400, "INVALID_DEVICE_TEMPLATE_ALARM", "Each template alarm must be an object.", { index });
  }

  return {
    key: getRequiredString(value, "key"),
    label: getRequiredString(value, "label")
  };
};

export const parseDeviceTemplate = (payload: JsonValue): DeviceTemplate => {
  if (!isJsonObject(payload)) {
    throw createAppError(400, "INVALID_DEVICE_TEMPLATE", "template must be a JSON object.", null);
  }

  const values = payload.values;
  const relays = payload.relays;
  const alarms = payload.alarms;
  if (!Array.isArray(values) || !Array.isArray(relays) || !Array.isArray(alarms)) {
    throw createAppError(400, "INVALID_DEVICE_TEMPLATE", "template values, relays, and alarms must be arrays.", null);
  }

  return {
    values: values.map((value, index) => parseDeviceTemplateValue(value, index)),
    relays: relays.map((value, index) => parseDeviceTemplateRelay(value, index)),
    alarms: alarms.map((value, index) => parseDeviceTemplateAlarm(value, index))
  };
};

export const parseDeviceRegistrationInputV2 = (payload: JsonValue): DeviceRegistrationInputV2 => {
  if (!isJsonObject(payload)) {
    throw createAppError(400, "INVALID_BODY", "Request body must be a JSON object.", null);
  }

  const name = getOptionalText(payload, "name");
  const type = getOptionalText(payload, "type");
  const location = getOptionalText(payload, "location");
  const metadata = payload.metadata;
  const template = payload.template;
  if (metadata !== undefined && !isJsonObject(metadata)) {
    throw createAppError(400, "INVALID_METADATA", "metadata must be a JSON object.", null);
  }

  return {
    projectId: getRequiredString(payload, "projectId"),
    token: getRequiredString(payload, "token"),
    deviceId: getRequiredString(payload, "deviceId"),
    ...(name === undefined ? {} : { name }),
    ...(type === undefined ? {} : { type }),
    ...(location === undefined ? {} : { location }),
    ...(metadata === undefined ? {} : { metadata }),
    ...(template === undefined ? {} : { template: parseDeviceTemplate(template) })
  };
};

export const parseSimulateInput = (payload: JsonValue): SimulateInput => {
  if (!isJsonObject(payload)) {
    throw createAppError(400, "INVALID_BODY", "Request body must be a JSON object.", null);
  }

  return {
    projectId: getRequiredString(payload, "projectId"),
    token: getRequiredString(payload, "token"),
    deviceId: getRequiredString(payload, "deviceId"),
    ...(payload.values === undefined ? {} : { values: parseValues(payload) }),
    ...(payload.relays === undefined ? {} : { relays: parseRelays(payload) }),
    ...(payload.alarms === undefined ? {} : { alarms: parseAlarms(payload) })
  };
};

const parseRuleCondition = (value: JsonValue, index: number): RuleCondition => {
  if (!isJsonObject(value)) {
    throw createAppError(400, "INVALID_RULE_CONDITION", "Each rule condition must be an object.", { index });
  }

  const operator = getRequiredString(value, "operator");
  if (operator !== ">" && operator !== "<" && operator !== ">=" && operator !== "<=" && operator !== "==" && operator !== "!=") {
    throw createAppError(400, "INVALID_RULE_OPERATOR", "operator must be a supported comparison operator.", { index, operator });
  }
  const conditionValue = getRequiredDataValue(value, "value");

  return {
    field: getRequiredString(value, "field"),
    operator,
    value: conditionValue
  };
};

const parseRuleAction = (value: JsonValue, index: number): RuleAction => {
  if (!isJsonObject(value)) {
    throw createAppError(400, "INVALID_RULE_ACTION", "Each rule action must be an object.", { index });
  }
  const command = value.command;
  if (command === undefined) {
    throw createAppError(400, "INVALID_RULE_ACTION", "Each rule action requires a command.", { index });
  }
  if (!isJsonObject(command)) {
    throw createAppError(400, "INVALID_RULE_ACTION", "Each rule action command must be an object.", { index });
  }

  return {
    deviceId: getRequiredString(value, "deviceId"),
    command: parseCommandInput(command)
  };
};

export const parseRuleInput = (payload: JsonValue): RuleInput => {
  if (!isJsonObject(payload)) {
    throw createAppError(400, "INVALID_BODY", "Request body must be a JSON object.", null);
  }
  const conditions = payload.conditions;
  const actions = payload.actions;
  const sourceDeviceIds = payload.sourceDeviceIds;
  const logic = getRequiredString(payload, "logic");
  const cooldownMs = getRequiredFiniteNumber(payload, "cooldownMs");
  if (!Array.isArray(conditions) || !Array.isArray(actions)) {
    throw createAppError(400, "INVALID_RULE", "conditions and actions must be arrays.", null);
  }
  if (conditions.length === 0 || actions.length === 0) {
    throw createAppError(400, "INVALID_RULE", "conditions and actions must each contain at least one item.", {
      conditionsCount: conditions.length,
      actionsCount: actions.length
    });
  }
  if (logic !== "all" && logic !== "any") {
    throw createAppError(400, "INVALID_RULE_LOGIC", "logic must be all or any.", { logic });
  }
  if (!Number.isInteger(cooldownMs) || cooldownMs < 0) {
    throw createAppError(400, "INVALID_COOLDOWN", "cooldownMs must be a non-negative integer.", { cooldownMs });
  }
  if (sourceDeviceIds !== undefined && !Array.isArray(sourceDeviceIds)) {
    throw createAppError(400, "INVALID_RULE_SOURCE_DEVICES", "sourceDeviceIds must be an array.", { sourceDeviceIds });
  }

  const normalizedSourceDeviceIds = (sourceDeviceIds ?? []).map((deviceId, index) => {
    if (typeof deviceId !== "string" || deviceId.trim().length === 0) {
      throw createAppError(400, "INVALID_RULE_SOURCE_DEVICE", "sourceDeviceIds entries must be non-empty strings.", { index });
    }
    return deviceId.trim();
  });

  return {
    name: getRequiredString(payload, "name"),
    enabled: getRequiredBoolean(payload, "enabled"),
    sourceDeviceIds: [...new Set(normalizedSourceDeviceIds)],
    conditions: conditions.map((condition, index) => parseRuleCondition(condition, index)),
    logic,
    actions: actions.map((action, index) => parseRuleAction(action, index)),
    cooldownMs
  };
};

const parseStringList = (value: JsonValue | undefined, fieldName: string): readonly string[] => {
  if (!Array.isArray(value)) {
    throw createAppError(400, "INVALID_FORWARDER_FILTER", `${fieldName} must be an array.`, { field: fieldName });
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw createAppError(400, "INVALID_FORWARDER_FILTER", `${fieldName} entries must be non-empty strings.`, { field: fieldName, index });
    }
    return item.trim();
  });
};

export const parseForwarderInput = (payload: JsonValue): ForwarderInput => {
  if (!isJsonObject(payload)) {
    throw createAppError(400, "INVALID_BODY", "Request body must be a JSON object.", null);
  }
  const type = getRequiredString(payload, "type");
  const config = payload.config;
  const filter = payload.filter;
  if (type !== "mqtt" && type !== "webhook") {
    throw createAppError(400, "INVALID_FORWARDER_TYPE", "type must be mqtt or webhook.", { type });
  }
  if (config === undefined || !isJsonObject(config)) {
    throw createAppError(400, "INVALID_FORWARDER_CONFIG", "config must be a JSON object.", null);
  }
  if (type === "webhook" && (typeof config.url !== "string" || config.url.trim().length === 0)) {
    throw createAppError(400, "INVALID_FORWARDER_CONFIG", "Webhook forwarder config.url must be a non-empty string.", null);
  }
  if (type === "webhook" && typeof config.url === "string") {
    let webhookUrl: URL;
    try {
      webhookUrl = new URL(config.url);
    } catch {
      throw createAppError(400, "INVALID_FORWARDER_CONFIG", "Webhook forwarder config.url must be a valid URL.", { url: config.url });
    }
    if ((webhookUrl.protocol !== "http:" && webhookUrl.protocol !== "https:") || webhookUrl.username.length > 0 || webhookUrl.password.length > 0) {
      throw createAppError(400, "INVALID_FORWARDER_CONFIG", "Webhook URL must use HTTP or HTTPS and must not contain embedded credentials.", { url: config.url });
    }
  }
  if (type === "mqtt" && (typeof config.topic !== "string" || config.topic.trim().length === 0 || config.topic.includes("#") || config.topic.includes("+"))) {
    throw createAppError(400, "INVALID_FORWARDER_CONFIG", "MQTT forwarder config.topic must be a non-empty publish topic without wildcards.", null);
  }
  if (filter !== undefined && filter !== null && !isJsonObject(filter)) {
    throw createAppError(400, "INVALID_FORWARDER_FILTER", "filter must be a JSON object or null.", null);
  }

  return {
    name: getRequiredString(payload, "name"),
    type: type as ForwarderType,
    enabled: getRequiredBoolean(payload, "enabled"),
    config,
    filter: filter === undefined || filter === null ? null : {
      deviceIds: parseStringList(filter.deviceIds, "filter.deviceIds"),
      keys: parseStringList(filter.keys, "filter.keys")
    }
  };
};

const parseAIChatMessage = (value: JsonValue, index: number): AIChatMessage => {
  if (!isJsonObject(value)) {
    throw createAppError(400, "INVALID_AI_MESSAGE", "Each AI message must be an object.", { index });
  }
  const role = getRequiredString(value, "role");
  if (role !== "user" && role !== "assistant" && role !== "system") {
    throw createAppError(400, "INVALID_AI_MESSAGE_ROLE", "role must be user, assistant, or system.", { index, role });
  }

  return { role, content: getRequiredText(value, "content") };
};

export const parseAIChatRequest = (payload: JsonValue): AIChatRequest => {
  if (!isJsonObject(payload)) {
    throw createAppError(400, "INVALID_BODY", "Request body must be a JSON object.", null);
  }
  const messages = payload.messages;
  const context = getOptionalText(payload, "context");
  if (!Array.isArray(messages) || messages.length === 0) {
    throw createAppError(400, "INVALID_AI_MESSAGES", "messages must be a non-empty array.", null);
  }

  return {
    projectId: getRequiredString(payload, "projectId"),
    token: getRequiredString(payload, "token"),
    messages: messages.map((message, index) => parseAIChatMessage(message, index)),
    ...(context === undefined ? {} : { context })
  };
};

export const parseVerifyRequest = (payload: JsonValue): VerifyRequest => {
  if (!isJsonObject(payload)) {
    throw createAppError(400, "INVALID_BODY", "Request body must be a JSON object.", null);
  }
  const timeoutMs = getRequiredFiniteNumber(payload, "timeoutMs");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw createAppError(400, "INVALID_VERIFY_TIMEOUT", "timeoutMs must be a positive integer.", { timeoutMs });
  }

  return {
    projectId: getRequiredString(payload, "projectId"),
    token: getRequiredString(payload, "token"),
    deviceId: getRequiredString(payload, "deviceId"),
    timeoutMs
  };
};
