import { requestJson } from "../api/client";
import type { JsonObject } from "../types";
import {
  parseAgentKeySummaries,
  parseCreatedAgentKey,
  parseCreatedFirmware,
  parseCreatedForwarder,
  parseCreatedRule,
  parseFirmwareList,
  parseOtaTask,
  parseRules,
  parseWebhookForwarders,
  type AgentKeySummary,
  type AutomationForwarderInput,
  type AutomationForwarderRecord,
  type AutomationRuleInput,
  type AutomationRuleRecord,
  type CreatedAgentKey,
  type FirmwareInput,
  type FirmwareRecord,
  type OtaTask,
  type ProjectAccess
} from "./models";

const headers = (project: ProjectAccess): Readonly<Record<string, string>> => ({ "x-project-token": project.token });
const projectResourceUrl = (project: ProjectAccess, resource: string): string => `/api/v1/projects/${encodeURIComponent(project.projectId)}/${resource}`;
const requestData = async (url: string, method: "GET" | "POST" | "PUT" | "DELETE", body: JsonObject | null, project: ProjectAccess): Promise<unknown> => {
  const response = await requestJson<unknown>(url, { method, body, headers: headers(project) });
  return response.data;
};

export const listAgentKeys = async (project: ProjectAccess): Promise<readonly AgentKeySummary[]> => parseAgentKeySummaries(await requestData(projectResourceUrl(project, "agent-keys"), "GET", null, project));
export const createAgentKey = async (project: ProjectAccess, label: string): Promise<CreatedAgentKey> => parseCreatedAgentKey(await requestData(projectResourceUrl(project, "agent-keys"), "POST", { label }, project));
export const deleteAgentKey = async (project: ProjectAccess, keyId: string): Promise<void> => {
  await requestData(`${projectResourceUrl(project, "agent-keys")}/${encodeURIComponent(keyId)}`, "DELETE", null, project);
};

export const listRules = async (project: ProjectAccess): Promise<readonly AutomationRuleRecord[]> => parseRules(await requestData(projectResourceUrl(project, "rules"), "GET", null, project));
export const createRule = async (project: ProjectAccess, input: AutomationRuleInput): Promise<AutomationRuleRecord> => parseCreatedRule(await requestData(projectResourceUrl(project, "rules"), "POST", input, project));
export const updateRule = async (project: ProjectAccess, ruleId: string, input: AutomationRuleInput): Promise<AutomationRuleRecord> => parseCreatedRule(await requestData(`${projectResourceUrl(project, "rules")}/${encodeURIComponent(ruleId)}`, "PUT", input, project));
export const deleteRule = async (project: ProjectAccess, ruleId: string): Promise<void> => {
  await requestData(`${projectResourceUrl(project, "rules")}/${encodeURIComponent(ruleId)}`, "DELETE", null, project);
};

export const listWebhookForwarders = async (project: ProjectAccess): Promise<readonly AutomationForwarderRecord[]> => parseWebhookForwarders(await requestData(projectResourceUrl(project, "forwarders"), "GET", null, project));
export const createWebhookForwarder = async (project: ProjectAccess, input: AutomationForwarderInput): Promise<AutomationForwarderRecord> => parseCreatedForwarder(await requestData(projectResourceUrl(project, "forwarders"), "POST", input, project));
export const updateWebhookForwarder = async (project: ProjectAccess, forwarderId: string, input: AutomationForwarderInput): Promise<AutomationForwarderRecord> => parseCreatedForwarder(await requestData(`${projectResourceUrl(project, "forwarders")}/${encodeURIComponent(forwarderId)}`, "PUT", input, project));
export const deleteWebhookForwarder = async (project: ProjectAccess, forwarderId: string): Promise<void> => {
  await requestData(`${projectResourceUrl(project, "forwarders")}/${encodeURIComponent(forwarderId)}`, "DELETE", null, project);
};

export const listFirmware = async (project: ProjectAccess): Promise<readonly FirmwareRecord[]> => parseFirmwareList(await requestData(projectResourceUrl(project, "firmware"), "GET", null, project));
export const addFirmware = async (project: ProjectAccess, input: FirmwareInput): Promise<FirmwareRecord> => parseCreatedFirmware(await requestData(projectResourceUrl(project, "firmware"), "POST", input, project));
export const deleteFirmware = async (project: ProjectAccess, firmwareId: string): Promise<void> => {
  await requestData(`${projectResourceUrl(project, "firmware")}/${encodeURIComponent(firmwareId)}`, "DELETE", null, project);
};

const otaUrl = (project: ProjectAccess, deviceId: string): string => `/api/v1/devices/${encodeURIComponent(project.projectId)}/${encodeURIComponent(deviceId)}/ota`;
export const createOtaTask = async (project: ProjectAccess, deviceId: string, firmwareId: string): Promise<OtaTask> => parseOtaTask(await requestData(otaUrl(project, deviceId), "POST", { firmwareId }, project));
export const getOtaTask = async (project: ProjectAccess, deviceId: string, otaId: string): Promise<OtaTask> => parseOtaTask(await requestData(`${otaUrl(project, deviceId)}?otaId=${encodeURIComponent(otaId)}`, "GET", null, project));
