import type { JsonObject } from "./types.js";

export type OpenApiOptions = {
  readonly baseUrl: string;
  readonly version: string;
};

const jsonContent = (schema: JsonObject): JsonObject => ({
  "application/json": { schema }
});

const response = (description: string, schema: JsonObject): JsonObject => ({
  description,
  content: jsonContent(schema)
});

const success = (schema: JsonObject): JsonObject => response("Successful response.", {
  type: "object",
  required: ["ok", "data"],
  properties: {
    ok: { type: "boolean", enum: [true] },
    data: schema
  }
});

const errorResponse: JsonObject = {
  type: "object",
  required: ["ok", "error"],
  properties: {
    ok: { type: "boolean", enum: [false] },
    error: {
      type: "object",
      required: ["code", "message", "details"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: { nullable: true }
      }
    }
  }
};

const body = (schema: JsonObject): JsonObject => ({
  required: true,
  content: jsonContent(schema)
});

const projectToken: JsonObject = {
  name: "x-project-token",
  in: "header",
  required: true,
  schema: { type: "string" }
};

const optionalProjectToken: JsonObject = {
  name: "x-project-token",
  in: "header",
  required: false,
  schema: { type: "string" }
};

const optionalAgentKey: JsonObject = {
  name: "x-agent-key",
  in: "header",
  required: false,
  schema: { type: "string" }
};

const adminToken: JsonObject = {
  name: "x-admin-token",
  in: "header",
  required: false,
  schema: { type: "string" },
  description: "Required when ADMIN_TOKEN is configured. Without ADMIN_TOKEN, administration is local-only."
};

const projectIdParameter: JsonObject = {
  name: "projectId",
  in: "path",
  required: true,
  schema: { type: "string" }
};

const deviceIdParameter: JsonObject = {
  name: "deviceId",
  in: "path",
  required: true,
  schema: { type: "string" }
};

const commandIdParameter: JsonObject = {
  name: "commandId",
  in: "path",
  required: true,
  schema: { type: "string" }
};

const resourceIdParameter = (name: string): JsonObject => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string" }
});

const protectedResponses = (schema: JsonObject): JsonObject => ({
  "200": success(schema),
  "401": response("Project token is invalid or missing.", errorResponse),
  "404": response("Requested resource was not found.", errorResponse)
});

export const generateOpenApiSpec = (options: OpenApiOptions): JsonObject => {
  const schemas: JsonObject = {
    JsonObject: { type: "object", additionalProperties: true },
    DeviceValue: {
      type: "object",
      required: ["key", "value", "unit"],
      properties: {
        key: { type: "string" },
        value: { oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] },
        unit: { type: "string" }
      }
    },
    RelayOutput: {
      type: "object",
      required: ["key", "state"],
      properties: { key: { type: "string" }, state: { type: "string", enum: ["on", "off"] } }
    },
    AlarmState: {
      type: "object",
      required: ["key", "active"],
      properties: { key: { type: "string" }, active: { type: "boolean" } }
    },
    DeviceReportInput: {
      type: "object",
      required: ["projectId", "token", "deviceId", "values", "relays", "alarms"],
      properties: {
        projectId: { type: "string" },
        token: { type: "string" },
        deviceId: { type: "string" },
        values: { type: "array", items: { $ref: "#/components/schemas/DeviceValue" } },
        relays: { type: "array", items: { $ref: "#/components/schemas/RelayOutput" } },
        alarms: { type: "array", items: { $ref: "#/components/schemas/AlarmState" } }
      }
    },
    DeviceReport: {
      type: "object",
      required: ["projectId", "deviceId", "values", "relays", "alarms", "reportedAt"],
      properties: {
        projectId: { type: "string" }, deviceId: { type: "string" },
        values: { type: "array", items: { $ref: "#/components/schemas/DeviceValue" } },
        relays: { type: "array", items: { $ref: "#/components/schemas/RelayOutput" } },
        alarms: { type: "array", items: { $ref: "#/components/schemas/AlarmState" } },
        reportedAt: { type: "string", format: "date-time" }
      }
    },
    DeviceRecord: {
      type: "object",
      required: ["projectId", "deviceId", "createdAt", "lastSeenAt", "lastReport", "activityConfirmed"],
      properties: {
        projectId: { type: "string" }, deviceId: { type: "string" },
        createdAt: { type: "string", format: "date-time" }, lastSeenAt: { type: "string", format: "date-time" },
        lastReport: { $ref: "#/components/schemas/DeviceReport" },
        activityConfirmed: { type: "boolean" }, simulated: { type: "boolean" }
      }
    },
    DeviceStatusItem: {
      type: "object",
      required: ["deviceId", "online", "lastSeenAt", "name", "type", "alarmCount"],
      properties: {
        deviceId: { type: "string" }, online: { type: "boolean" },
        lastSeenAt: { type: "string", format: "date-time" }, name: { type: "string" },
        type: { type: "string" }, alarmCount: { type: "integer", minimum: 0 }
      }
    },
    ProjectInput: {
      type: "object", required: ["projectId"], properties: { projectId: { type: "string" }, name: { type: "string", description: "项目中文显示名称；省略时沿用项目 ID。" } }
    },
    ProjectNameInput: {
      type: "object", required: ["name"], properties: { name: { type: "string" } }
    },
    ProjectRecord: {
      type: "object",
      required: ["projectId", "token", "name", "createdAt", "updatedAt"],
      properties: {
        projectId: { type: "string" }, token: { type: "string" }, name: { type: "string" },
        createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }
      }
    },
    DeviceCommandInput: {
      type: "object",
      required: ["name", "payload"],
      properties: { commandId: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" }, name: { type: "string" }, payload: { $ref: "#/components/schemas/JsonObject" } }
    },
    DeviceCommand: {
      allOf: [
        { $ref: "#/components/schemas/DeviceCommandInput" },
        {
          type: "object",
          required: ["id", "projectId", "deviceId", "status", "createdAt", "expiresAt", "dispatchedAt", "lastDispatchedAt", "acknowledgedAt", "stateReportedAt", "stateConfirmedAt", "dispatchAttempts", "failureCode", "failureAt"],
          properties: {
            id: { type: "string" }, projectId: { type: "string" }, deviceId: { type: "string" },
            status: { type: "string", enum: ["queued", "dispatched", "acked", "state_confirmed", "failed", "expired", "superseded"] }, createdAt: { type: "string", format: "date-time" },
            expiresAt: { type: "string", format: "date-time" },
            dispatchedAt: { type: "string", format: "date-time", nullable: true }, lastDispatchedAt: { type: "string", format: "date-time", nullable: true },
            acknowledgedAt: { type: "string", format: "date-time", nullable: true }, stateReportedAt: { type: "string", format: "date-time", nullable: true }, stateConfirmedAt: { type: "string", format: "date-time", nullable: true },
            dispatchAttempts: { type: "integer", minimum: 0 }, failureCode: { type: "string", nullable: true }, failureAt: { type: "string", format: "date-time", nullable: true }
          }
        }
      ]
    },
    ProbeRequest: {
      type: "object",
      required: ["projectId", "token", "deviceId"],
      properties: { projectId: { type: "string" }, token: { type: "string" }, deviceId: { type: "string" } }
    },
    ProbeResult: {
      type: "object",
      required: ["reachable", "latencyMs", "transport", "checkedAt"],
      properties: {
        reachable: { type: "boolean" }, latencyMs: { type: "number", nullable: true },
        transport: { type: "string", enum: ["tcp", "http", "mqtt", "both"], nullable: true },
        checkedAt: { type: "string", format: "date-time", nullable: true }
      }
    },
    RemoteDebugWrite: {
      type: "object",
      required: ["encoding", "data"],
      properties: {
        encoding: { type: "string", enum: ["base64"] },
        data: { type: "string", format: "byte", description: "1 to 16384 raw bytes encoded as canonical Base64." }
      }
    },
    RemoteDebugSession: {
      type: "object",
      required: ["active", "openedAt", "closedAt", "lastActivityAt", "txFrames", "txBytes", "rxFrames", "rxBytes", "retainedEntries"],
      properties: {
        active: { type: "boolean" },
        openedAt: { type: "string", format: "date-time", nullable: true },
        closedAt: { type: "string", format: "date-time", nullable: true },
        lastActivityAt: { type: "string", format: "date-time", nullable: true },
        txFrames: { type: "integer", minimum: 0 }, txBytes: { type: "integer", minimum: 0 },
        rxFrames: { type: "integer", minimum: 0 }, rxBytes: { type: "integer", minimum: 0 },
        retainedEntries: { type: "integer", minimum: 0, maximum: 2000 }
      }
    },
    RemoteDebugLogEntry: {
      type: "object",
      required: ["id", "projectId", "deviceId", "direction", "encoding", "data", "byteLength", "receivedAt"],
      properties: {
        id: { type: "integer", minimum: 1 }, projectId: { type: "string" }, deviceId: { type: "string" },
        direction: { type: "string", enum: ["TX", "RX"] }, encoding: { type: "string", enum: ["base64"] },
        data: { type: "string", format: "byte" }, byteLength: { type: "integer", minimum: 1, maximum: 16384 },
        receivedAt: { type: "string", format: "date-time" }
      }
    },
    AgentKeySummary: {
      type: "object",
      required: ["id", "projectId", "label", "createdAt", "lastUsedAt", "keyPreview"],
      properties: {
        id: { type: "string" }, projectId: { type: "string" }, label: { type: "string" }, keyPreview: { type: "string" },
        createdAt: { type: "string", format: "date-time" }, lastUsedAt: { type: "string", format: "date-time", nullable: true }
      }
    },
    FirmwareRecord: {
      type: "object",
      required: ["id", "projectId", "version", "fileName", "fileSize", "md5", "downloadUrl", "uploadedAt"],
      properties: {
        id: { type: "string" }, projectId: { type: "string" }, version: { type: "string" }, fileName: { type: "string" },
        fileSize: { type: "integer", minimum: 0 }, md5: { type: "string" }, downloadUrl: { type: "string", format: "uri" }, uploadedAt: { type: "string", format: "date-time" }
      }
    },
    OTATask: {
      type: "object",
      required: ["id", "projectId", "deviceId", "firmwareId", "status", "progress", "createdAt", "completedAt"],
      properties: {
        id: { type: "string" }, projectId: { type: "string" }, deviceId: { type: "string" }, firmwareId: { type: "string" },
        status: { type: "string", enum: ["pending", "downloading", "installing", "success", "failed"] },
        progress: { type: "integer", minimum: 0, maximum: 100 }, createdAt: { type: "string", format: "date-time" }, completedAt: { type: "string", format: "date-time", nullable: true }
      }
    },
    DashboardSnapshot: {
      type: "object",
      required: ["projectId", "generatedAt", "windowStartedAt", "windowHours", "devices", "telemetry", "reports", "commands", "automation", "attentionDevices"],
      properties: {
        projectId: { type: "string" }, generatedAt: { type: "string", format: "date-time" },
        windowStartedAt: { type: "string", format: "date-time" }, windowHours: { type: "integer", enum: [24] },
        devices: {
          type: "object", required: ["total", "online", "offline", "simulated", "activeAlarmDevices"],
          properties: { total: { type: "integer" }, online: { type: "integer" }, offline: { type: "integer" }, simulated: { type: "integer" }, activeAlarmDevices: { type: "integer" } }
        },
        telemetry: {
          type: "object", required: ["relayTotal", "relayOn", "relayOff", "activeAlarmCount", "hasRelayData", "hasAlarmData"],
          properties: { relayTotal: { type: "integer" }, relayOn: { type: "integer" }, relayOff: { type: "integer" }, activeAlarmCount: { type: "integer" }, hasRelayData: { type: "boolean" }, hasAlarmData: { type: "boolean" } }
        },
        reports: {
          type: "object", required: ["total", "activeAlarmReports", "activeDevices", "lastReportedAt", "hourly"],
          properties: {
            total: { type: "integer" }, activeAlarmReports: { type: "integer" }, activeDevices: { type: "integer" }, lastReportedAt: { type: "string", format: "date-time", nullable: true },
            hourly: {
              type: "array", minItems: 24, maxItems: 24,
              items: { type: "object", required: ["startedAt", "reports", "activeAlarmReports", "activeDevices"], properties: { startedAt: { type: "string", format: "date-time" }, reports: { type: "integer" }, activeAlarmReports: { type: "integer" }, activeDevices: { type: "integer" } } }
            }
          }
        },
        commands: {
          type: "object", required: ["total", "pending", "acked", "expired", "acknowledgementRate"],
          properties: { total: { type: "integer" }, pending: { type: "integer" }, acked: { type: "integer" }, expired: { type: "integer" }, acknowledgementRate: { type: "number", minimum: 0, maximum: 1, nullable: true } }
        },
        automation: {
          type: "object", required: ["rulesEnabled", "rulesTotal", "otaActive", "otaSuccess", "otaFailed"],
          properties: { rulesEnabled: { type: "integer" }, rulesTotal: { type: "integer" }, otaActive: { type: "integer" }, otaSuccess: { type: "integer" }, otaFailed: { type: "integer" } }
        },
        attentionDevices: {
          type: "array", maxItems: 5,
          items: { type: "object", required: ["deviceId", "online", "simulated", "activeAlarmCount", "lastSeenAt"], properties: { deviceId: { type: "string" }, online: { type: "boolean" }, simulated: { type: "boolean" }, activeAlarmCount: { type: "integer" }, lastSeenAt: { type: "string", format: "date-time" } } }
        }
      }
    },
    Error: errorResponse
  };

  return {
    openapi: "3.0.3",
    info: { title: "MCU Relay Backend API", version: options.version },
    servers: [{ url: options.baseUrl }],
    paths: {
      "/health": {
        get: {
          summary: "Get service health",
          responses: { "200": success({ type: "object", properties: { status: { type: "string" }, uptime: { type: "number" }, projects: { type: "number" }, devices: { type: "number" }, commands_pending: { type: "number" }, tcp_gateway: { type: "string", enum: ["listening", "stopped", "unavailable"] }, tcp_gateway_host: { type: "string", nullable: true }, tcp_gateway_port: { type: "integer", nullable: true }, mqtt: { type: "string" } } }) }
        }
      },
      "/health/live": {
        get: { summary: "Check process liveness", responses: { "200": success({ type: "object", required: ["status", "uptime_seconds"], properties: { status: { type: "string", enum: ["alive"] }, uptime_seconds: { type: "integer" } } }) } }
      },
      "/health/ready": {
        get: { summary: "Check device gateway readiness", responses: { "200": success({ type: "object" }), "503": success({ type: "object" }) } }
      },
      "/api/openapi.json": {
        get: { summary: "Get the OpenAPI specification", responses: { "200": response("OpenAPI 3.0 specification.", { type: "object" }) } }
      },
      "/api/sdk": {
        get: {
          summary: "Generate a lightweight SDK",
          parameters: [{ name: "lang", in: "query", required: false, schema: { type: "string", enum: ["javascript", "python", "c"] } }],
          responses: { "200": { description: "Generated SDK source.", content: { "text/plain": { schema: { type: "string" } } } } }
        }
      },
      "/api/endpoints": {
        get: { summary: "List available API endpoints", responses: { "200": success({ type: "array", items: { $ref: "#/components/schemas/JsonObject" } }) } }
      },
      "/api/v1/operations/metrics": {
        get: { summary: "Get operational runtime metrics", parameters: [adminToken], responses: { "200": success({ type: "object" }), "401": response("Admin token is missing or invalid.", errorResponse), "403": response("Remote administration is disabled.", errorResponse) } }
      },
      "/api/v1/mqtt-status": {
        get: { summary: "Get MQTT bridge status", responses: { "200": success({ type: "object", properties: { status: { type: "string" }, broker: { type: "string" }, port: { type: "number" }, clientId: { type: "string" }, tls: { type: "boolean" } } }) } }
      },
      "/api/v1/projects": {
        get: { summary: "List projects", parameters: [adminToken], responses: { "200": success({ type: "array", items: { $ref: "#/components/schemas/ProjectRecord" } }), "401": response("Admin token is missing or invalid.", errorResponse), "403": response("Remote administration is disabled.", errorResponse) } },
        post: { summary: "Create a project", parameters: [adminToken], requestBody: body({ $ref: "#/components/schemas/ProjectInput" }), responses: { "201": success({ $ref: "#/components/schemas/ProjectRecord" }), "401": response("Admin token is missing or invalid.", errorResponse), "403": response("Remote administration is disabled.", errorResponse), "409": response("Project already exists.", errorResponse) } }
      },
      "/api/v1/projects/{projectId}": {
        put: { summary: "Update a project display name", parameters: [projectIdParameter, optionalProjectToken, optionalAgentKey], requestBody: body({ $ref: "#/components/schemas/ProjectNameInput" }), responses: { "200": success({ $ref: "#/components/schemas/ProjectRecord" }), "401": response("Project access credential is invalid or missing.", errorResponse), "404": response("Project was not found.", errorResponse) } },
        delete: { summary: "Delete a project and all associated data", parameters: [projectIdParameter, optionalProjectToken, optionalAgentKey], responses: { "200": success({ type: "object", required: ["deleted", "projectId"], properties: { deleted: { type: "boolean", enum: [true] }, projectId: { type: "string" } } }), "401": response("Project access credential is invalid or missing.", errorResponse), "404": response("Project was not found.", errorResponse) } }
      },
      "/api/v1/projects/{projectId}/reset-token": {
        post: { summary: "Reset a project token", parameters: [projectIdParameter, projectToken], responses: { "200": success({ type: "object", required: ["newToken"], properties: { newToken: { type: "string" } } }), "401": response("Project token is invalid or missing.", errorResponse), "404": response("Project was not found.", errorResponse) } }
      },
      "/api/v1/projects/{projectId}/agent-keys": {
        get: { summary: "List redacted Agent Keys", parameters: [projectIdParameter, optionalProjectToken, optionalAgentKey], responses: protectedResponses({ type: "array", items: { $ref: "#/components/schemas/AgentKeySummary" } }) },
        post: { summary: "Create an Agent Key", parameters: [projectIdParameter, optionalProjectToken, optionalAgentKey], requestBody: body({ type: "object", required: ["label"], properties: { label: { type: "string" } } }), responses: { "201": success({ type: "object", description: "The complete key is returned only when it is created." }), "401": response("Project access credential is invalid or missing.", errorResponse) } }
      },
      "/api/v1/projects/{projectId}/agent-keys/{keyId}": {
        delete: { summary: "Delete an Agent Key", parameters: [projectIdParameter, resourceIdParameter("keyId"), optionalProjectToken, optionalAgentKey], responses: protectedResponses({ type: "object" }) }
      },
      "/api/v1/projects/{projectId}/rules": {
        get: { summary: "List automation rules", parameters: [projectIdParameter, optionalProjectToken, optionalAgentKey], responses: protectedResponses({ type: "array", items: { type: "object" } }) },
        post: { summary: "Create an automation rule", parameters: [projectIdParameter, optionalProjectToken, optionalAgentKey], requestBody: body({ type: "object" }), responses: { "201": success({ type: "object" }), "400": response("Invalid rule.", errorResponse), "401": response("Project access credential is invalid or missing.", errorResponse) } }
      },
      "/api/v1/projects/{projectId}/rules/{ruleId}": {
        put: { summary: "Update an automation rule", parameters: [projectIdParameter, resourceIdParameter("ruleId"), optionalProjectToken, optionalAgentKey], requestBody: body({ type: "object" }), responses: protectedResponses({ type: "object" }) },
        delete: { summary: "Delete an automation rule", parameters: [projectIdParameter, resourceIdParameter("ruleId"), optionalProjectToken, optionalAgentKey], responses: protectedResponses({ type: "object" }) }
      },
      "/api/v1/projects/{projectId}/forwarders": {
        get: { summary: "List report forwarders", parameters: [projectIdParameter, optionalProjectToken, optionalAgentKey], responses: protectedResponses({ type: "array", items: { type: "object" } }) },
        post: { summary: "Create a report forwarder", parameters: [projectIdParameter, optionalProjectToken, optionalAgentKey], requestBody: body({ type: "object" }), responses: { "201": success({ type: "object" }), "400": response("Invalid forwarder.", errorResponse), "401": response("Project access credential is invalid or missing.", errorResponse) } }
      },
      "/api/v1/projects/{projectId}/forwarders/{forwarderId}": {
        put: { summary: "Update a report forwarder", parameters: [projectIdParameter, resourceIdParameter("forwarderId"), optionalProjectToken, optionalAgentKey], requestBody: body({ type: "object" }), responses: protectedResponses({ type: "object" }) },
        delete: { summary: "Delete a report forwarder", parameters: [projectIdParameter, resourceIdParameter("forwarderId"), optionalProjectToken, optionalAgentKey], responses: protectedResponses({ type: "object" }) }
      },
      "/api/v1/projects/{projectId}/firmware": {
        get: { summary: "List firmware records", parameters: [projectIdParameter, optionalProjectToken, optionalAgentKey], responses: protectedResponses({ type: "array", items: { $ref: "#/components/schemas/FirmwareRecord" } }) },
        post: { summary: "Add firmware metadata", parameters: [projectIdParameter, optionalProjectToken, optionalAgentKey], requestBody: body({ type: "object", required: ["version", "fileName", "fileSize", "md5", "downloadUrl"], properties: { version: { type: "string" }, fileName: { type: "string" }, fileSize: { type: "integer", minimum: 0 }, md5: { type: "string" }, downloadUrl: { type: "string", format: "uri" } } }), responses: { "201": success({ $ref: "#/components/schemas/FirmwareRecord" }), "400": response("Invalid firmware metadata.", errorResponse), "401": response("Project access credential is invalid or missing.", errorResponse) } }
      },
      "/api/v1/projects/{projectId}/firmware/{firmwareId}": {
        delete: { summary: "Delete firmware metadata", parameters: [projectIdParameter, resourceIdParameter("firmwareId"), optionalProjectToken, optionalAgentKey], responses: protectedResponses({ type: "object" }) }
      },
      "/api/v1/devices": {
        get: { summary: "List devices", parameters: [{ name: "projectId", in: "query", required: true, schema: { type: "string" } }, optionalProjectToken, optionalAgentKey], responses: protectedResponses({ type: "array", items: { $ref: "#/components/schemas/DeviceRecord" } }) }
      },
      "/api/v1/devices/status": {
        get: { summary: "Get device status summary", parameters: [{ name: "projectId", in: "query", required: true, schema: { type: "string" } }, { name: "type", in: "query", required: false, schema: { type: "string" } }, optionalProjectToken, optionalAgentKey], responses: protectedResponses({ type: "object" }) }
      },
      "/api/v1/devices/status-items": {
        get: { summary: "List detailed device online statuses", parameters: [{ name: "projectId", in: "query", required: true, schema: { type: "string" } }, optionalProjectToken, optionalAgentKey], responses: protectedResponses({ type: "array", items: { $ref: "#/components/schemas/DeviceStatusItem" } }) }
      },
      "/api/v1/dashboard": {
        get: { summary: "Get the fixed 24-hour project dashboard snapshot", parameters: [{ name: "projectId", in: "query", required: true, schema: { type: "string" } }, optionalProjectToken, optionalAgentKey], responses: protectedResponses({ $ref: "#/components/schemas/DashboardSnapshot" }) }
      },
      "/api/v1/devices/report": {
        post: { summary: "Submit a device report", requestBody: body({ $ref: "#/components/schemas/DeviceReportInput" }), responses: { "201": success({ $ref: "#/components/schemas/DeviceRecord" }), "400": response("Invalid report.", errorResponse), "401": response("Project token is invalid.", errorResponse) } }
      },
      "/api/v1/devices/batch-report": {
        post: { summary: "Submit multiple device reports", requestBody: body({ type: "object", required: ["projectId", "token", "reports"], properties: { projectId: { type: "string" }, token: { type: "string" }, reports: { type: "array", minItems: 1, maxItems: 50, items: { $ref: "#/components/schemas/DeviceReportInput" } } } }), responses: { "201": success({ type: "object", properties: { count: { type: "number" }, devices: { type: "array", items: { $ref: "#/components/schemas/DeviceRecord" } } } }), "400": response("Invalid report batch.", errorResponse), "401": response("Project token is invalid.", errorResponse) } }
      },
      "/api/v1/devices/register": {
        post: { summary: "Register a device", requestBody: body({ type: "object", required: ["projectId", "token", "deviceId"], properties: { projectId: { type: "string" }, token: { type: "string" }, deviceId: { type: "string" }, name: { type: "string" }, type: { type: "string" }, location: { type: "string" }, metadata: { $ref: "#/components/schemas/JsonObject" }, template: { type: "object", required: ["values", "relays", "alarms"], properties: { values: { type: "array", items: { type: "object", required: ["key", "unit", "label"], properties: { key: { type: "string" }, unit: { type: "string" }, label: { type: "string" } } } }, relays: { type: "array", items: { type: "object", required: ["key", "label"], properties: { key: { type: "string" }, label: { type: "string" } } } }, alarms: { type: "array", items: { type: "object", required: ["key", "label"], properties: { key: { type: "string" }, label: { type: "string" } } } } } } } }), responses: { "201": success({ $ref: "#/components/schemas/DeviceRecord" }), "401": response("Project token is invalid.", errorResponse) } }
      },
      "/api/v1/commands": {
        get: { summary: "List command history", parameters: [{ name: "projectId", in: "query", required: true, schema: { type: "string" } }, { name: "deviceId", in: "query", required: false, schema: { type: "string" } }, { name: "status", in: "query", required: false, schema: { type: "string", enum: ["pending", "queued", "dispatched", "acked", "state_confirmed", "failed", "expired", "superseded"] } }, { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200, default: 100 } }, optionalProjectToken, optionalAgentKey], responses: protectedResponses({ type: "array", items: { $ref: "#/components/schemas/DeviceCommand" } }) }
      },
      "/api/v1/commands/batch": {
        post: {
          summary: "Queue the same command for up to 50 devices",
          parameters: [optionalProjectToken, optionalAgentKey],
          requestBody: body({ type: "object", required: ["projectId", "deviceIds", "command"], properties: { projectId: { type: "string" }, deviceIds: { type: "array", minItems: 1, maxItems: 50, uniqueItems: true, items: { type: "string" } }, command: { $ref: "#/components/schemas/DeviceCommandInput" } } }),
          responses: { "201": success({ type: "object", required: ["count", "dispatched", "queuedOffline", "commands"], properties: { count: { type: "integer" }, dispatched: { type: "integer" }, queuedOffline: { type: "integer" }, commands: { type: "array", items: { $ref: "#/components/schemas/DeviceCommand" } } } }), "400": response("Invalid batch command.", errorResponse), "401": response("Project access credential is invalid or missing.", errorResponse) }
        }
      },
      "/api/v1/devices/import": {
        post: { summary: "Import devices and optional reports", requestBody: body({ type: "object", required: ["projectId", "token", "devices"], properties: { projectId: { type: "string" }, token: { type: "string" }, devices: { type: "array", minItems: 1, maxItems: 100, items: { type: "object", required: ["deviceId"], properties: { deviceId: { type: "string" }, values: { type: "array", items: { $ref: "#/components/schemas/DeviceValue" } }, relays: { type: "array", items: { $ref: "#/components/schemas/RelayOutput" } }, alarms: { type: "array", items: { $ref: "#/components/schemas/AlarmState" } } } } } } }), responses: { "201": success({ type: "object", properties: { count: { type: "number" }, devices: { type: "array", items: { $ref: "#/components/schemas/DeviceRecord" } } } }), "400": response("Invalid import.", errorResponse), "401": response("Project token is invalid.", errorResponse) } }
      },
      "/api/v1/devices/probe": {
        post: { summary: "Probe device reachability", requestBody: body({ $ref: "#/components/schemas/ProbeRequest" }), responses: { "200": success({ $ref: "#/components/schemas/ProbeResult" }), "400": response("Invalid probe request.", errorResponse), "401": response("Project token is invalid.", errorResponse) } }
      },
      "/api/v1/devices/{projectId}/{deviceId}/latest": {
        get: { summary: "Get the latest device data", parameters: [projectIdParameter, deviceIdParameter, projectToken], responses: protectedResponses({ $ref: "#/components/schemas/DeviceRecord" }) }
      },
      "/api/v1/devices/{projectId}/{deviceId}/commands": {
        post: { summary: "Queue a command", parameters: [projectIdParameter, deviceIdParameter, projectToken], requestBody: body({ $ref: "#/components/schemas/DeviceCommandInput" }), responses: { "201": success({ $ref: "#/components/schemas/DeviceCommand" }), "400": response("Invalid command.", errorResponse), "401": response("Project token is invalid.", errorResponse) } }
      },
      "/api/v1/devices/{projectId}/{deviceId}/commands/{commandId}": {
        get: { summary: "Get command lifecycle status", parameters: [projectIdParameter, deviceIdParameter, commandIdParameter, optionalProjectToken, optionalAgentKey], responses: protectedResponses({ type: "object", required: ["command", "device"], properties: { command: { $ref: "#/components/schemas/DeviceCommand" }, device: { type: "object" } } }) }
      },
      "/api/v1/devices/{projectId}/{deviceId}/diagnostics": {
        get: { summary: "Get device TCP and command diagnostics", parameters: [projectIdParameter, deviceIdParameter, optionalProjectToken, optionalAgentKey], responses: protectedResponses({ type: "object" }) }
      },
      "/api/v1/devices/{projectId}/{deviceId}/commands/next": {
        get: { summary: "Poll the next command", parameters: [projectIdParameter, deviceIdParameter, projectToken], responses: protectedResponses({ oneOf: [{ type: "object", required: ["hasCommand"], properties: { hasCommand: { type: "boolean", enum: [false] } } }, { type: "object", required: ["hasCommand", "command"], properties: { hasCommand: { type: "boolean", enum: [true] }, command: { $ref: "#/components/schemas/DeviceCommand" } } }] }) }
      },
      "/api/v1/devices/{projectId}/{deviceId}/commands/{commandId}/ack": {
        post: { summary: "Acknowledge a command", parameters: [projectIdParameter, deviceIdParameter, commandIdParameter, projectToken], responses: { "200": success({ oneOf: [{ $ref: "#/components/schemas/DeviceCommand" }, { $ref: "#/components/schemas/ProbeResult" }] }), "401": response("Project token is invalid.", errorResponse), "404": response("Command was not found.", errorResponse) } }
      },
      "/api/v1/devices/{projectId}/{deviceId}/probe-status": {
        get: { summary: "Get the latest probe status", parameters: [projectIdParameter, deviceIdParameter, projectToken], responses: protectedResponses({ $ref: "#/components/schemas/ProbeResult" }) }
      },
      "/api/v1/devices/{projectId}/{deviceId}/verify": {
        post: { summary: "Wait for device verification", parameters: [projectIdParameter, deviceIdParameter, optionalProjectToken, optionalAgentKey], requestBody: body({ type: "object", properties: { timeoutMs: { type: "integer", minimum: 1 } } }), responses: protectedResponses({ type: "object" }) }
      },
      "/api/v1/devices/{projectId}/{deviceId}/remote-debug/status": {
        get: { summary: "Get the live TCP connection and remote debug session status", parameters: [projectIdParameter, deviceIdParameter, optionalProjectToken, optionalAgentKey], responses: protectedResponses({ type: "object", required: ["online", "projectId", "deviceId", "session"], properties: { online: { type: "boolean" }, projectId: { type: "string" }, deviceId: { type: "string" }, session: { $ref: "#/components/schemas/RemoteDebugSession" } } }) }
      },
      "/api/v1/devices/{projectId}/{deviceId}/remote-debug/logs": {
        get: { summary: "List retained remote debug TX and RX log entries", parameters: [projectIdParameter, deviceIdParameter, { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 2000, default: 500 } }, optionalProjectToken, optionalAgentKey], responses: protectedResponses({ type: "object", required: ["projectId", "deviceId", "total", "retainedLimit", "items"], properties: { projectId: { type: "string" }, deviceId: { type: "string" }, total: { type: "integer", minimum: 0 }, retainedLimit: { type: "integer", enum: [2000] }, items: { type: "array", items: { $ref: "#/components/schemas/RemoteDebugLogEntry" } } } }) },
        delete: { summary: "Clear retained remote debug logs and counters", parameters: [projectIdParameter, deviceIdParameter, optionalProjectToken, optionalAgentKey], responses: protectedResponses({ type: "object", required: ["projectId", "deviceId", "cleared"], properties: { projectId: { type: "string" }, deviceId: { type: "string" }, cleared: { type: "integer", minimum: 0 } } }) }
      },
      "/api/v1/devices/{projectId}/{deviceId}/remote-debug/open": {
        post: { summary: "Tell an online TCP device to enter remote debug mode", parameters: [projectIdParameter, deviceIdParameter, optionalProjectToken, optionalAgentKey], responses: { "200": success({ type: "object", required: ["online", "projectId", "deviceId", "session"], properties: { online: { type: "boolean", enum: [true] }, projectId: { type: "string" }, deviceId: { type: "string" }, session: { $ref: "#/components/schemas/RemoteDebugSession" } } }), "401": response("Project access credential is invalid or missing.", errorResponse), "409": response("The device has no active TCP connection.", errorResponse) } }
      },
      "/api/v1/devices/{projectId}/{deviceId}/remote-debug/write": {
        post: { summary: "Write raw bytes to an online TCP device debug tunnel", parameters: [projectIdParameter, deviceIdParameter, optionalProjectToken, optionalAgentKey], requestBody: body({ $ref: "#/components/schemas/RemoteDebugWrite" }), responses: { "200": success({ type: "object", required: ["byteLength", "entry"], properties: { byteLength: { type: "integer", minimum: 1, maximum: 16384 }, entry: { $ref: "#/components/schemas/RemoteDebugLogEntry" } } }), "400": response("Remote debug bytes are invalid.", errorResponse), "401": response("Project access credential is invalid or missing.", errorResponse), "409": response("The device has no active TCP connection.", errorResponse) } }
      },
      "/api/v1/devices/{projectId}/{deviceId}/remote-debug/close": {
        post: { summary: "Tell an online TCP device to leave remote debug mode", parameters: [projectIdParameter, deviceIdParameter, optionalProjectToken, optionalAgentKey], responses: { "200": success({ type: "object", required: ["closed", "projectId", "deviceId", "session"], properties: { closed: { type: "boolean", enum: [true] }, projectId: { type: "string" }, deviceId: { type: "string" }, session: { $ref: "#/components/schemas/RemoteDebugSession" } } }), "401": response("Project access credential is invalid or missing.", errorResponse), "409": response("The device has no active TCP connection.", errorResponse) } }
      },
      "/api/v1/devices/{projectId}/{deviceId}/shadow": {
        get: { summary: "Get device shadow", parameters: [projectIdParameter, deviceIdParameter, optionalProjectToken, optionalAgentKey], responses: protectedResponses({ type: "object" }) },
        put: { summary: "Update desired device shadow", parameters: [projectIdParameter, deviceIdParameter, optionalProjectToken, optionalAgentKey], requestBody: body({ type: "object", required: ["desired"], properties: { desired: { $ref: "#/components/schemas/JsonObject" } } }), responses: protectedResponses({ type: "object" }) }
      },
      "/api/v1/devices/{projectId}/{deviceId}/simulate": {
        post: { summary: "Simulate a device report", parameters: [projectIdParameter, deviceIdParameter, optionalProjectToken, optionalAgentKey], requestBody: body({ type: "object" }), responses: protectedResponses({ $ref: "#/components/schemas/DeviceRecord" }) }
      },
      "/api/v1/devices/{projectId}/{deviceId}/ota": {
        get: { summary: "List OTA tasks or get one by otaId", parameters: [projectIdParameter, deviceIdParameter, { name: "otaId", in: "query", required: false, schema: { type: "string" } }, optionalProjectToken, optionalAgentKey], responses: protectedResponses({ oneOf: [{ $ref: "#/components/schemas/OTATask" }, { type: "array", items: { $ref: "#/components/schemas/OTATask" } }] }) },
        post: { summary: "Create an OTA task and queue the ota_update command", parameters: [projectIdParameter, deviceIdParameter, optionalProjectToken, optionalAgentKey], requestBody: body({ type: "object", required: ["firmwareId"], properties: { firmwareId: { type: "string" } } }), responses: { "201": success({ $ref: "#/components/schemas/OTATask" }), "401": response("Project access credential is invalid or missing.", errorResponse), "404": response("Firmware was not found.", errorResponse), "409": response("Firmware has no download source.", errorResponse) } }
      },
      "/api/v1/devices/{projectId}/{deviceId}/ota/{otaId}/progress": {
        post: { summary: "Report OTA progress", parameters: [projectIdParameter, deviceIdParameter, resourceIdParameter("otaId"), optionalProjectToken, optionalAgentKey], requestBody: body({ type: "object", required: ["status", "progress"], properties: { status: { type: "string", enum: ["downloading", "installing", "success", "failed"] }, progress: { type: "integer", minimum: 0, maximum: 100 } } }), responses: { "200": success({ $ref: "#/components/schemas/OTATask" }), "400": response("Invalid progress.", errorResponse), "401": response("Project access credential is invalid or missing.", errorResponse), "404": response("OTA task was not found.", errorResponse), "409": response("OTA state transition is not allowed.", errorResponse) } }
      },
      "/api/v1/ai/chat": {
        post: { summary: "Chat with the configured AI service", requestBody: body({ type: "object" }), responses: { "200": success({ type: "object" }), "401": response("Project token is invalid.", errorResponse), "503": response("AI service is not configured.", errorResponse) } }
      },
      "/api/v1/ai/generate-template": {
        post: { summary: "Generate a device template with the configured AI service", requestBody: body({ type: "object" }), responses: { "200": success({ type: "object" }), "401": response("Project token is invalid.", errorResponse), "503": response("AI service is not configured.", errorResponse) } }
      },
      "/api/v1/events": {
        get: { summary: "Open the server-sent event stream", parameters: [{ name: "projectId", in: "query", required: true, schema: { type: "string" } }, { name: "deviceId", in: "query", required: false, schema: { type: "string" } }, projectToken], responses: { "200": { description: "Server-sent event stream.", content: { "text/event-stream": { schema: { type: "string" } } } }, "401": response("Project token is invalid.", errorResponse) } }
      }
    },
    components: {
      securitySchemes: {
        ProjectToken: { type: "apiKey", in: "header", name: "x-project-token" },
        AgentKey: { type: "apiKey", in: "header", name: "x-agent-key" },
        AdminToken: { type: "apiKey", in: "header", name: "x-admin-token" }
      },
      schemas
    }
  };
};
