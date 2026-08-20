import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { createAppError, isAppError } from "./errors.js";
import type { EventHub } from "./events.js";
import type { DataStore } from "./store.js";
import type { CommandDispatcher, DeviceCommand, DeviceConnectionStatus, JsonObject, JsonValue, RemoteDebugDispatcher } from "./types.js";
import { isJsonObject, parseCommandAckInput, parseDeviceReportInput, parseRemoteDebugDataInput } from "./validation.js";

export type TcpDeviceGateway = {
  readonly commandDispatcher: CommandDispatcher;
  readonly remoteDebugDispatcher: RemoteDebugDispatcher;
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly getStatus: () => "stopped" | "listening";
  readonly getBoundPort: () => number;
  readonly getDeviceConnectionStatus: (projectId: string, deviceId: string) => DeviceConnectionStatus;
};

type TcpDeviceGatewayOptions = {
  readonly host: string;
  readonly port: number;
  readonly store: DataStore;
  readonly eventHub: EventHub;
};

type CommandDelivery = {
  readonly deviceAvailable: (deviceKey: string) => Promise<void>;
  readonly commandAcknowledged: (deviceKey: string, command: DeviceCommand) => Promise<void>;
  readonly commandStateConfirmed: (deviceKey: string, commandId: string) => Promise<void>;
  readonly clearDevice: (deviceKey: string) => void;
};

const commandDispatchDelayMs = 120;
const maxPendingInboundMessages = 64;

const createDeviceKey = (projectId: string, deviceId: string): string => {
  return JSON.stringify([projectId, deviceId]);
};

const parseDeviceKey = (deviceKey: string): { readonly projectId: string; readonly deviceId: string } | null => {
  try {
    const parts = JSON.parse(deviceKey) as JsonValue;
    if (!Array.isArray(parts) || parts.length !== 2 || typeof parts[0] !== "string" || typeof parts[1] !== "string") return null;
    return { projectId: parts[0], deviceId: parts[1] };
  } catch {
    return null;
  }
};

const serializeCommand = (command: DeviceCommand): JsonObject => {
  return {
    id: command.id,
    projectId: command.projectId,
    deviceId: command.deviceId,
    name: command.name,
    payload: command.payload,
    status: command.status,
    createdAt: command.createdAt,
    expiresAt: command.expiresAt,
    acknowledgedAt: command.acknowledgedAt
  };
};

const sendLine = (socket: Socket, payload: JsonObject): boolean => {
  if (socket.destroyed || !socket.writable) return false;
  try {
    const writable = socket.write(`${JSON.stringify(payload)}\n`, (error) => {
      if (error === undefined || error === null) return;
      console.warn("tcp_socket_write_failed", {
        code: error.name,
        reason: error.message,
        remoteAddress: socket.remoteAddress ?? "",
        remotePort: socket.remotePort ?? null
      });
    });
    if (!writable) {
      socket.once("drain", () => {
        console.info("tcp_socket_drain", {
          remoteAddress: socket.remoteAddress ?? "",
          remotePort: socket.remotePort ?? null
        });
      });
    }
    return true;
  } catch (error: unknown) {
    console.warn("tcp_socket_write_threw", {
      reason: error instanceof Error ? error.message : "Unknown socket write error.",
      remoteAddress: socket.remoteAddress ?? "",
      remotePort: socket.remotePort ?? null
    });
    return false;
  }
};

const sendCommandLine = (socket: Socket, command: DeviceCommand, onWritten: () => void, onFailed: () => void): boolean => {
  if (socket.destroyed || !socket.writable) return false;
  try {
    const writable = socket.write(`${JSON.stringify({ type: "command", command: serializeCommand(command) })}\n`, (error) => {
      if (error === undefined || error === null) {
        onWritten();
        return;
      }
      onFailed();
    });
    if (!writable) {
      socket.once("drain", () => {
        console.info("tcp_socket_drain", {
          remoteAddress: socket.remoteAddress ?? "",
          remotePort: socket.remotePort ?? null
        });
      });
    }
    return true;
  } catch {
    return false;
  }
};

const parseJsonLine = (line: string): JsonValue => {
  try {
    return JSON.parse(line) as JsonValue;
  } catch (error) {
    const reason = error instanceof SyntaxError ? error.message : "Unknown JSON parse error.";
    throw createAppError(400, "INVALID_TCP_JSON", "TCP message must be valid JSON.", {
      reason,
      byteLength: Buffer.byteLength(line, "utf8")
    });
  }
};

const getMessageType = (payload: JsonValue): string => {
  if (!isJsonObject(payload)) {
    throw createAppError(400, "INVALID_TCP_MESSAGE", "TCP message must be a JSON object.", null);
  }

  const type = payload.type;
  if (typeof type !== "string" || type.trim().length === 0) {
    throw createAppError(400, "INVALID_TCP_MESSAGE_TYPE", "TCP message type must be a non-empty string.", {
      field: "type"
    });
  }

  return type.trim();
};

const sendErrorLine = (socket: Socket, error: unknown): void => {
  if (typeof error === "object" && error !== null && isAppError(error)) {
    sendLine(socket, {
      type: "error",
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    });
    return;
  }

  const message = error instanceof Error ? error.message : "Unexpected TCP gateway error.";
  sendLine(socket, {
    type: "error",
    error: {
      code: "TCP_GATEWAY_ERROR",
      message,
      details: null
    }
  });
};

const isProjectAuthenticationFailure = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null || !isAppError(error)) {
    return false;
  }

  return error.code === "INVALID_PROJECT_TOKEN" || error.code === "PROJECT_NOT_FOUND";
};

const processTcpMessage = async (
  socket: Socket,
  socketsByDevice: Map<string, Socket>,
  socketDeviceKeys: Map<Socket, string>,
  bindAuthenticatedSocket: (deviceKey: string, socket: Socket) => void,
  commandDelivery: CommandDelivery,
  options: TcpDeviceGatewayOptions,
  payload: JsonValue
): Promise<boolean> => {
  const messageType = getMessageType(payload);

  if (messageType === "ping") {
    const deviceKey = socketDeviceKeys.get(socket);
    const target = deviceKey === undefined ? null : parseDeviceKey(deviceKey);
    if (deviceKey === undefined || target === null || socketsByDevice.get(deviceKey) !== socket) {
      throw createAppError(401, "UNAUTHENTICATED_TCP_PING", "TCP ping requires an authenticated device connection.", null);
    }
    await options.store.markDeviceHeartbeat(target.projectId, target.deviceId);
    sendLine(socket, {
      type: "pong"
    });
    return true;
  }

  if (messageType === "report") {
    const report = parseDeviceReportInput(payload);
    await options.store.verifyProjectToken(report.projectId, report.token);
    const saved = await options.store.saveReportWithCommandState(report);
    const device = saved.device;
    const pendingProbes = await options.store.listPendingProbes(device.projectId, device.deviceId);
    const deviceKey = createDeviceKey(device.projectId, device.deviceId);
    bindAuthenticatedSocket(deviceKey, socket);
    for (const probe of pendingProbes) {
      sendLine(socket, {
        type: "command",
        command: serializeCommand(probe)
      });
    }
    await commandDelivery.deviceAvailable(deviceKey);
    options.eventHub.publish({
      type: "device_report",
      device
    });
    for (const command of saved.stateConfirmed) {
      await commandDelivery.commandStateConfirmed(deviceKey, command.id);
      options.eventHub.publish({ type: "command_state_confirmed", command });
    }
    sendLine(socket, {
      type: "accepted",
      messageType: "report"
    });
    return true;
  }

  if (messageType === "ack") {
    const ack = parseCommandAckInput(payload);
    await options.store.verifyProjectToken(ack.projectId, ack.token);
    const deviceKey = createDeviceKey(ack.projectId, ack.deviceId);
    if (socketDeviceKeys.get(socket) !== deviceKey || socketsByDevice.get(deviceKey) !== socket) {
      throw createAppError(409, "ACK_SOCKET_MISMATCH", "Command acknowledgement must come from the active TCP connection registered for this device.", {
        projectId: ack.projectId,
        deviceId: ack.deviceId,
        commandId: ack.commandId
      });
    }
    const probe = await options.store.acknowledgeProbe(ack.projectId, ack.deviceId, ack.commandId, "tcp");
    if (probe !== null) {
      sendLine(socket, {
        type: "accepted",
        messageType: "ack",
        commandId: ack.commandId
      });
      return true;
    }
    const command = await options.store.acknowledgeCommand(ack.projectId, ack.deviceId, ack.commandId);
    await commandDelivery.commandAcknowledged(deviceKey, command);
    if (command.status === "state_confirmed") {
      options.eventHub.publish({ type: "command_state_confirmed", command });
    } else if (command.status !== "superseded") {
      options.eventHub.publish({ type: "command_acked", command });
    }
    sendLine(socket, {
      type: "accepted",
      messageType: "ack",
      commandId: command.id
    });
    return true;
  }

  if (messageType === "remote_debug_data") {
    const debugData = parseRemoteDebugDataInput(payload);
    await options.store.verifyProjectToken(debugData.projectId, debugData.token);
    const deviceKey = createDeviceKey(debugData.projectId, debugData.deviceId);
    if (socketDeviceKeys.get(socket) !== deviceKey || socketsByDevice.get(deviceKey) !== socket) {
      throw createAppError(409, "REMOTE_DEBUG_SOCKET_MISMATCH", "Remote debug data must come from the active TCP connection registered for this device.", {
        projectId: debugData.projectId,
        deviceId: debugData.deviceId
      });
    }
    await options.store.markDeviceSeen(debugData.projectId, debugData.deviceId);
    options.eventHub.publish({
      type: "remote_debug_data",
      projectId: debugData.projectId,
      deviceId: debugData.deviceId,
      encoding: debugData.encoding,
      data: debugData.data,
      byteLength: debugData.byteLength,
      receivedAt: new Date().toISOString()
    });
    sendLine(socket, {
      type: "accepted",
      messageType: "remote_debug_data",
      byteLength: debugData.byteLength
    });
    return true;
  }

  throw createAppError(400, "UNSUPPORTED_TCP_MESSAGE_TYPE", "TCP message type is not supported.", {
    type: messageType
  });
};

const startServer = async (server: Server, options: TcpDeviceGatewayOptions): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port, options.host);
  });
};

const stopServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

export const createTcpDeviceGateway = (options: TcpDeviceGatewayOptions): TcpDeviceGateway => {
  const socketsByDevice = new Map<string, Socket>();
  const socketDeviceKeys = new Map<Socket, string>();
  const socketConnectedAt = new Map<Socket, string>();
  const activeSockets = new Set<Socket>();
  const inFlightCommandsByDevice = new Map<string, string>();
  const scheduledCommandTimers = new Map<string, NodeJS.Timeout>();
  let status: "stopped" | "listening" = "stopped";

  const cancelScheduledCommand = (deviceKey: string): void => {
    const timer = scheduledCommandTimers.get(deviceKey);
    if (timer === undefined) return;
    clearTimeout(timer);
    scheduledCommandTimers.delete(deviceKey);
  };

  const clearDeviceCommandDelivery = (deviceKey: string): void => {
    cancelScheduledCommand(deviceKey);
    inFlightCommandsByDevice.delete(deviceKey);
  };

  const bindAuthenticatedSocket = (deviceKey: string, socket: Socket): void => {
    const previousDeviceKey = socketDeviceKeys.get(socket);
    if (previousDeviceKey !== undefined && previousDeviceKey !== deviceKey && socketsByDevice.get(previousDeviceKey) === socket) {
      socketsByDevice.delete(previousDeviceKey);
      commandDelivery.clearDevice(previousDeviceKey);
    }
    const previousSocket = socketsByDevice.get(deviceKey);
    if (previousSocket !== undefined && previousSocket !== socket) {
      socketDeviceKeys.delete(previousSocket);
      commandDelivery.clearDevice(deviceKey);
      previousSocket.destroy();
    }
    socketsByDevice.set(deviceKey, socket);
    socketDeviceKeys.set(socket, deviceKey);
  };

  const dispatchNextPendingCommand = async (deviceKey: string): Promise<void> => {
    if (inFlightCommandsByDevice.has(deviceKey)) return;
    const socket = socketsByDevice.get(deviceKey);
    if (socket === undefined || socket.destroyed) return;
    const target = parseDeviceKey(deviceKey);
    if (target === null) return;
    const next = await options.store.getNextCommand(target.projectId, target.deviceId);
    if (!next.hasCommand || inFlightCommandsByDevice.has(deviceKey)) return;
    if (socketsByDevice.get(deviceKey) !== socket || socket.destroyed) return;
    inFlightCommandsByDevice.set(deviceKey, next.command.id);
    const commandSent = sendCommandLine(
      socket,
      next.command,
      () => {
        if (socketsByDevice.get(deviceKey) !== socket || inFlightCommandsByDevice.get(deviceKey) !== next.command.id) return;
        void options.store.markCommandDispatched(target.projectId, target.deviceId, next.command.id).then((command) => {
          options.eventHub.publish({ type: "command_dispatched", command });
        }).catch((error: unknown) => {
          console.error("tcp_command_dispatch_state_failed", {
            projectId: target.projectId,
            deviceId: target.deviceId,
            commandId: next.command.id,
            reason: error instanceof Error ? error.message : "Unknown command dispatch state failure."
          });
          socket.destroy();
        });
      },
      () => {
        if (inFlightCommandsByDevice.get(deviceKey) === next.command.id) inFlightCommandsByDevice.delete(deviceKey);
        socket.destroy();
        void options.store.markCommandDispatchFailed(target.projectId, target.deviceId, next.command.id).then((command) => {
          options.eventHub.publish({ type: "command_requeued", command });
        }).catch((error: unknown) => {
          console.error("tcp_command_dispatch_failure_state_failed", {
            projectId: target.projectId,
            deviceId: target.deviceId,
            commandId: next.command.id,
            reason: error instanceof Error ? error.message : "Unknown command dispatch failure state error."
          });
        });
      }
    );
    if (!commandSent) {
      inFlightCommandsByDevice.delete(deviceKey);
      void options.store.markCommandDispatchFailed(target.projectId, target.deviceId, next.command.id).then((command) => {
        options.eventHub.publish({ type: "command_requeued", command });
      }).catch((error: unknown) => {
        console.error("tcp_command_dispatch_failure_state_failed", {
          projectId: target.projectId,
          deviceId: target.deviceId,
          commandId: next.command.id,
          reason: error instanceof Error ? error.message : "Unknown command dispatch failure state error."
        });
      });
      socket.destroy();
    }
  };

  const scheduleNextPendingCommand = (projectId: string, deviceId: string): boolean => {
    const deviceKey = createDeviceKey(projectId, deviceId);
    const socket = socketsByDevice.get(deviceKey);
    if (socket === undefined || socket.destroyed) return false;
    if (inFlightCommandsByDevice.has(deviceKey) || scheduledCommandTimers.has(deviceKey)) return true;
    const timer = setTimeout(() => {
      scheduledCommandTimers.delete(deviceKey);
      void dispatchNextPendingCommand(deviceKey).catch((error: unknown) => {
        console.error("tcp_command_dispatch_failed", {
          deviceKey,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, commandDispatchDelayMs);
    timer.unref();
    scheduledCommandTimers.set(deviceKey, timer);
    return true;
  };

  const commandDelivery: CommandDelivery = {
    deviceAvailable: async (deviceKey: string): Promise<void> => {
      cancelScheduledCommand(deviceKey);
      await dispatchNextPendingCommand(deviceKey);
    },
    commandAcknowledged: async (deviceKey: string, command: DeviceCommand): Promise<void> => {
      if (inFlightCommandsByDevice.get(deviceKey) !== command.id) return;
      if (command.name === "set_light" && command.status === "acked") return;
      inFlightCommandsByDevice.delete(deviceKey);
      await dispatchNextPendingCommand(deviceKey);
    },
    commandStateConfirmed: async (deviceKey: string, commandId: string): Promise<void> => {
      if (inFlightCommandsByDevice.get(deviceKey) !== commandId) return;
      inFlightCommandsByDevice.delete(deviceKey);
      await dispatchNextPendingCommand(deviceKey);
    },
    clearDevice: clearDeviceCommandDelivery
  };

  const keyBelongsToProject = (key: string, projectId: string): boolean => {
    try {
      const parts = JSON.parse(key) as JsonValue;
      return Array.isArray(parts) && parts.length === 2 && parts[0] === projectId;
    } catch {
      return false;
    }
  };

  options.eventHub.subscribe((event) => {
    if (event.type === "command_requeued") {
      const deviceKey = createDeviceKey(event.command.projectId, event.command.deviceId);
      if (inFlightCommandsByDevice.get(deviceKey) === event.command.id) inFlightCommandsByDevice.delete(deviceKey);
      scheduleNextPendingCommand(event.command.projectId, event.command.deviceId);
      return;
    }
    if (event.type === "command_state_confirmed" || event.type === "command_failed" || event.type === "command_expired") {
      const deviceKey = createDeviceKey(event.command.projectId, event.command.deviceId);
      if (inFlightCommandsByDevice.get(deviceKey) === event.command.id) {
        inFlightCommandsByDevice.delete(deviceKey);
        scheduleNextPendingCommand(event.command.projectId, event.command.deviceId);
      }
      return;
    }
    if (event.type !== "project_deleted") return;
    const socketsToDestroy = new Set<Socket>();
    for (const [key, socket] of socketsByDevice) {
      if (!keyBelongsToProject(key, event.projectId)) continue;
      socketsByDevice.delete(key);
      commandDelivery.clearDevice(key);
      if (socketDeviceKeys.get(socket) === key) {
        socketDeviceKeys.delete(socket);
        socketsToDestroy.add(socket);
      }
    }
    for (const socket of socketsToDestroy) socket.destroy();
  });

  const server = createServer((socket) => {
    activeSockets.add(socket);
    socketConnectedAt.set(socket, new Date().toISOString());
    let buffer = "";
    let unauthenticatedMessageCount = 0;
    let pendingMessageCount = 0;
    let messageChain: Promise<void> = Promise.resolve();

    const handleLine = (line: string): void => {
      if (pendingMessageCount >= maxPendingInboundMessages) {
        console.warn("tcp_message_queue_overflow", {
          limit: maxPendingInboundMessages,
          remoteAddress: socket.remoteAddress ?? "",
          remotePort: socket.remotePort ?? null
        });
        socket.destroy();
        return;
      }
      pendingMessageCount += 1;
      messageChain = messageChain.then(async () => {
        try {
          const payload = parseJsonLine(line);
          const authenticated = await processTcpMessage(socket, socketsByDevice, socketDeviceKeys, bindAuthenticatedSocket, commandDelivery, options, payload);
          if (authenticated) {
            unauthenticatedMessageCount = 0;
          }
        } catch (error: unknown) {
          sendErrorLine(socket, error);
          if (isProjectAuthenticationFailure(error)) {
            unauthenticatedMessageCount += 1;
            if (unauthenticatedMessageCount >= 5) {
              socket.destroy();
            }
          }
        } finally {
          pendingMessageCount -= 1;
        }
      });
    };

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      if (Buffer.byteLength(buffer, "utf8") > 256 * 1024) {
        socket.destroy();
        return;
      }

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.length === 0) {
          continue;
        }

        handleLine(trimmedLine);
      }
    });

    socket.on("close", () => {
      activeSockets.delete(socket);
      socketConnectedAt.delete(socket);
      const deviceKey = socketDeviceKeys.get(socket);
      if (deviceKey !== undefined && socketsByDevice.get(deviceKey) === socket) {
        socketsByDevice.delete(deviceKey);
        commandDelivery.clearDevice(deviceKey);
      }
      socketDeviceKeys.delete(socket);
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      console.warn("tcp_socket_error", {
        code: error.code ?? "UNKNOWN",
        reason: error.message,
        remoteAddress: socket.remoteAddress ?? "",
        remotePort: socket.remotePort ?? null
      });
    });
  });

  const sendToConnectedDevice = (projectId: string, deviceId: string, payload: JsonObject): boolean => {
    const socket = socketsByDevice.get(createDeviceKey(projectId, deviceId));
    if (socket === undefined || socket.destroyed) return false;
    return sendLine(socket, payload);
  };

  return {
    commandDispatcher: {
      dispatchCommand: (command: DeviceCommand) => {
        if (command.name !== "__probe__") return scheduleNextPendingCommand(command.projectId, command.deviceId);
        const socket = socketsByDevice.get(createDeviceKey(command.projectId, command.deviceId));
        if (socket === undefined || socket.destroyed) return false;
        return sendLine(socket, {
          type: "command",
          command: serializeCommand(command)
        });
      }
    },
    remoteDebugDispatcher: {
      isDeviceConnected: (projectId: string, deviceId: string) => {
        const socket = socketsByDevice.get(createDeviceKey(projectId, deviceId));
        return socket !== undefined && !socket.destroyed;
      },
      openRemoteDebug: (projectId: string, deviceId: string) => sendToConnectedDevice(projectId, deviceId, {
        type: "remote_debug_open"
      }),
      writeRemoteDebug: (projectId: string, deviceId: string, data: string) => sendToConnectedDevice(projectId, deviceId, {
        type: "remote_debug_write",
        encoding: "base64",
        data
      }),
      closeRemoteDebug: (projectId: string, deviceId: string) => sendToConnectedDevice(projectId, deviceId, {
        type: "remote_debug_close"
      })
    },
    start: async () => {
      if (status === "listening") return;
      try {
        await startServer(server, options);
        status = "listening";
      } catch (error: unknown) {
        status = "stopped";
        throw error;
      }
    },
    stop: async () => {
      for (const deviceKey of scheduledCommandTimers.keys()) commandDelivery.clearDevice(deviceKey);
      for (const socket of activeSockets) socket.destroy();
      if (status === "stopped" || !server.listening) {
        status = "stopped";
        return;
      }
      try {
        await stopServer(server);
      } finally {
        status = "stopped";
      }
    },
    getStatus: () => status,
    getBoundPort: () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("TCP gateway is not bound to a TCP port.");
      }

      return (address as AddressInfo).port;
    },
    getDeviceConnectionStatus: (projectId: string, deviceId: string) => {
      const socket = socketsByDevice.get(createDeviceKey(projectId, deviceId));
      if (socket === undefined || socket.destroyed || !socket.writable) return { connected: false, connectedAt: null };
      return { connected: true, connectedAt: socketConnectedAt.get(socket) ?? null };
    }
  };
};
