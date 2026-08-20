import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createAppError } from "./errors.js";
import type { EventHub } from "./events.js";
import type { DataStore } from "./store.js";
import type { DeviceRecord, ForwarderRecord, JsonObject, JsonValue } from "./types.js";

type DeliveryResult = {
  readonly status: "success" | "failed";
  readonly statusCode: number | null;
  readonly durationMs: number;
};

export type MqttReportPublisher = (topic: string, payload: JsonValue) => boolean;

const retryDelaysMs = [0, 250, 750] as const;

const wait = async (delayMs: number): Promise<void> => {
  if (delayMs === 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
};

const isPrivateIpv4 = (address: string): boolean => {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const first = octets[0] as number;
  const second = octets[1] as number;
  return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
};

const isPrivateAddress = (address: string): boolean => {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("::ffff:");
};

const parseWebhookUrl = async (value: JsonValue | undefined, allowedHosts: readonly string[]): Promise<URL> => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw createAppError(422, "INVALID_FORWARDER_CONFIG", "Webhook forwarder config.url must be a non-empty string.", null);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw createAppError(422, "INVALID_FORWARDER_CONFIG", "Webhook forwarder config.url must be a valid URL.", { url: value });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw createAppError(422, "INVALID_FORWARDER_CONFIG", "Webhook forwarder config.url must use HTTP or HTTPS.", { url: value });
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw createAppError(422, "INVALID_FORWARDER_CONFIG", "Webhook URL must not contain embedded credentials.", { url: value });
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const explicitlyAllowed = allowedHosts.some((host) => host.trim().toLowerCase() === hostname);
  if (explicitlyAllowed) return url;
  if (hostname === "localhost" || isPrivateAddress(hostname)) {
    throw createAppError(403, "FORWARDER_TARGET_FORBIDDEN", "Webhook target is private. Add its hostname to FORWARDER_ALLOWED_HOSTS if this is intentional.", { hostname });
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw createAppError(403, "FORWARDER_TARGET_FORBIDDEN", "Webhook target resolves to a private or invalid address.", { hostname });
  }
  return url;
};

const reportKeys = (device: DeviceRecord): ReadonlySet<string> => new Set([
  ...device.lastReport.values.map((value) => value.key),
  ...device.lastReport.relays.map((relay) => relay.key),
  ...device.lastReport.alarms.map((alarm) => alarm.key)
]);

const forwarderMatches = (forwarder: ForwarderRecord, device: DeviceRecord): boolean => {
  if (!forwarder.enabled || forwarder.projectId !== device.projectId) return false;
  if (forwarder.filter === null) return true;
  const deviceMatches = forwarder.filter.deviceIds.length === 0 || forwarder.filter.deviceIds.includes(device.deviceId);
  const keys = reportKeys(device);
  const keyMatches = forwarder.filter.keys.length === 0 || forwarder.filter.keys.some((key) => keys.has(key));
  return deviceMatches && keyMatches;
};

const createPayload = (forwarder: ForwarderRecord, device: DeviceRecord): JsonObject => ({
  eventType: "device_report",
  forwarderId: forwarder.id,
  deliveredAt: new Date().toISOString(),
  device
});

const sendWebhook = async (forwarder: ForwarderRecord, device: DeviceRecord, allowedHosts: readonly string[]): Promise<DeliveryResult> => {
  const url = await parseWebhookUrl(forwarder.config.url, allowedHosts);
  const startedAt = performance.now();
  let lastStatusCode: number | null = null;
  let lastReason = "Unknown delivery failure.";

  for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
    await wait(retryDelaysMs[attempt] as number);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarder-id": forwarder.id
        },
        body: JSON.stringify(createPayload(forwarder, device)),
        signal: AbortSignal.timeout(5_000),
        redirect: "error"
      });
      lastStatusCode = response.status;
      if (response.ok) return { status: "success", statusCode: response.status, durationMs: Math.round(performance.now() - startedAt) };
      lastReason = `HTTP ${response.status}`;
      if (response.status < 500 && response.status !== 429) break;
    } catch (error: unknown) {
      lastReason = error instanceof Error ? error.message : "Unknown network failure.";
    }
    console.warn("forwarder_delivery_retry", { forwarderId: forwarder.id, attempt: attempt + 1, url: url.toString(), statusCode: lastStatusCode, reason: lastReason });
  }

  console.error("forwarder_delivery_failed", { forwarderId: forwarder.id, url: url.toString(), statusCode: lastStatusCode, reason: lastReason });
  return { status: "failed", statusCode: lastStatusCode, durationMs: Math.round(performance.now() - startedAt) };
};

const deliverForwarder = async (forwarder: ForwarderRecord, device: DeviceRecord, allowedHosts: readonly string[], publishMqtt: MqttReportPublisher | null): Promise<DeliveryResult> => {
  if (forwarder.type === "webhook") return sendWebhook(forwarder, device, allowedHosts);
  const topic = forwarder.config.topic;
  if (typeof topic !== "string" || topic.trim().length === 0 || topic.includes("#") || topic.includes("+")) {
    console.error("forwarder_delivery_failed", { forwarderId: forwarder.id, reason: "MQTT forwarder config.topic must be a non-empty publish topic without wildcards." });
    return { status: "failed", statusCode: null, durationMs: 0 };
  }
  if (publishMqtt === null) {
    console.error("forwarder_delivery_failed", { forwarderId: forwarder.id, reason: "MQTT forwarder requires an active MQTT bridge." });
    return { status: "failed", statusCode: null, durationMs: 0 };
  }
  const startedAt = performance.now();
  const published = publishMqtt(topic, createPayload(forwarder, device));
  return { status: published ? "success" : "failed", statusCode: null, durationMs: Math.round(performance.now() - startedAt) };
};

export const dispatchReportForwarders = async (
  store: DataStore,
  eventHub: EventHub,
  device: DeviceRecord,
  allowedHosts: readonly string[],
  publishMqtt: MqttReportPublisher | null
): Promise<void> => {
  const forwarders = (await store.listForwarders(device.projectId)).filter((forwarder) => forwarderMatches(forwarder, device));
  await Promise.all(forwarders.map(async (forwarder) => {
    let result: DeliveryResult;
    try {
      result = await deliverForwarder(forwarder, device, allowedHosts, publishMqtt);
    } catch (error: unknown) {
      console.error("forwarder_delivery_failed", { forwarderId: forwarder.id, reason: error instanceof Error ? error.message : "Unknown forwarder failure." });
      result = { status: "failed", statusCode: null, durationMs: 0 };
    }
    await store.logWebhookDelivery(forwarder.id, "device_report", result.status, result.statusCode, result.durationMs);
    eventHub.publish({
      type: "forwarder_delivery",
      projectId: device.projectId,
      forwarderId: forwarder.id,
      deviceId: device.deviceId,
      status: result.status
    });
  }));
};
