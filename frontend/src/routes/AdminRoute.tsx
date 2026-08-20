import { Spin, message } from "antd";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestJson } from "../api/client";
import { createEventStream } from "../api/sse";
import { useCommandTimeline } from "../hooks/useCommandTimeline";
import { parseDashboardSnapshot, parseOperationalMetrics } from "../types";
import type { AlarmState, BatchDeviceCommandResult, DashboardSnapshot, DeviceCommand, DeviceRecord, DeviceValue, JsonObject, OperationalMetrics, ProbeResult, ProjectAccount, ProjectRecord, RelayOutput } from "../types";
import { AccountsPanel } from "../views/AccountsPanel";
import { ApiReturnDrawer } from "../views/ApiReturnDrawer";
import { CommandsTab } from "../views/CommandsTab";
import { DashboardTab, type DashboardState } from "../views/DashboardTab";
import { DeviceDetailPanel } from "../views/DeviceDetailPanel";
import { DevicesTab } from "../views/DevicesTab";
import { EventsTab, type DashboardEvent } from "../views/EventsTab";
import { OperationsTab, type OperationsState } from "../views/OperationsTab";
import { ProjectsTab } from "../views/ProjectsTab";
import type { ReportInput } from "../views/ReportPanel";

export type AdminTabKey = "dashboard" | "projects" | "accounts" | "operations" | "devices" | "commands" | "events" | "automation" | "serial";
export type AdminRouteProps = {
  readonly requestedTab: AdminTabKey;
  readonly selectedProjectId: string;
  readonly drawerOpen: boolean;
  readonly adminToken: string;
  readonly projectUserSessionToken: string;
  readonly onAdminTokenRequired: () => void;
  readonly onActiveTabChange: (tab: AdminTabKey) => void;
  readonly onProjectsChange: (projects: readonly ProjectRecord[]) => void;
  readonly onSelectedProjectIdChange: (projectId: string) => void;
  readonly onEventStatus: (status: string) => void;
  readonly onDrawerOpenChange: (open: boolean) => void;
  readonly onRefreshChange: (refresh: () => Promise<void>) => void;
};

const projectUserSessionPrefix = "project-user-session:";
const projectHeaders = (token: string): Readonly<Record<string, string>> => token.startsWith(projectUserSessionPrefix)
  ? { authorization: `Bearer ${token.slice(projectUserSessionPrefix.length)}` }
  : { "x-project-token": token };
const adminHeaders = (token: string): Readonly<Record<string, string>> => token.length === 0 ? {} : { "x-admin-token": token };
const isAdminTokenError = (messageText: string): boolean => messageText.startsWith("ADMIN_TOKEN_REQUIRED:") || messageText.startsWith("INVALID_ADMIN_TOKEN:") || messageText.startsWith("INVALID_USER_SESSION:");
const AutomationTab = lazy(async () => {
  const module = await import("../views/automation/AutomationTab");
  return { default: module.AutomationTab };
});
const SerialTab = lazy(async () => {
  const module = await import("../views/SerialTab");
  return { default: module.SerialTab };
});
const validTabs: readonly AdminTabKey[] = ["dashboard", "projects", "accounts", "operations", "devices", "commands", "events", "automation", "serial"];
const readTab = (): AdminTabKey => {
  const value = new URLSearchParams(window.location.search).get("tab");
  return validTabs.includes(value as AdminTabKey) ? value as AdminTabKey : "dashboard";
};
const isErrorOutput = (value: unknown): boolean => typeof value === "object" && value !== null && "ok" in value && value.ok === false;
type MqttStatusInfo = { readonly status: "stopped" | "connected" | "disconnected" | "connecting"; readonly broker: string; readonly port: number; readonly clientId: string };
const readProperty = (value: object, key: string): unknown => key in value ? Reflect.get(value, key) as unknown : undefined;
const readString = (value: object, key: string): string | null => {
  const property = readProperty(value, key);
  return typeof property === "string" ? property : null;
};
const isDeviceValue = (value: unknown): value is DeviceValue => {
  if (typeof value !== "object" || value === null) return false;
  const data = readProperty(value, "value");
  return readString(value, "key") !== null
    && readString(value, "unit") !== null
    && (typeof data === "string" || typeof data === "number" || typeof data === "boolean");
};
const isRelayOutput = (value: unknown): value is RelayOutput => {
  if (typeof value !== "object" || value === null) return false;
  const state = readString(value, "state");
  return readString(value, "key") !== null && (state === "on" || state === "off");
};
const isAlarmState = (value: unknown): value is AlarmState => typeof value === "object"
  && value !== null
  && readString(value, "key") !== null
  && typeof readProperty(value, "active") === "boolean";
const readDeviceReportEvent = (payload: unknown): DeviceRecord | null => {
  if (typeof payload !== "object" || payload === null) return null;
  const device = readProperty(payload, "device");
  if (typeof device !== "object" || device === null) return null;
  const lastReport = readProperty(device, "lastReport");
  if (typeof lastReport !== "object" || lastReport === null) return null;
  const values = readProperty(lastReport, "values");
  const relays = readProperty(lastReport, "relays");
  const alarms = readProperty(lastReport, "alarms");
  const projectId = readString(device, "projectId");
  const deviceId = readString(device, "deviceId");
  const createdAt = readString(device, "createdAt");
  const lastSeenAt = readString(device, "lastSeenAt");
  const reportProjectId = readString(lastReport, "projectId");
  const reportDeviceId = readString(lastReport, "deviceId");
  const reportedAt = readString(lastReport, "reportedAt");
  const activityConfirmed = readProperty(device, "activityConfirmed");
  const simulated = readProperty(device, "simulated");
  if (projectId === null || deviceId === null || createdAt === null || lastSeenAt === null || reportProjectId === null || reportDeviceId === null || reportedAt === null) return null;
  if (typeof activityConfirmed !== "boolean") return null;
  if (simulated !== undefined && typeof simulated !== "boolean") return null;
  if (!Array.isArray(values) || !values.every(isDeviceValue) || !Array.isArray(relays) || !relays.every(isRelayOutput) || !Array.isArray(alarms) || !alarms.every(isAlarmState)) return null;
  return {
    projectId,
    deviceId,
    createdAt,
    lastSeenAt,
    activityConfirmed,
    lastReport: { projectId: reportProjectId, deviceId: reportDeviceId, values, relays, alarms, reportedAt },
    ...(typeof simulated === "boolean" ? { simulated } : {})
  };
};

export const AdminRoute = ({ requestedTab, selectedProjectId, drawerOpen, adminToken, projectUserSessionToken, onAdminTokenRequired, onActiveTabChange, onProjectsChange, onSelectedProjectIdChange, onEventStatus, onDrawerOpenChange, onRefreshChange }: AdminRouteProps): JSX.Element => {
  const [projects, setProjects] = useState<readonly ProjectRecord[]>([]);
  const [accounts, setAccounts] = useState<readonly ProjectAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [devices, setDevices] = useState<readonly DeviceRecord[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [commandPanel, setCommandPanel] = useState<"relays" | "custom" | "report">("relays");
  const [mqttStatus, setMqttStatus] = useState<MqttStatusInfo | null>(null);
  const [events, setEvents] = useState<readonly DashboardEvent[]>([]);
  const [eventStatus, setEventStatus] = useState("未连接");
  const [eventPaused, setEventPaused] = useState(false);
  const [output, setOutput] = useState<unknown>({});
  const [activeTab, setActiveTab] = useState<AdminTabKey>(readTab);
  const [automationRefreshKey, setAutomationRefreshKey] = useState(0);
  const [dashboardState, setDashboardState] = useState<DashboardState>({ snapshot: null, loading: false, error: null });
  const [operationsState, setOperationsState] = useState<OperationsState>({ metrics: null, loading: false, error: null });
  const pausedRef = useRef(eventPaused);
  const lastDeviceSyncAtRef = useRef(0);
  const selectedProjectIdRef = useRef(selectedProjectId);
  const deviceRequestSequenceRef = useRef(0);
  const commandRequestSequenceRef = useRef(0);
  const dashboardRequestSequenceRef = useRef(0);
  const dashboardRefreshTimerRef = useRef<number | null>(null);
  const previousActiveTabRef = useRef(activeTab);
  selectedProjectIdRef.current = selectedProjectId;
  const selectedProject = useMemo(() => projects.find((project) => project.projectId === selectedProjectId), [projects, selectedProjectId]);
  const [timeline, consumeCommandEvent, replaceTimelineCommands, mergeTimelineCommands] = useCommandTimeline(selectedProjectId);
  const detailDevice = useMemo(() => devices.find((device) => device.deviceId === selectedDeviceId) ?? null, [devices, selectedDeviceId]);

  const writeOutput = useCallback((value: unknown): void => {
    setOutput(value);
    if (isErrorOutput(value)) onDrawerOpenChange(true);
  }, [onDrawerOpenChange]);

  const reportError = useCallback((error: unknown, fallback: string): Error => {
    const text = error instanceof Error ? error.message : fallback;
    if (isAdminTokenError(text)) {
      onAdminTokenRequired();
      return new Error(text);
    }
    writeOutput({ ok: false, error: text });
    message.error(text);
    return new Error(text);
  }, [onAdminTokenRequired, writeOutput]);

  const loadProjects = useCallback(async (): Promise<readonly ProjectRecord[]> => {
    const response = await requestJson<readonly ProjectRecord[]>("/api/v1/projects", { method: "GET", body: null, headers: projectUserSessionToken.length === 0 ? adminHeaders(adminToken) : { authorization: `Bearer ${projectUserSessionToken}` } });
    const accessibleProjects = projectUserSessionToken.length === 0
      ? response.data
      : response.data.map((project) => ({ ...project, token: `${projectUserSessionPrefix}${projectUserSessionToken}` }));
    setProjects(accessibleProjects);
    onProjectsChange(accessibleProjects);
    writeOutput(response);
    return accessibleProjects;
  }, [adminToken, onProjectsChange, projectUserSessionToken, writeOutput]);

  const loadAccounts = useCallback(async (): Promise<void> => {
    setAccountsLoading(true);
    try {
      const response = await requestJson<readonly ProjectAccount[]>("/api/v1/admin/accounts", { method: "GET", body: null, headers: adminHeaders(adminToken) });
      setAccounts(response.data);
      writeOutput(response);
    } finally {
      setAccountsLoading(false);
    }
  }, [adminToken, writeOutput]);

  const loadDevices = useCallback(async (projectId: string, token: string): Promise<void> => {
    if (projectId.length === 0 || selectedProjectIdRef.current !== projectId) return;
    const requestSequence = ++deviceRequestSequenceRef.current;
    const response = await requestJson<readonly DeviceRecord[]>(`/api/v1/devices?projectId=${encodeURIComponent(projectId)}`, { method: "GET", body: null, headers: projectHeaders(token) });
    if (selectedProjectIdRef.current !== projectId || deviceRequestSequenceRef.current !== requestSequence) return;
    setDevices(response.data);
    lastDeviceSyncAtRef.current = Date.now();
    writeOutput(response);
  }, [writeOutput]);

  const loadCommandHistory = useCallback(async (projectId: string, token: string, mode: "replace" | "merge"): Promise<void> => {
    if (projectId.length === 0 || selectedProjectIdRef.current !== projectId) return;
    const requestSequence = ++commandRequestSequenceRef.current;
    const response = await requestJson<readonly DeviceCommand[]>(`/api/v1/commands?projectId=${encodeURIComponent(projectId)}&limit=50`, { method: "GET", body: null, headers: projectHeaders(token) });
    if (selectedProjectIdRef.current !== projectId || commandRequestSequenceRef.current !== requestSequence) return;
    if (mode === "replace") replaceTimelineCommands(response.data); else mergeTimelineCommands(response.data);
  }, [mergeTimelineCommands, replaceTimelineCommands]);

  const loadDashboardSnapshot = useCallback(async (projectId: string, token: string): Promise<void> => {
    if (projectId.length === 0 || selectedProjectIdRef.current !== projectId) return;
    const requestSequence = ++dashboardRequestSequenceRef.current;
    setDashboardState((current) => ({ snapshot: current.snapshot?.projectId === projectId ? current.snapshot : null, loading: true, error: null }));
    try {
      const response = await requestJson<unknown>(`/api/v1/dashboard?projectId=${encodeURIComponent(projectId)}`, { method: "GET", body: null, headers: projectHeaders(token) });
      const snapshot: DashboardSnapshot = parseDashboardSnapshot(response.data);
      if (snapshot.projectId !== projectId) throw new Error(`仪表盘返回了错误项目：期望 ${projectId}，实际 ${snapshot.projectId}。`);
      if (selectedProjectIdRef.current !== projectId || dashboardRequestSequenceRef.current !== requestSequence) return;
      setDashboardState({ snapshot, loading: false, error: null });
    } catch (error: unknown) {
      if (selectedProjectIdRef.current !== projectId || dashboardRequestSequenceRef.current !== requestSequence) return;
      const errorText = error instanceof Error ? error.message : "仪表盘加载失败。";
      if (isAdminTokenError(errorText)) onAdminTokenRequired();
      setDashboardState((current) => ({ snapshot: current.snapshot?.projectId === projectId ? current.snapshot : null, loading: false, error: errorText }));
    }
  }, [onAdminTokenRequired]);

  const loadOperationalMetrics = useCallback(async (): Promise<void> => {
    setOperationsState((current) => ({ metrics: current.metrics, loading: true, error: null }));
    try {
      const response = await requestJson<unknown>("/api/v1/operations/metrics", { method: "GET", body: null, headers: adminHeaders(adminToken) });
      const metrics: OperationalMetrics = parseOperationalMetrics(response.data);
      setOperationsState({ metrics, loading: false, error: null });
    } catch (error: unknown) {
      const errorText = error instanceof Error ? error.message : "运行指标加载失败。";
      if (isAdminTokenError(errorText)) onAdminTokenRequired();
      setOperationsState((current) => ({ metrics: current.metrics, loading: false, error: errorText }));
    }
  }, [adminToken, onAdminTokenRequired]);

  const loadMqttStatus = useCallback(async (): Promise<void> => {
    try {
      const response = await requestJson<MqttStatusInfo>("/api/v1/mqtt-status", { method: "GET", body: null, headers: {} });
      setMqttStatus(response.data.clientId.length === 0 ? null : response.data);
    } catch (error: unknown) {
      setMqttStatus(null);
      console.warn("MQTT 状态加载失败", { error: error instanceof Error ? error.message : "未知错误" });
    }
  }, []);

  const refreshAll = useCallback(async (): Promise<void> => {
    try {
      const nextProjects = await loadProjects();
      const selected = nextProjects.find((project) => project.projectId === selectedProjectId) ?? nextProjects[0];
      if (selected === undefined) {
        onSelectedProjectIdChange("");
        setDevices([]);
        setDashboardState({ snapshot: null, loading: false, error: null });
        return;
      }
      if (selected.projectId !== selectedProjectId) {
        onSelectedProjectIdChange(selected.projectId);
        return;
      }
      await Promise.all([
        loadDevices(selectedProjectId, selected.token),
        loadCommandHistory(selectedProjectId, selected.token, "replace"),
        loadDashboardSnapshot(selectedProjectId, selected.token)
      ]);
    } catch (error: unknown) {
      reportError(error, "加载失败。");
    }
  }, [loadCommandHistory, loadDashboardSnapshot, loadDevices, loadProjects, onSelectedProjectIdChange, reportError, selectedProjectId]);

  const initializeProjects = useCallback(async (): Promise<void> => {
    try {
      const nextProjects = await loadProjects();
      const currentProjectId = selectedProjectIdRef.current;
      const selected = nextProjects.find((project) => project.projectId === currentProjectId) ?? nextProjects[0];
      if (selected === undefined) {
        onSelectedProjectIdChange("");
        return;
      }
      if (selected.projectId !== currentProjectId) onSelectedProjectIdChange(selected.projectId);
    } catch (error: unknown) {
      reportError(error, "加载项目失败。");
    }
  }, [loadProjects, onSelectedProjectIdChange, reportError]);

  const refreshDevices = useCallback(async (): Promise<void> => {
    if (selectedProject === undefined) return;
    try {
      await loadDevices(selectedProject.projectId, selectedProject.token);
    } catch (error: unknown) {
      reportError(error, "加载设备失败。");
    }
  }, [loadDevices, reportError, selectedProject]);

  const refreshCommandHistory = useCallback(async (mode: "replace" | "merge"): Promise<void> => {
    if (selectedProject === undefined) return;
    try {
      await loadCommandHistory(selectedProject.projectId, selectedProject.token, mode);
    } catch (error: unknown) {
      reportError(error, "加载命令历史失败。");
    }
  }, [loadCommandHistory, reportError, selectedProject]);

  const updateEventStatus = useCallback((status: string): void => {
    setEventStatus(status);
    onEventStatus(status);
  }, [onEventStatus]);

  const scheduleDashboardRefresh = useCallback((projectId: string, token: string): void => {
    if (selectedProjectIdRef.current !== projectId || dashboardRefreshTimerRef.current !== null) return;
    dashboardRefreshTimerRef.current = window.setTimeout(() => {
      dashboardRefreshTimerRef.current = null;
      void loadDashboardSnapshot(projectId, token);
    }, 1_000);
  }, [loadDashboardSnapshot]);

  const selectTab = useCallback((tab: AdminTabKey, push: boolean): void => {
    setActiveTab(tab);
    onActiveTabChange(tab);
    if (push) window.history.pushState({}, "", `/admin?tab=${tab}`);
  }, [onActiveTabChange]);

  useEffect(() => {
    deviceRequestSequenceRef.current += 1;
    commandRequestSequenceRef.current += 1;
    dashboardRequestSequenceRef.current += 1;
    if (dashboardRefreshTimerRef.current !== null) {
      window.clearTimeout(dashboardRefreshTimerRef.current);
      dashboardRefreshTimerRef.current = null;
    }
    lastDeviceSyncAtRef.current = 0;
    setDevices([]);
    setSelectedDeviceId("");
    setDetailOpen(false);
    setEvents([]);
    setDashboardState({ snapshot: null, loading: selectedProjectId.length > 0, error: null });
  }, [selectedProjectId]);
  useEffect(() => (): void => {
    if (dashboardRefreshTimerRef.current !== null) window.clearTimeout(dashboardRefreshTimerRef.current);
  }, []);
  useEffect(() => { void initializeProjects(); }, [initializeProjects]);
  useEffect(() => { void loadMqttStatus(); }, [loadMqttStatus]);
  useEffect(() => { pausedRef.current = eventPaused; }, [eventPaused]);
  useEffect(() => {
    const sync = (): void => selectTab(readTab(), false);
    window.addEventListener("popstate", sync);
    return (): void => window.removeEventListener("popstate", sync);
  }, [selectTab]);
  useEffect(() => {
    if (requestedTab !== activeTab) selectTab(requestedTab, false);
  }, [activeTab, requestedTab, selectTab]);
  useEffect(() => {
    const previousTab = previousActiveTabRef.current;
    previousActiveTabRef.current = activeTab;
    if (activeTab === "dashboard" && previousTab !== "dashboard" && selectedProject !== undefined) void loadDashboardSnapshot(selectedProject.projectId, selectedProject.token);
  }, [activeTab, loadDashboardSnapshot, selectedProject]);
  useEffect(() => {
    if (activeTab === "operations") void loadOperationalMetrics();
  }, [activeTab, loadOperationalMetrics]);
  useEffect(() => {
    if (activeTab === "accounts" && projectUserSessionToken.length === 0) void loadAccounts().catch((error: unknown) => { reportError(error, "加载用户账号失败。"); });
  }, [activeTab, loadAccounts, projectUserSessionToken, reportError]);
  useEffect(() => {
    if (selectedProject === undefined) {
      setDevices([]);
      setEvents([]);
      setDashboardState({ snapshot: null, loading: false, error: null });
      updateEventStatus("未连接");
      return;
    }
    setEvents([]);
    void refreshDevices();
    void refreshCommandHistory("replace");
    void loadDashboardSnapshot(selectedProject.projectId, selectedProject.token);
    updateEventStatus("连接中");
    const eventCredential = selectedProject.token.startsWith(projectUserSessionPrefix)
      ? `session=${encodeURIComponent(selectedProject.token.slice(projectUserSessionPrefix.length))}`
      : `token=${encodeURIComponent(selectedProject.token)}`;
    return createEventStream(`/api/v1/events?projectId=${encodeURIComponent(selectedProject.projectId)}&${eventCredential}`, {
      onStatus: (status) => {
        updateEventStatus(status === "connected" ? "已连接" : status === "reconnecting" ? "重连中" : "已断开");
        if (status === "connected") void refreshCommandHistory("merge");
      },
      onEvent: (name, payload) => {
        if (name === "connected") return;
        consumeCommandEvent(name, payload);
        scheduleDashboardRefresh(selectedProject.projectId, selectedProject.token);
        if (!pausedRef.current) setEvents((current) => [{ id: `${Date.now()}-${Math.random()}`, name, payload, receivedAt: new Date().toISOString() }, ...current].slice(0, 100));
        if (name === "device_online" || name === "device_offline") {
          void refreshDevices();
          return;
        }
        if (name !== "device_report") return;
        const device = readDeviceReportEvent(payload);
        if (device !== null && device.projectId === selectedProject.projectId) {
          setDevices((current) => current.some((item) => item.deviceId === device.deviceId)
            ? current.map((item) => item.deviceId === device.deviceId ? device : item)
            : [device, ...current]);
        }
        const now = Date.now();
        if (now - lastDeviceSyncAtRef.current >= 30_000) {
          lastDeviceSyncAtRef.current = now;
          void refreshDevices();
        }
      }
    });
  }, [consumeCommandEvent, loadDashboardSnapshot, refreshCommandHistory, refreshDevices, scheduleDashboardRefresh, selectedProject, updateEventStatus]);

  const createProject = async (projectId: string, name: string, username: string, password: string): Promise<void> => {
    try {
      const response = await requestJson<ProjectRecord>("/api/v1/projects", { method: "POST", body: { projectId, name, account: { username, password } }, headers: adminHeaders(adminToken) });
      writeOutput(response);
      onSelectedProjectIdChange(response.data.projectId);
      await loadProjects();
    } catch (error: unknown) {
      throw reportError(error, "创建项目失败。");
    }
  };
  const reviewAccount = async (account: ProjectAccount, decision: "approve" | "reject"): Promise<void> => {
    try {
      const response = await requestJson<ProjectAccount>(`/api/v1/admin/accounts/${encodeURIComponent(account.id)}/review`, { method: "POST", body: { decision }, headers: adminHeaders(adminToken) });
      writeOutput(response);
      await Promise.all([loadAccounts(), loadProjects()]);
    } catch (error: unknown) {
      throw reportError(error, "审核用户账号失败。");
    }
  };
  const renameProject = async (project: ProjectRecord, name: string): Promise<void> => {
    try {
      const response = await requestJson<ProjectRecord>(`/api/v1/projects/${encodeURIComponent(project.projectId)}`, { method: "PUT", body: { name }, headers: projectHeaders(project.token) });
      writeOutput(response);
      message.success("项目中文名称已更新。");
      await loadProjects();
    } catch (error: unknown) {
      throw reportError(error, "修改项目名称失败。");
    }
  };
  const sendCommand = async (deviceId: string, name: string, payload: JsonObject): Promise<DeviceCommand> => {
    if (selectedProject === undefined) throw reportError(new Error("请先添加并选择项目。"), "下发命令失败。");
    const targetProject = selectedProject;
    try {
      const response = await requestJson<DeviceCommand>(`/api/v1/devices/${encodeURIComponent(targetProject.projectId)}/${encodeURIComponent(deviceId)}/commands`, { method: "POST", body: { name, payload }, headers: projectHeaders(targetProject.token) });
      writeOutput(response);
      if (selectedProjectIdRef.current === targetProject.projectId) mergeTimelineCommands([response.data]);
      return response.data;
    } catch (error: unknown) {
      throw reportError(error, "下发命令失败。");
    }
  };
  const sendBatchCommand = async (deviceIds: readonly string[], name: string, payload: JsonObject): Promise<BatchDeviceCommandResult> => {
    if (selectedProject === undefined) throw reportError(new Error("请先添加并选择项目。"), "批量下发命令失败。");
    const targetProject = selectedProject;
    try {
      const response = await requestJson<BatchDeviceCommandResult>("/api/v1/commands/batch", {
        method: "POST",
        body: { projectId: targetProject.projectId, deviceIds, command: { name, payload } },
        headers: projectHeaders(targetProject.token)
      });
      writeOutput(response);
      if (selectedProjectIdRef.current === targetProject.projectId) mergeTimelineCommands(response.data.commands);
      return response.data;
    } catch (error: unknown) {
      throw reportError(error, "批量下发命令失败。");
    }
  };
  const report = async (input: ReportInput): Promise<DeviceRecord> => {
    if (selectedProject === undefined) throw reportError(new Error("请先添加并选择项目。"), "模拟上报失败。");
    const targetProject = selectedProject;
    try {
      const response = await requestJson<DeviceRecord>(`/api/v1/devices/${encodeURIComponent(targetProject.projectId)}/${encodeURIComponent(input.deviceId)}/simulate`, { method: "POST", body: { projectId: targetProject.projectId, token: targetProject.token, ...input }, headers: {} });
      writeOutput(response);
      await loadDevices(targetProject.projectId, targetProject.token);
      return response.data;
    } catch (error: unknown) {
      throw reportError(error, "模拟上报失败。");
    }
  };
  const batchReport = async (reports: readonly ReportInput[]): Promise<readonly DeviceRecord[]> => {
    if (selectedProject === undefined) throw reportError(new Error("请先添加并选择项目。"), "批量上报失败。");
    try {
      const response = await requestJson<{ readonly count: number; readonly devices: readonly DeviceRecord[] }>("/api/v1/devices/batch-report", { method: "POST", body: { projectId: selectedProject.projectId, token: selectedProject.token, reports }, headers: {} });
      writeOutput(response);
      await loadDevices(selectedProject.projectId, selectedProject.token);
      return response.data.devices;
    } catch (error: unknown) {
      throw reportError(error, "批量上报失败。");
    }
  };
  const importDevices = async (devicesToImport: readonly ReportInput[]): Promise<readonly DeviceRecord[]> => {
    if (selectedProject === undefined) throw reportError(new Error("请先添加并选择项目。"), "批量导入失败。");
    try {
      const response = await requestJson<{ readonly count: number; readonly devices: readonly DeviceRecord[] }>("/api/v1/devices/import", { method: "POST", body: { projectId: selectedProject.projectId, token: selectedProject.token, devices: devicesToImport }, headers: {} });
      writeOutput(response);
      await loadDevices(selectedProject.projectId, selectedProject.token);
      return response.data.devices;
    } catch (error: unknown) {
      throw reportError(error, "批量导入失败。");
    }
  };
  const control = (deviceId: string): void => {
    setSelectedDeviceId(deviceId);
    setDetailOpen(true);
  };
  const navigateDeviceCommands = (): void => { setDetailOpen(false); setCommandPanel("relays"); selectTab("commands", true); };
  const navigateDeviceReport = (): void => { setDetailOpen(false); setCommandPanel("report"); selectTab("commands", true); };
  const resetToken = async (project: ProjectRecord): Promise<void> => {
    try {
      const response = await requestJson<{ readonly newToken: string }>(`/api/v1/projects/${encodeURIComponent(project.projectId)}/reset-token`, { method: "POST", body: null, headers: projectHeaders(project.token) });
      writeOutput(response);
      message.success("Token 已重置，旧 Token 已失效。");
      await loadProjects();
    } catch (error: unknown) {
      reportError(error, "重置 Token 失败。");
    }
  };
  const deleteProject = async (project: ProjectRecord): Promise<void> => {
    try {
      const response = await requestJson<{ readonly deleted: boolean; readonly projectId: string }>(`/api/v1/projects/${encodeURIComponent(project.projectId)}`, { method: "DELETE", body: null, headers: projectHeaders(project.token) });
      writeOutput(response);
    } catch (error: unknown) {
      throw reportError(error, "删除项目失败。");
    }
    const remainingProjects = projects.filter((item) => item.projectId !== project.projectId);
    setProjects(remainingProjects);
    onProjectsChange(remainingProjects);
    if (selectedProjectId === project.projectId) {
      onSelectedProjectIdChange(remainingProjects[0]?.projectId ?? "");
      setSelectedDeviceId("");
      setDevices([]);
      setEvents([]);
      setDetailOpen(false);
    }
    message.success(`项目 ${project.projectId} 已永久删除。`);
    try {
      await loadProjects();
    } catch (error: unknown) {
      reportError(error, "项目已删除，但项目列表刷新失败。");
    }
  };
  const probeDevice = async (deviceId: string): Promise<ProbeResult> => {
    if (selectedProject === undefined) throw reportError(new Error("请先添加并选择项目。"), "探测失败。");
    try {
      const response = await requestJson<ProbeResult>("/api/v1/devices/probe", { method: "POST", body: { projectId: selectedProject.projectId, token: selectedProject.token, deviceId }, headers: {} });
      writeOutput(response);
      return response.data;
    } catch (error: unknown) {
      throw reportError(error, "探测失败。");
    }
  };
  const refreshProjects = useCallback(async (): Promise<void> => {
    try {
      await loadProjects();
    } catch (error: unknown) {
      reportError(error, "加载项目失败。");
    }
  }, [loadProjects, reportError]);
  const refreshAccounts = useCallback(async (): Promise<void> => {
    try {
      await loadAccounts();
    } catch (error: unknown) {
      reportError(error, "加载用户账号失败。");
    }
  }, [loadAccounts, reportError]);
  const refreshEvents = useCallback(async (): Promise<void> => {
    setEvents([]);
    await refreshDevices();
  }, [refreshDevices]);
  const refreshCommands = useCallback(async (): Promise<void> => {
    await Promise.all([refreshDevices(), refreshCommandHistory("replace")]);
  }, [refreshCommandHistory, refreshDevices]);
  const refreshAutomation = useCallback(async (): Promise<void> => {
    setAutomationRefreshKey((current) => current + 1);
  }, []);
  const refreshOperations = useCallback(async (): Promise<void> => {
    await Promise.all([loadOperationalMetrics(), loadMqttStatus()]);
  }, [loadMqttStatus, loadOperationalMetrics]);
  const refreshByTab = useMemo<Readonly<Record<AdminTabKey, () => Promise<void>>>>(() => ({
    dashboard: refreshAll,
    projects: refreshProjects,
    accounts: refreshAccounts,
    operations: refreshOperations,
    devices: refreshDevices,
    commands: refreshCommands,
    events: refreshEvents,
    automation: refreshAutomation,
    serial: refreshDevices
  }), [refreshAll, refreshAutomation, refreshCommands, refreshDevices, refreshEvents, refreshOperations, refreshProjects]);
  useEffect(() => onRefreshChange(refreshByTab[activeTab]), [activeTab, onRefreshChange, refreshByTab]);
  const retryDashboard = useCallback((): void => {
    if (selectedProject !== undefined) void loadDashboardSnapshot(selectedProject.projectId, selectedProject.token);
  }, [loadDashboardSnapshot, selectedProject]);
  const navigateTo = useCallback((tab: "projects" | "operations" | "devices" | "commands" | "events" | "automation"): void => selectTab(tab, true), [selectTab]);
  const openProjectWorkspace = useCallback((projectId: string): void => {
    onSelectedProjectIdChange(projectId);
    selectTab("dashboard", true);
  }, [onSelectedProjectIdChange, selectTab]);

  const content: Readonly<Record<AdminTabKey, JSX.Element>> = {
    dashboard: <DashboardTab selectedProject={selectedProject} state={dashboardState} eventStatus={eventStatus} events={events} onNavigate={navigateTo} onRetry={retryDashboard} />,
    projects: <ProjectsTab projects={projects} selectedProjectId={selectedProjectId} onCreate={createProject} onSelect={openProjectWorkspace} onRename={renameProject} onResetToken={resetToken} onDelete={deleteProject} onOutput={writeOutput} />,
    accounts: <AccountsPanel accounts={accounts} loading={accountsLoading} onReview={reviewAccount} onRefresh={refreshAccounts} />,
    operations: <OperationsTab state={operationsState} mqttStatus={mqttStatus} onRefresh={() => void refreshOperations()} onNavigate={(tab) => selectTab(tab, true)} />,
    devices: <DevicesTab devices={devices} onControl={control} onRefresh={() => void refreshDevices()} />,
    commands: <CommandsTab devices={devices} selectedDeviceId={selectedDeviceId} timeline={timeline} onSelectDevice={setSelectedDeviceId} onSend={sendCommand} onSendBatch={sendBatchCommand} onReport={report} onBatchReport={batchReport} onImport={importDevices} onOutput={writeOutput} requestedPanel={commandPanel} />,
    events: <EventsTab events={events} paused={eventPaused} onPausedChange={setEventPaused} onClear={() => setEvents([])} />,
    automation: <Suspense fallback={<div style={{ minHeight: 240, display: "grid", placeItems: "center" }}><Spin tip="正在加载自动化管理…" /></div>}><AutomationTab key={automationRefreshKey} project={selectedProject} devices={devices} /></Suspense>,
    serial: <Suspense fallback={<div style={{ minHeight: 240, display: "grid", placeItems: "center" }}><Spin /></div>}><SerialTab project={selectedProject} devices={devices} /></Suspense>
  };
  return <>
    {content[activeTab]}
    <DeviceDetailPanel device={detailDevice} open={detailOpen} onClose={() => setDetailOpen(false)} onSend={sendCommand} onNavigateCommands={navigateDeviceCommands} onNavigateReport={navigateDeviceReport} onProbe={probeDevice} />
    <ApiReturnDrawer open={drawerOpen} value={output} onClose={() => onDrawerOpenChange(false)} onClear={() => setOutput({})} />
  </>;
};
