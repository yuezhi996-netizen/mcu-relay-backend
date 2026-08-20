import type { DeviceConnectionStatus, DeviceHealth, DeviceRecord } from "./types.js";

export type DeviceHealthSettings = {
  readonly offlineAfterMs: number;
  readonly reportFreshForMs: number;
};

export const defaultDeviceHealthSettings: DeviceHealthSettings = {
  offlineAfterMs: 15_000,
  reportFreshForMs: 30_000
};

const isRecent = (timestamp: string | null, nowMs: number, durationMs: number): boolean => {
  if (timestamp === null) return false;
  const timestampMs = Date.parse(timestamp);
  return Number.isFinite(timestampMs) && timestampMs <= nowMs && nowMs - timestampMs <= durationMs;
};

export const getDeviceHealth = (device: DeviceRecord, connection: DeviceConnectionStatus, now: string, settings: DeviceHealthSettings): DeviceHealth => {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return "offline";
  if (!connection.connected || !isRecent(device.lastSeenAt, nowMs, settings.offlineAfterMs)) return "offline";
  if (!isRecent(device.lastReportAt, nowMs, settings.reportFreshForMs)) {
    return isRecent(device.lastHeartbeatAt, nowMs, settings.offlineAfterMs) ? "heartbeat_only" : "stale_state";
  }
  return "ready";
};
