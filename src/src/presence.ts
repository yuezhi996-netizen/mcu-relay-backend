import type { EventHub } from "./events.js";
import type { DataStore } from "./store.js";
import { defaultDeviceHealthSettings, getDeviceHealth } from "./device-health.js";
import type { DeviceConnectionStatus, DeviceHealth, DeviceRecord, JsonValue } from "./types.js";

export type PresenceMonitor = {
  readonly stop: () => Promise<void>;
};

export type PresenceMonitorOptions = {
  readonly store: DataStore;
  readonly eventHub: EventHub;
  readonly intervalMs: number;
  readonly getDeviceConnectionStatus?: (projectId: string, deviceId: string) => DeviceConnectionStatus;
};

const deviceKey = (projectId: string, deviceId: string): string => JSON.stringify([projectId, deviceId]);
const keyBelongsToProject = (key: string, projectId: string): boolean => {
  try {
    const parts = JSON.parse(key) as JsonValue;
    return Array.isArray(parts) && parts.length === 2 && parts[0] === projectId;
  } catch {
    return false;
  }
};
const recordAlarmState = (activeAlarms: Map<string, ReadonlySet<string>>, device: DeviceRecord): void => {
  activeAlarms.set(deviceKey(device.projectId, device.deviceId), new Set(device.lastReport.alarms.filter((alarm) => alarm.active).map((alarm) => alarm.key)));
};

export const createPresenceMonitor = async (options: PresenceMonitorOptions): Promise<PresenceMonitor> => {
  const onlineByDevice = new Map<string, boolean>();
  const healthByDevice = new Map<string, DeviceHealth>();
  const activeAlarms = new Map<string, ReadonlySet<string>>();
  const projects = await options.store.listProjects();
  for (const project of projects) {
    const devices = await options.store.listDevices(project.projectId);
    for (const device of devices) {
      const connection = options.getDeviceConnectionStatus === undefined
        ? { connected: true, connectedAt: null }
        : options.getDeviceConnectionStatus(device.projectId, device.deviceId);
      healthByDevice.set(deviceKey(device.projectId, device.deviceId), getDeviceHealth(device, connection, new Date().toISOString(), defaultDeviceHealthSettings));
      recordAlarmState(activeAlarms, device);
    }
  }

  let stopped = false;
  let scanChain: Promise<void> = Promise.resolve();
  const unsubscribe = options.eventHub.subscribe((event) => {
    if (event.type === "project_deleted") {
      for (const key of onlineByDevice.keys()) {
        if (keyBelongsToProject(key, event.projectId)) onlineByDevice.delete(key);
      }
      for (const key of activeAlarms.keys()) {
        if (keyBelongsToProject(key, event.projectId)) activeAlarms.delete(key);
      }
      for (const key of healthByDevice.keys()) {
        if (keyBelongsToProject(key, event.projectId)) healthByDevice.delete(key);
      }
      return;
    }
    if (event.type !== "device_report") return;
    const device = event.device;
    const key = deviceKey(device.projectId, device.deviceId);
    const connection = options.getDeviceConnectionStatus === undefined
      ? { connected: true, connectedAt: null }
      : options.getDeviceConnectionStatus(device.projectId, device.deviceId);
    const health = options.getDeviceConnectionStatus === undefined
      ? "ready"
      : getDeviceHealth(device, connection, new Date().toISOString(), defaultDeviceHealthSettings);
    const online = health !== "offline";
    const previousHealth = healthByDevice.get(key) ?? null;
    if (previousHealth !== health) {
      options.eventHub.publish({ type: "device_health_changed", projectId: device.projectId, deviceId: device.deviceId, health, previousHealth });
    }
    if (online && onlineByDevice.get(key) !== true) {
      options.eventHub.publish({ type: "device_online", projectId: device.projectId, deviceId: device.deviceId });
    }
    healthByDevice.set(key, health);
    onlineByDevice.set(key, online);
    const deviceAlarms = activeAlarms.get(key) ?? new Set<string>();
    const nextAlarms = new Set<string>();
    for (const alarm of device.lastReport.alarms) {
      if (alarm.active && !deviceAlarms.has(alarm.key)) {
        options.eventHub.publish({ type: "alarm_triggered", projectId: device.projectId, deviceId: device.deviceId, alarmKey: alarm.key });
      }
      if (alarm.active) nextAlarms.add(alarm.key);
    }
    activeAlarms.set(key, nextAlarms);
  });

  const scan = async (): Promise<void> => {
    const currentProjects = await options.store.listProjects();
    for (const project of currentProjects) {
      const devices = await options.store.listDevices(project.projectId);
      const statusByDevice = new Map((await options.store.listDeviceStatuses(project.projectId)).map((status) => [status.deviceId, status.online]));
      for (const device of devices) {
        const key = deviceKey(project.projectId, device.deviceId);
        const connection = options.getDeviceConnectionStatus === undefined
          ? { connected: true, connectedAt: null }
          : options.getDeviceConnectionStatus(device.projectId, device.deviceId);
        const health = options.getDeviceConnectionStatus === undefined
          ? (statusByDevice.get(device.deviceId) === true ? "ready" : "offline")
          : getDeviceHealth(device, connection, new Date().toISOString(), defaultDeviceHealthSettings);
        const previousHealth = healthByDevice.get(key) ?? null;
        if (previousHealth !== health) {
          options.eventHub.publish({ type: "device_health_changed", projectId: device.projectId, deviceId: device.deviceId, health, previousHealth });
        }
        const online = health !== "offline";
        const previousOnline = onlineByDevice.get(key);
        if (previousOnline === true && !online) {
          options.eventHub.publish({ type: "device_offline", projectId: device.projectId, deviceId: device.deviceId, lastSeenAt: device.lastSeenAt });
        }
        if (previousOnline === false && online) {
          options.eventHub.publish({ type: "device_online", projectId: device.projectId, deviceId: device.deviceId });
        }
        healthByDevice.set(key, health);
        onlineByDevice.set(key, online);
      }
    }
  };

  const timer = setInterval(() => {
    if (stopped) return;
    scanChain = scanChain.then(scan).catch((error: unknown) => {
      console.error("presence_scan_failed", { reason: error instanceof Error ? error.message : "Unknown presence scan failure." });
    });
  }, options.intervalMs);
  timer.unref();

  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      unsubscribe();
      await scanChain;
    }
  };
};
