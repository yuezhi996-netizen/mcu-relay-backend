import { useEffect, useState } from "react";

export type HealthStatus = "loading" | "healthy" | "error";
export type HealthSnapshot = {
  readonly status: HealthStatus;
  readonly tcpGateway: string | null;
  readonly tcpGatewayHost: string | null;
  readonly tcpGatewayPort: number | null;
};

const loadingSnapshot: HealthSnapshot = {
  status: "loading",
  tcpGateway: null,
  tcpGatewayHost: null,
  tcpGatewayPort: null
};

const readProperty = (value: object, key: string): unknown => key in value ? Reflect.get(value, key) as unknown : undefined;

const parseHealthSnapshot = (payload: unknown): HealthSnapshot => {
  if (typeof payload !== "object" || payload === null || readProperty(payload, "ok") !== true) {
    throw new Error("健康检查返回格式无效。");
  }
  const data = readProperty(payload, "data");
  if (typeof data !== "object" || data === null) throw new Error("健康检查缺少 data。");
  const serviceStatus = readProperty(data, "status");
  const tcpGateway = readProperty(data, "tcp_gateway");
  const tcpGatewayHost = readProperty(data, "tcp_gateway_host");
  const tcpGatewayPort = readProperty(data, "tcp_gateway_port");
  if (serviceStatus !== "ok" || typeof tcpGateway !== "string" || tcpGateway.trim().length === 0 || typeof tcpGatewayHost !== "string" || tcpGatewayHost.trim().length === 0 || typeof tcpGatewayPort !== "number" || !Number.isInteger(tcpGatewayPort) || tcpGatewayPort < 1 || tcpGatewayPort > 65_535) {
    throw new Error("健康检查的 TCP 网关字段无效。");
  }
  return { status: "healthy", tcpGateway, tcpGatewayHost, tcpGatewayPort };
};

export const formatTcpGatewayAddress = (snapshot: HealthSnapshot, browserHostname: string): string => {
  if (snapshot.status === "loading") return "正在获取网关地址";
  if (snapshot.status === "error" || snapshot.tcpGatewayHost === null || snapshot.tcpGatewayPort === null) return "网关地址不可用";
  const configuredHost = snapshot.tcpGatewayHost.trim();
  const host = configuredHost === "0.0.0.0" || configuredHost === "::" || configuredHost === "[::]"
    ? browserHostname.trim() || "127.0.0.1"
    : configuredHost;
  const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${formattedHost}:${snapshot.tcpGatewayPort}`;
};

export const useHealth = (): HealthSnapshot => {
  const [snapshot, setSnapshot] = useState<HealthSnapshot>(loadingSnapshot);

  useEffect(() => {
    let active = true;
    const check = async (): Promise<void> => {
      try {
        const response = await fetch("/health");
        if (!active) return;
        if (!response.ok) {
          setSnapshot({ ...loadingSnapshot, status: "error" });
          return;
        }
        const payload = await response.json() as unknown;
        if (active) setSnapshot(parseHealthSnapshot(payload));
      } catch {
        if (active) setSnapshot({ ...loadingSnapshot, status: "error" });
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 10_000);
    return (): void => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return snapshot;
};
