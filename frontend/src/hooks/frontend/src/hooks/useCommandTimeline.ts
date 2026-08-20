import { useCallback, useEffect, useState } from "react";
import type { DeviceCommand, EventName } from "../types";

export type CommandTimelineItem = {
  readonly id: string;
  readonly name: string;
  readonly deviceId: string;
  readonly queuedAt: string;
  readonly expiresAt: string;
  readonly status: "queued" | "acked" | "expired";
};
export const commandTimelineStatus = (status: CommandTimelineItem["status"]): { readonly color: string; readonly label: string } => {
  if (status === "acked") return { color: "green", label: "已确认" };
  if (status === "expired") return { color: "red", label: "已过期" };
  return { color: "gold", label: "已入队" };
};

type CommandEventPayload = {
  readonly id: string;
  readonly name: string;
  readonly deviceId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
};

const commandStatus = (command: DeviceCommand): CommandTimelineItem["status"] => {
  if (command.status === "acked") return "acked";
  if (command.status === "expired" || Date.parse(command.expiresAt) <= Date.now()) return "expired";
  return "queued";
};

const commandToTimelineItem = (command: DeviceCommand): CommandTimelineItem => ({
  id: command.id,
  name: command.name,
  deviceId: command.deviceId,
  queuedAt: command.createdAt,
  expiresAt: command.expiresAt,
  status: commandStatus(command)
});

const preserveFinalStatus = (current: CommandTimelineItem | undefined, incoming: CommandTimelineItem): CommandTimelineItem => {
  if (current?.status === "acked" && incoming.status !== "acked") return { ...incoming, status: "acked" };
  if (current?.status === "expired" && incoming.status === "queued") return { ...incoming, status: "expired" };
  return incoming;
};

const mergeTimelineItems = (current: readonly CommandTimelineItem[], incoming: readonly CommandTimelineItem[]): readonly CommandTimelineItem[] => {
  const currentById = new Map(current.map((item) => [item.id, item]));
  const mergedById = new Map(currentById);
  incoming.forEach((item) => mergedById.set(item.id, preserveFinalStatus(currentById.get(item.id), item)));
  return [...mergedById.values()].sort((left, right) => right.queuedAt.localeCompare(left.queuedAt)).slice(0, 50);
};

const readTimestamp = (value: object, key: string): string | null => {
  if (!(key in value)) return null;
  const timestamp = Reflect.get(value, key) as unknown;
  return typeof timestamp === "string" && !Number.isNaN(Date.parse(timestamp)) ? timestamp : null;
};

const readCommand = (payload: unknown): CommandEventPayload | null => {
  if (typeof payload !== "object" || payload === null || !("command" in payload)) return null;
  const command = payload.command;
  if (typeof command !== "object" || command === null) return null;
  const id = "id" in command && typeof command.id === "string" ? command.id : null;
  const name = "name" in command && typeof command.name === "string" ? command.name : null;
  const deviceId = "deviceId" in command && typeof command.deviceId === "string" ? command.deviceId : null;
  const createdAt = readTimestamp(command, "createdAt");
  const expiresAt = readTimestamp(command, "expiresAt");
  return id === null || name === null || deviceId === null || createdAt === null || expiresAt === null ? null : { id, name, deviceId, createdAt, expiresAt };
};

export const useCommandTimeline = (projectId: string): readonly [
  readonly CommandTimelineItem[],
  (name: EventName, payload: unknown) => void,
  (commands: readonly DeviceCommand[]) => void,
  (commands: readonly DeviceCommand[]) => void
] => {
  const [items, setItems] = useState<readonly CommandTimelineItem[]>([]);

  useEffect(() => setItems([]), [projectId]);
  useEffect(() => {
    const expireItems = (): void => {
      const now = Date.now();
      setItems((current) => {
        let changed = false;
        const next = current.map((item) => {
          if (item.status !== "queued" || Date.parse(item.expiresAt) > now) return item;
          changed = true;
          return { ...item, status: "expired" as const };
        });
        return changed ? next : current;
      });
    };
    expireItems();
    const timer = window.setInterval(expireItems, 10_000);
    return (): void => window.clearInterval(timer);
  }, []);

  const consumeEvent = useCallback((name: EventName, payload: unknown): void => {
    const command = readCommand(payload);
    if (command === null) return;
    if (name === "command_queued") {
      const queuedItem: CommandTimelineItem = { id: command.id, name: command.name, deviceId: command.deviceId, queuedAt: command.createdAt, expiresAt: command.expiresAt, status: Date.parse(command.expiresAt) <= Date.now() ? "expired" : "queued" };
      setItems((current) => mergeTimelineItems(current, [queuedItem]));
      return;
    }
    if (name === "command_acked") {
      const acknowledgedItem: CommandTimelineItem = { id: command.id, name: command.name, deviceId: command.deviceId, queuedAt: command.createdAt, expiresAt: command.expiresAt, status: "acked" };
      setItems((current) => mergeTimelineItems(current, [acknowledgedItem]));
      return;
    }
    if (name === "command_expired") {
      const expiredItem: CommandTimelineItem = { id: command.id, name: command.name, deviceId: command.deviceId, queuedAt: command.createdAt, expiresAt: command.expiresAt, status: "expired" };
      setItems((current) => mergeTimelineItems(current, [expiredItem]));
    }
  }, []);

  const replaceCommands = useCallback((commands: readonly DeviceCommand[]): void => {
    setItems(commands.map(commandToTimelineItem).sort((left, right) => right.queuedAt.localeCompare(left.queuedAt)).slice(0, 50));
  }, []);

  const mergeCommands = useCallback((commands: readonly DeviceCommand[]): void => {
    const incoming = commands.map(commandToTimelineItem);
    setItems((current) => mergeTimelineItems(current, incoming));
  }, []);

  return [items, consumeEvent, replaceCommands, mergeCommands] as const;
};
