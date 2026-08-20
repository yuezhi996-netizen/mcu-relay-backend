import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { join } from "node:path";
import { createApp } from "./app.js";
import { createCommandLifecycleMonitor } from "./command-lifecycle.js";
import { createEventHub } from "./events.js";
import { createTcpDeviceGateway } from "./gateway.js";
import { createMqttBridge } from "./mqtt.js";
import { createPresenceMonitor } from "./presence.js";
import { createDataStore } from "./store.js";

const parsePort = (value: string | undefined, fallback: number, envName: string): number => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${envName} must be an integer between 1 and 65535. Received: ${value}`);
  }

  return parsed;
};

const parseBoolean = (value: string | undefined, envName: string): boolean => {
  if (value === undefined) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${envName} must be true or false. Received: ${value}`);
};

const parsePositiveInteger = (value: string | undefined, fallback: number, envName: string): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer. Received: ${value}`);
  }
  return parsed;
};

const listenHttpServer = async (
  server: ReturnType<typeof createServer>,
  port: number,
  host: string
): Promise<void> => {
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
    server.listen(port, host);
  });
};

const closeHttpServer = async (server: ReturnType<typeof createServer>): Promise<void> => {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
};

const main = async (): Promise<void> => {
  process.on("uncaughtException", (error) => { console.error("uncaughtException", error); });
  process.on("unhandledRejection", (reason) => { console.error("unhandledRejection", reason); });
  const port = parsePort(process.env.PORT, 18080, "PORT");
  const tcpPort = parsePort(process.env.TCP_PORT, 9001, "TCP_PORT");
  const host = process.env.HOST ?? "127.0.0.1";
  const tcpHost = process.env.TCP_HOST ?? "127.0.0.1";
  const corsOrigins = process.env.CORS_ORIGINS === undefined
    ? [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
    : process.env.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter((origin) => origin.length > 0);
  const adminToken = process.env.ADMIN_TOKEN?.trim();
  const accountCredentialKey = process.env.ACCOUNT_CREDENTIAL_KEY?.trim() || adminToken;
  const forwarderAllowedHosts = (process.env.FORWARDER_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((hostName) => hostName.trim().toLowerCase())
    .filter((hostName) => hostName.length > 0);
  const dataFilePath = process.env.DATA_FILE_PATH ?? join(process.cwd(), "data", "state.json");
  const publicDir = join(process.cwd(), "public");
  const commandLifecycle = {
    ackTimeoutMs: parsePositiveInteger(process.env.COMMAND_ACK_TIMEOUT_MS, 12_000, "COMMAND_ACK_TIMEOUT_MS"),
    stateConfirmTimeoutMs: parsePositiveInteger(process.env.COMMAND_STATE_CONFIRM_TIMEOUT_MS, 12_000, "COMMAND_STATE_CONFIRM_TIMEOUT_MS"),
    maxDispatchAttempts: parsePositiveInteger(process.env.COMMAND_MAX_DISPATCH_ATTEMPTS, 3, "COMMAND_MAX_DISPATCH_ATTEMPTS")
  };
  const commandTtlMs = parsePositiveInteger(process.env.COMMAND_TTL_MS, 300_000, "COMMAND_TTL_MS");
  const store = await createDataStore({
    dataFilePath,
    createId: randomUUID,
    createToken: () => randomBytes(16).toString("hex"),
    now: () => new Date().toISOString(),
    commandLifecycle,
    commandTtlMs,
    ...(accountCredentialKey === undefined || accountCredentialKey.length === 0 ? {} : { accountCredentialKey })
  });
  const eventHub = createEventHub();
  const gateway = createTcpDeviceGateway({
    host: tcpHost,
    port: tcpPort,
    store,
    eventHub
  });
  const commandLifecycleMonitor = createCommandLifecycleMonitor({ store, eventHub, intervalMs: 1_000 });
  const presenceMonitor = await createPresenceMonitor({ store, eventHub, intervalMs: 1_000, getDeviceConnectionStatus: gateway.getDeviceConnectionStatus });
  const mqttClientId = process.env.MQTT_CLIENT_ID ?? process.env.BEMFA_CLIENT_ID;
  const mqtt = mqttClientId === undefined || mqttClientId.trim().length === 0
    ? null
    : createMqttBridge({
      broker: process.env.MQTT_BROKER ?? "bemfa.com",
      port: parsePort(process.env.MQTT_PORT, 9501, "MQTT_PORT"),
      useTls: parseBoolean(process.env.MQTT_TLS, "MQTT_TLS"),
      clientId: mqttClientId,
      store,
      eventHub
    });
  const app = await createApp({
    publicDir,
    corsOrigins,
    store,
    eventHub,
    forwarderAllowedHosts,
    ...(adminToken === undefined || adminToken.length === 0 ? {} : { adminToken }),
    ...(mqtt === null ? {} : { mqtt }),
    tcpGateway: {
      getStatus: gateway.getStatus,
      getDeviceConnectionStatus: gateway.getDeviceConnectionStatus,
      host: tcpHost,
      port: tcpPort
    },
    tcpCommandDispatcher: gateway.commandDispatcher,
    remoteDebugDispatcher: gateway.remoteDebugDispatcher,
    commandDispatcher: {
      dispatchCommand: (command) => {
        const tcpDispatched = gateway.commandDispatcher.dispatchCommand(command);
        const mqttDispatched = mqtt?.publishCommand(command) ?? false;
        return tcpDispatched || mqttDispatched;
      }
    }
  });
  const server = createServer(app);

  const rollbackStartup = async (): Promise<void> => {
    const cleanupTasks: Promise<void>[] = [
      closeHttpServer(server),
      gateway.stop(),
      commandLifecycleMonitor.stop(),
      presenceMonitor.stop(),
      store.close()
    ];
    if (mqtt !== null) cleanupTasks.push(mqtt.stop());
    await Promise.allSettled(cleanupTasks);
  };
  const startupResults = await Promise.allSettled([gateway.start(), listenHttpServer(server, port, host)]);
  const startupFailure = startupResults.find((result) => result.status === "rejected");
  if (startupFailure?.status === "rejected") {
    await rollbackStartup();
    throw startupFailure.reason;
  }
  try {
    if (mqtt !== null) await mqtt.start();
  } catch (error: unknown) {
    await rollbackStartup();
    throw error;
  }

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    const timeout = setTimeout(() => process.exit(1), 15_000);
    void (async () => {
      const httpClosed = new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
      server.closeAllConnections();
      await httpClosed;
      await gateway.stop();
      if (mqtt !== null) await mqtt.stop();
      await commandLifecycleMonitor.stop();
      await presenceMonitor.stop();
      await store.close();
      clearTimeout(timeout);
      process.exit(0);
    })().catch((error: unknown) => {
      console.error("shutdown_failed", error);
      clearTimeout(timeout);
      process.exit(1);
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  console.log("mcu_relay_backend_listening", {
    httpUrl: `http://${host}:${port}`,
    tcpHost,
    tcpPort: gateway.getBoundPort()
  });
};

main().catch((error: object) => {
  console.error(error);
  process.exitCode = 1;
});
