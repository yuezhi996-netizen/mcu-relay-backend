import type { AppError, JsonObject } from "./types.js";

export const ErrorCodes = {
  PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
  INVALID_PROJECT_TOKEN: "INVALID_PROJECT_TOKEN",
  DEVICE_NOT_FOUND: "DEVICE_NOT_FOUND",
  COMMAND_NOT_FOUND: "COMMAND_NOT_FOUND",
  AGENT_KEY_NOT_FOUND: "AGENT_KEY_NOT_FOUND",
  RULE_NOT_FOUND: "RULE_NOT_FOUND",
  FORWARDER_NOT_FOUND: "FORWARDER_NOT_FOUND",
  FIRMWARE_NOT_FOUND: "FIRMWARE_NOT_FOUND",
  VERIFY_TIMEOUT: "VERIFY_TIMEOUT",
  AI_SERVICE_ERROR: "AI_SERVICE_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
} as const;

export const createAppError = (
  statusCode: number,
  code: string,
  message: string,
  details: JsonObject | null
): AppError => {
  return {
    statusCode,
    code,
    message,
    details
  };
};

export const isAppError = (value: object): value is AppError => {
  return (
    "statusCode" in value &&
    "code" in value &&
    "message" in value &&
    typeof value.statusCode === "number" &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
};
