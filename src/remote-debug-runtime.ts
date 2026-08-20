import type { EventHub } from "./events.js";

export type RemoteDebugLogDirection = "TX" | "RX";

export type RemoteDebugLogEntry = {
  readonly id: number;
  readonly projectId: string;
  readonly deviceId: string;
  readonly direction: RemoteDebugLogDirection;
  readonly encoding: "base64";
  readonly data: string;
  readonly byteLength: number;
  readonly receivedAt: string;
};

export type RemoteDebugRuntimeSnapshot = {
  readonly active: boolean;
  readonly openedAt: string | null;
  readonly closedAt: string | null;
  readonly lastActivityAt: string | null;
  readonly txFrames: number;
  readonly txBytes: number;
  readonly rxFrames: number;
  readonly rxBytes: number;
  readonly retainedEntries: number;
};

export type RemoteDebugLogPage = {
  readonly total: number;
  readonly retainedLimit: number;
  readonly items: readonly RemoteDebugLogEntry[];
};

export type RemoteDebugRuntime = {
  readonly getSnapshot: (projectId: string, deviceId: string) => RemoteDebugRuntimeSnapshot;
  readonly listLogs: (projectId: string, deviceId: string, limit: number) => RemoteDebugLogPage;
  readonly markOpened: (projectId: string, deviceId: string) => RemoteDebugRuntimeSnapshot;
  readonly markClosed: (projectId: string, deviceId: string) => RemoteDebugRuntimeSnapshot;
  readonly markOffline: (projectId: string, deviceId: string) => RemoteDebugRuntimeSnapshot;
  readonly recordTransmit: (projectId: string, deviceId: string, data: string, byteLength: number) => RemoteDebugLogEntry;
  readonly clearLogs: (projectId: string, deviceId: string) => number;
};

type RemoteDebugDeviceState = RemoteDebugRuntimeSnapshot & {
  readonly entries: readonly RemoteDebugLogEntry[];
};

const retainedEntryLimit = 2_000;
const retainedDeviceLimit = 1_000;

const createDeviceKey = (projectId: string, deviceId: string): string => JSON.stringify([projectId, deviceId]);

const createEmptyState = (): RemoteDebugDeviceState => ({
  active: false,
  openedAt: null,
  closedAt: null,
  lastActivityAt: null,
  txFrames: 0,
  txBytes: 0,
  rxFrames: 0,
  rxBytes: 0,
  retainedEntries: 0,
  entries: []
});

const toSnapshot = (state: RemoteDebugDeviceState): RemoteDebugRuntimeSnapshot => ({
  active: state.active,
  openedAt: state.openedAt,
  closedAt: state.closedAt,
  lastActivityAt: state.lastActivityAt,
  txFrames: state.txFrames,
  txBytes: state.txBytes,
  rxFrames: state.rxFrames,
  rxBytes: state.rxBytes,
  retainedEntries: state.retainedEntries
});

const appendEntry = (state: RemoteDebugDeviceState, entry: RemoteDebugLogEntry): RemoteDebugDeviceState => {
  const entries = [...state.entries, entry].slice(-retainedEntryLimit);
  return {
    ...state,
    lastActivityAt: entry.receivedAt,
    txFrames: state.txFrames + (entry.direction === "TX" ? 1 : 0),
    txBytes: state.txBytes + (entry.direction === "TX" ? entry.byteLength : 0),
    rxFrames: state.rxFrames + (entry.direction === "RX" ? 1 : 0),
    rxBytes: state.rxBytes + (entry.direction === "RX" ? entry.byteLength : 0),
    retainedEntries: entries.length,
    entries
  };
};

export const createRemoteDebugRuntime = (eventHub: EventHub, now: () => string): RemoteDebugRuntime => {
  const states = new Map<string, RemoteDebugDeviceState>();
  let nextEntryId = 0;

  const readState = (projectId: string, deviceId: string): RemoteDebugDeviceState => states.get(createDeviceKey(projectId, deviceId)) ?? createEmptyState();

  const writeState = (projectId: string, deviceId: string, state: RemoteDebugDeviceState): void => {
    const key = createDeviceKey(projectId, deviceId);
    if (!states.has(key) && states.size >= retainedDeviceLimit) {
      const oldestKey = states.keys().next().value;
      if (typeof oldestKey === "string") states.delete(oldestKey);
    }
    states.delete(key);
    states.set(key, state);
  };

  const recordEntry = (projectId: string, deviceId: string, direction: RemoteDebugLogDirection, data: string, byteLength: number, receivedAt: string): RemoteDebugLogEntry => {
    const entry: RemoteDebugLogEntry = {
      id: ++nextEntryId,
      projectId,
      deviceId,
      direction,
      encoding: "base64",
      data,
      byteLength,
      receivedAt
    };
    writeState(projectId, deviceId, appendEntry(readState(projectId, deviceId), entry));
    return entry;
  };

  const markOffline = (projectId: string, deviceId: string): RemoteDebugRuntimeSnapshot => {
    const current = readState(projectId, deviceId);
    const state = current.active ? { ...current, active: false, closedAt: now() } : current;
    writeState(projectId, deviceId, state);
    return toSnapshot(state);
  };

  eventHub.subscribe((event) => {
    if (event.type === "remote_debug_data") {
      const entry = recordEntry(event.projectId, event.deviceId, "RX", event.data, event.byteLength, event.receivedAt);
      eventHub.publish({
        type: "remote_debug_log",
        ...entry
      });
      return;
    }
    if (event.type === "device_offline") {
      markOffline(event.projectId, event.deviceId);
      return;
    }
    if (event.type !== "project_deleted") return;
    for (const [key] of states) {
      const parsed = JSON.parse(key) as readonly [string, string];
      if (parsed[0] === event.projectId) states.delete(key);
    }
  });

  return {
    getSnapshot: (projectId: string, deviceId: string) => toSnapshot(readState(projectId, deviceId)),
    listLogs: (projectId: string, deviceId: string, limit: number) => {
      const entries = readState(projectId, deviceId).entries;
      return {
        total: entries.length,
        retainedLimit: retainedEntryLimit,
        items: entries.slice(-limit)
      };
    },
    markOpened: (projectId: string, deviceId: string) => {
      const openedAt = now();
      const state: RemoteDebugDeviceState = {
        ...readState(projectId, deviceId),
        active: true,
        openedAt,
        closedAt: null
      };
      writeState(projectId, deviceId, state);
      return toSnapshot(state);
    },
    markClosed: (projectId: string, deviceId: string) => {
      const state: RemoteDebugDeviceState = {
        ...readState(projectId, deviceId),
        active: false,
        closedAt: now()
      };
      writeState(projectId, deviceId, state);
      return toSnapshot(state);
    },
    markOffline,
    recordTransmit: (projectId: string, deviceId: string, data: string, byteLength: number) => recordEntry(projectId, deviceId, "TX", data, byteLength, now()),
    clearLogs: (projectId: string, deviceId: string) => {
      const current = readState(projectId, deviceId);
      const cleared = current.entries.length;
      writeState(projectId, deviceId, {
        ...current,
        lastActivityAt: null,
        txFrames: 0,
        txBytes: 0,
        rxFrames: 0,
        rxBytes: 0,
        retainedEntries: 0,
        entries: []
      });
      return cleared;
    }
  };
};
