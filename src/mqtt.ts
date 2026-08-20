import { createConnection, type Socket } from "node:net";
import { connect as createTlsConnection } from "node:tls";
import type { EventHub } from "./events.js";
import type { DataStore } from "./store.js";
import type { DeviceCommand, DeviceReportInput, JsonValue } from "./types.js";
import { parseCommandAckInput, parseDeviceReportInput } from "./validation.js";

export type MqttStatus = "stopped" | "connecting" | "connected" | "disconnected";

export type MqttStatusInfo = {
  readonly status: MqttStatus;
  readonly broker: string;
  readonly port: number;
  readonly clientId: string;
  readonly tls: boolean;
};

export type MqttBridge = {
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly getStatus: () => MqttStatus;
  readonly getStatusInfo: () => MqttStatusInfo;
  readonly refreshSubscriptions: () => Promise<void>;
  readonly publishCommand: (command: DeviceCommand) => boolean;
  readonly publishForwardedReport: (topic: string, payload: JsonValue) => boolean;
};

export type MqttBridgeOptions = {
  readonly broker: string;
  readonly port: number;
  readonly clientId: string;
  readonly useTls: boolean;
  readonly store: DataStore;
  readonly eventHub: EventHub;
};

export type ParsedMqttMessage = {
  readonly projectId: string;
  readonly deviceId: string;
  readonly report: DeviceReportInput;
};

type RemainingLength = {
  readonly value: number;
  readonly bytes: number;
};

const maxReceiveBufferBytes = 1024 * 1024;

const encodeString = (value: string): Buffer => {
  const content = Buffer.from(value, "utf8");
  if (content.length > 65_535) {
    throw new Error(`MQTT string exceeds 65535 bytes: ${value.slice(0, 80)}`);
  }
  const length = Buffer.allocUnsafe(2);
  length.writeUInt16BE(content.length, 0);
  return Buffer.concat([length, content]);
};

const encodeRemainingLength = (value: number): Buffer => {
  if (!Number.isInteger(value) || value < 0 || value > 268_435_455) {
    throw new Error(`Invalid MQTT remaining length: ${value}`);
  }
  const bytes: number[] = [];
  let remaining = value;
  do {
    let encoded = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) encoded |= 128;
    bytes.push(encoded);
  } while (remaining > 0);
  return Buffer.from(bytes);
};

const createPacket = (header: number, payload: Buffer): Buffer => {
  return Buffer.concat([Buffer.from([header]), encodeRemainingLength(payload.length), payload]);
};

const createConnectPacket = (clientId: string): Buffer => {
  const variableHeader = Buffer.concat([encodeString("MQTT"), Buffer.from([4, 2]), Buffer.from([0, 30])]);
  return createPacket(0x10, Buffer.concat([variableHeader, encodeString(clientId)]));
};

const createSubscribePacket = (packetId: number, topics: readonly string[]): Buffer => {
  const identifier = Buffer.allocUnsafe(2);
  identifier.writeUInt16BE(packetId, 0);
  const subscriptions = topics.map((topic) => Buffer.concat([encodeString(topic), Buffer.from([0])]));
  return createPacket(0x82, Buffer.concat([identifier, ...subscriptions]));
};

const createPublishPacket = (topic: string, payload: string): Buffer => {
  return createPacket(0x30, Buffer.concat([encodeString(topic), Buffer.from(payload, "utf8")]));
};

const readRemainingLength = (buffer: Buffer): RemainingLength | null => {
  let value = 0;
  let multiplier = 1;
  for (let index = 1; index < buffer.length && index <= 4; index += 1) {
    const encoded = buffer[index] as number;
    value += (encoded & 127) * multiplier;
    if ((encoded & 128) === 0) return { value, bytes: index };
    multiplier *= 128;
  }
  if (buffer.length >= 5) throw new Error("MQTT remaining length exceeds four bytes.");
  return null;
};

const readMqttString = (buffer: Buffer, offset: number): { readonly value: string; readonly nextOffset: number } => {
  if (offset + 2 > buffer.length) throw new Error("MQTT packet is missing a string length.");
  const length = buffer.readUInt16BE(offset);
  const contentStart = offset + 2;
  const contentEnd = contentStart + length;
  if (contentEnd > buffer.length) throw new Error("MQTT packet string length exceeds packet size.");
  return { value: buffer.subarray(contentStart, contentEnd).toString("utf8"), nextOffset: contentEnd };
};

const parseTopic = (topic: string): { readonly projectId: string; readonly deviceId: string } => {
  const parts = topic.split("/");
  if (parts.length !== 3 || parts[0]?.trim().length === 0 || parts[1]?.trim().length === 0) {
    throw new Error(`Unsupported MQTT report topic: ${topic}`);
  }
  return { projectId: parts[0] as string, deviceId: parts[1] as string };
};

export const parseMqttMessage = (topic: string, payload: Buffer | string): ParsedMqttMessage => {
  const target = parseTopic(topic);
  let json: JsonValue;
  try {
    json = JSON.parse(typeof payload === "string" ? payload : payload.toString("utf8")) as JsonValue;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "Unknown JSON parsing failure.";
    throw new Error(`MQTT report payload must be valid JSON: ${reason}`);
  }
  const report = parseDeviceReportInput(json);
  if (report.projectId !== target.projectId || report.deviceId !== target.deviceId) {
    throw new Error(`MQTT topic does not match report target. topic=${topic} report=${report.projectId}/${report.deviceId}`);
  }
  return { ...target, report };
};

const isSuccessfulConnack = (packet: Buffer): boolean => {
  return packet.length === 2 && packet[0] === 0 && packet[1] === 0;
};

export const createMqttBridge = (options: MqttBridgeOptions): MqttBridge => {
  let socket: Socket | null = null;
  let status: MqttStatus = "stopped";
  let receiveBuffer = Buffer.alloc(0);
  let packetId = 1;
  let heartbeat: NodeJS.Timeout | null = null;
  let reconnect: NodeJS.Timeout | null = null;
  let stopped = true;

  const nextPacketId = (): number => {
    const current = packetId;
    packetId = packetId === 65_535 ? 1 : packetId + 1;
    return current;
  };

  const send = (packet: Buffer): boolean => {
    if (socket === null || socket.destroyed || status !== "connected") return false;
    socket.write(packet);
    return true;
  };

  const subscribeProjects = async (): Promise<void> => {
    const projects = await options.store.listProjects();
    const topics = projects.map((project) => `${project.projectId}/#`);
    if (topics.length > 0) send(createSubscribePacket(nextPacketId(), topics));
  };

const handlePublish = async (flags: number, payload: Buffer): Promise<void> => {
    if ((flags & 0x06) !== 0) throw new Error("MQTT bridge supports only QoS 0 publish packets.");
    const topic = readMqttString(payload, 0);
    const content = payload.subarray(topic.nextOffset);
    if (topic.value.endsWith("/up")) {
      const message = parseMqttMessage(topic.value, content);
      await options.store.verifyProjectToken(message.projectId, message.report.token);
      const saved = await options.store.saveReportWithCommandState(message.report);
      const device = saved.device;
      const pendingCommands = await options.store.listPendingCommands(message.projectId, message.deviceId);
      for (const command of pendingCommands) {
        send(createPublishPacket(`${command.projectId}/${command.deviceId}/set`, JSON.stringify(command)));
      }
      options.eventHub.publish({ type: "device_report", device });
      for (const command of saved.stateConfirmed) options.eventHub.publish({ type: "command_state_confirmed", command });
      return;
    }
    if (topic.value.endsWith("/ack")) {
      const target = parseTopic(topic.value);
      let body: JsonValue;
      try { body = JSON.parse(content.toString("utf8")) as JsonValue; } catch (error: unknown) { throw new Error(`MQTT acknowledgement payload must be valid JSON: ${error instanceof Error ? error.message : "unknown parsing failure"}`); }
      const acknowledgement = parseCommandAckInput(body);
      if (acknowledgement.projectId !== target.projectId || acknowledgement.deviceId !== target.deviceId) throw new Error(`MQTT acknowledgement topic does not match payload: ${topic.value}`);
      await options.store.verifyProjectToken(acknowledgement.projectId, acknowledgement.token);
      const probe = await options.store.acknowledgeProbe(acknowledgement.projectId, acknowledgement.deviceId, acknowledgement.commandId, "mqtt");
      if (probe !== null) return;
      const command = await options.store.acknowledgeCommand(acknowledgement.projectId, acknowledgement.deviceId, acknowledgement.commandId);
      options.eventHub.publish(command.status === "state_confirmed" ? { type: "command_state_confirmed", command } : { type: "command_acked", command });
      return;
    }
    throw new Error(`Unsupported MQTT publish topic: ${topic.value}`);
  };

  const handlePacket = (header: number, payload: Buffer): void => {
    const type = header >> 4;
    if (type === 2) {
      if (!isSuccessfulConnack(payload)) throw new Error(`MQTT CONNACK rejected: ${payload.toString("hex")}`);
      status = "connected";
      void subscribeProjects().catch((error: unknown) => console.error("mqtt_subscribe_failed", error));
      return;
    }
    if (type === 3) {
      void handlePublish(header & 0x0f, payload).catch((error: unknown) => console.error("mqtt_message_failed", error));
    }
  };

  const consumePackets = (): void => {
    while (receiveBuffer.length > 1) {
      const remaining = readRemainingLength(receiveBuffer);
      if (remaining === null) return;
      const packetLength = 1 + remaining.bytes + remaining.value;
      if (receiveBuffer.length < packetLength) return;
      const header = receiveBuffer[0] as number;
      const payload = receiveBuffer.subarray(1 + remaining.bytes, packetLength);
      receiveBuffer = receiveBuffer.subarray(packetLength);
      handlePacket(header, payload);
    }
  };

  const clearTimers = (): void => {
    if (heartbeat !== null) clearInterval(heartbeat);
    if (reconnect !== null) clearTimeout(reconnect);
    heartbeat = null;
    reconnect = null;
  };

  const scheduleReconnect = (): void => {
    if (stopped || reconnect !== null) return;
    reconnect = setTimeout(() => {
      reconnect = null;
      connect();
    }, 5_000);
  };

  const connect = (): void => {
    if (stopped || socket !== null) return;
    status = "connecting";
    receiveBuffer = Buffer.alloc(0);
    const nextSocket = options.useTls
      ? createTlsConnection({ host: options.broker, port: options.port, servername: options.broker, rejectUnauthorized: true })
      : createConnection({ host: options.broker, port: options.port });
    socket = nextSocket;
    nextSocket.on("connect", () => {
      nextSocket.write(createConnectPacket(options.clientId));
    });
    nextSocket.on("data", (chunk: Buffer) => {
      receiveBuffer = Buffer.concat([receiveBuffer, chunk]);
      if (receiveBuffer.length > maxReceiveBufferBytes) {
        console.error("mqtt_receive_buffer_exceeded", { broker: options.broker, maxReceiveBufferBytes, receivedBytes: receiveBuffer.length });
        nextSocket.destroy();
        return;
      }
      try {
        consumePackets();
      } catch (error: unknown) {
        console.error("mqtt_packet_failed", error);
        nextSocket.destroy();
      }
    });
    nextSocket.on("error", (error: Error) => {
      console.error("mqtt_socket_error", error);
    });
    nextSocket.on("close", () => {
      if (socket === nextSocket) {
        socket = null;
        receiveBuffer = Buffer.alloc(0);
      }
      if (!stopped) {
        status = "disconnected";
        scheduleReconnect();
      }
    });
  };

  return {
    start: async () => {
      if (!stopped) return;
      stopped = false;
      connect();
      heartbeat = setInterval(() => {
        send(Buffer.from([0xc0, 0x00]));
      }, 30_000);
    },
    stop: async () => {
      stopped = true;
      clearTimers();
      const currentSocket = socket;
      socket = null;
      receiveBuffer = Buffer.alloc(0);
      status = "stopped";
      if (currentSocket === null || currentSocket.destroyed) return;
      currentSocket.write(Buffer.from([0xe0, 0x00]));
      await new Promise<void>((resolve) => currentSocket.end(resolve));
    },
    getStatus: () => status,
    getStatusInfo: () => ({ status, broker: options.broker, port: options.port, clientId: options.clientId, tls: options.useTls }),
    refreshSubscriptions: subscribeProjects,
    publishCommand: (command: DeviceCommand) => {
      return send(createPublishPacket(`${command.projectId}/${command.deviceId}/set`, JSON.stringify(command)));
    },
    publishForwardedReport: (topic: string, payload: JsonValue) => {
      if (topic.trim().length === 0 || topic.includes("#") || topic.includes("+")) return false;
      return send(createPublishPacket(topic.trim(), JSON.stringify(payload)));
    }
  };
};
