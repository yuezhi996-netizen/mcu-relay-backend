import type { DeviceCommand, DeviceHealth, DeviceRecord, DeviceShadow, JsonObject, OTATask, RuleRecord, VerifySession } from "./types.js";

export type ServerEvent =
  | {
      readonly type: "device_report";
      readonly device: DeviceRecord;
    }
  | {
      readonly type: "command_queued";
      readonly command: DeviceCommand;
    }
  | {
      readonly type: "command_dispatched";
      readonly command: DeviceCommand;
    }
  | {
      readonly type: "command_acked";
      readonly command: DeviceCommand;
    }
  | {
      readonly type: "command_state_confirmed";
      readonly command: DeviceCommand;
    }
  | {
      readonly type: "command_requeued";
      readonly command: DeviceCommand;
    }
  | {
      readonly type: "command_failed";
      readonly command: DeviceCommand;
    }
  | {
      readonly type: "command_expired";
      readonly command: DeviceCommand;
    }
  | {
      readonly type: "command_superseded";
      readonly command: DeviceCommand;
    }
  | { readonly type: "device_verified"; readonly verify: VerifySession }
  | { readonly type: "device_online"; readonly deviceId: string; readonly projectId: string }
  | { readonly type: "device_offline"; readonly deviceId: string; readonly projectId: string; readonly lastSeenAt: string }
  | { readonly type: "device_health_changed"; readonly projectId: string; readonly deviceId: string; readonly health: DeviceHealth; readonly previousHealth: DeviceHealth | null }
  | { readonly type: "remote_debug_data"; readonly projectId: string; readonly deviceId: string; readonly encoding: "base64"; readonly data: string; readonly byteLength: number; readonly receivedAt: string }
  | { readonly type: "remote_debug_log"; readonly id: number; readonly projectId: string; readonly deviceId: string; readonly direction: "TX" | "RX"; readonly encoding: "base64"; readonly data: string; readonly byteLength: number; readonly receivedAt: string }
  | { readonly type: "rule_triggered"; readonly rule: RuleRecord; readonly deviceId: string; readonly triggeredValues: JsonObject }
  | { readonly type: "shadow_updated"; readonly shadow: DeviceShadow }
  | { readonly type: "firmware_progress"; readonly ota: OTATask }
  | { readonly type: "forwarder_delivery"; readonly projectId: string; readonly forwarderId: string; readonly deviceId: string; readonly status: "success" | "failed" }
  | { readonly type: "alarm_triggered"; readonly projectId: string; readonly deviceId: string; readonly alarmKey: string }
  | { readonly type: "project_deleted"; readonly projectId: string };

export type EventSubscriber = (event: ServerEvent) => void;

export type EventHub = {
  readonly publish: (event: ServerEvent) => void;
  readonly subscribe: (subscriber: EventSubscriber) => () => void;
};

export const createEventHub = (): EventHub => {
  const subscribers = new Set<EventSubscriber>();

  return {
    publish: (event: ServerEvent) => {
      for (const subscriber of subscribers) {
        subscriber(event);
      }
    },
    subscribe: (subscriber: EventSubscriber) => {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    }
  };
};
