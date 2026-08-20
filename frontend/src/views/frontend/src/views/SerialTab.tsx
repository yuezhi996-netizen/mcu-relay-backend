import {
  ClearOutlined,
  CloudServerOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  HistoryOutlined,
  LinkOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  SendOutlined
} from "@ant-design/icons";
import { Alert, Button, Card, Col, Descriptions, Drawer, Empty, Input, InputNumber, Popconfirm, Row, Segmented, Select, Space, Spin, Switch, Tag, Tooltip, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestJson } from "../api/client";
import { createNamedEventStream } from "../api/sse";
import type { DeviceRecord, ProjectRecord } from "../types";
import {
  buildSendBytes,
  bytesToBase64,
  bytesToHex,
  formatByteSize,
  formatDuration,
  formatLogEntry,
  formatTimestamp,
  parseRemoteDebugLogEntry,
  parseRemoteDebugLogPage,
  parseRemoteDebugStatus,
  parseRemoteDebugWriteResponse,
  parseSerialPresets,
  type ChecksumMode,
  type LineEnding,
  type RemoteDebugSession,
  type SerialDirection,
  type SerialDisplayMode,
  type SerialLogEntry,
  type SerialPreset
} from "./serialProtocol";

type RemoteDebugStatus = "disconnected" | "connecting" | "connected" | "disconnecting" | "error";
type StreamStatus = "connected" | "reconnecting" | "disconnected";
type ExportFormat = "txt" | "csv" | "json";
type LogLimit = 500 | 1000 | 2000;
type SendHistoryEntry = {
  readonly id: string;
  readonly value: string;
  readonly sendMode: SerialDisplayMode;
  readonly lineEnding: LineEnding;
  readonly checksumMode: ChecksumMode;
  readonly byteLength: number;
  readonly sentAt: string;
};

export type SerialTabProps = {
  readonly project: ProjectRecord | undefined;
  readonly devices: readonly DeviceRecord[];
};

const emptySession: RemoteDebugSession = {
  active: false,
  openedAt: null,
  closedAt: null,
  lastActivityAt: null,
  txFrames: 0,
  txBytes: 0,
  rxFrames: 0,
  rxBytes: 0,
  retainedEntries: 0
};
const remoteDebugEventNames = ["remote_debug_log"] as const;
const presetStorageKey = "mcu-relay.serial-presets.v1";

const statusView: Readonly<Record<RemoteDebugStatus, { readonly color: string; readonly label: string }>> = {
  disconnected: { color: "default", label: "未开启" },
  connecting: { color: "processing", label: "正在开启" },
  connected: { color: "success", label: "调试中" },
  disconnecting: { color: "warning", label: "正在关闭" },
  error: { color: "error", label: "连接异常" }
};
const streamStatusView: Readonly<Record<StreamStatus, { readonly color: string; readonly label: string }>> = {
  connected: { color: "green", label: "事件流已连接" },
  reconnecting: { color: "blue", label: "事件流重连中" },
  disconnected: { color: "red", label: "事件流已断开" }
};
const checksumOptions: readonly { readonly value: ChecksumMode; readonly label: string }[] = [
  { value: "none", label: "不追加校验" },
  { value: "xor8", label: "XOR8" },
  { value: "sum8", label: "SUM8" },
  { value: "crc16-modbus", label: "CRC16 Modbus" }
];

const createRemoteDebugPath = (projectId: string, deviceId: string, action: "status" | "logs" | "open" | "write" | "close"): string => {
  return `/api/v1/devices/${encodeURIComponent(projectId)}/${encodeURIComponent(deviceId)}/remote-debug/${action}`;
};
const projectHeaders = (token: string): Readonly<Record<string, string>> => ({ "x-project-token": token });
const createLocalId = (): string => `${Date.now()}-${crypto.randomUUID()}`;

const updateSessionWithEntry = (session: RemoteDebugSession, entry: SerialLogEntry): RemoteDebugSession => ({
  ...session,
  lastActivityAt: entry.receivedAt,
  txFrames: session.txFrames + (entry.direction === "TX" ? 1 : 0),
  txBytes: session.txBytes + (entry.direction === "TX" ? entry.byteLength : 0),
  rxFrames: session.rxFrames + (entry.direction === "RX" ? 1 : 0),
  rxBytes: session.rxBytes + (entry.direction === "RX" ? entry.byteLength : 0),
  retainedEntries: Math.min(2_000, session.retainedEntries + 1)
});

const waitForInterval = async (intervalMs: number, signal: AbortSignal): Promise<void> => {
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = window.setTimeout(resolve, intervalMs);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
};

const quoteCsv = (value: string): string => `"${value.replaceAll('"', '""')}"`;
const formatExportContent = (entries: readonly SerialLogEntry[], format: ExportFormat, mode: SerialDisplayMode, showTimestamp: boolean): { readonly content: string; readonly mime: string } => {
  if (format === "json") {
    return {
      content: JSON.stringify(entries.map((entry) => ({ timestamp: entry.receivedAt, direction: entry.direction, byteLength: entry.byteLength, text: entry.text, hex: bytesToHex(entry.bytes), base64: entry.data })), null, 2),
      mime: "application/json;charset=utf-8"
    };
  }
  if (format === "csv") {
    const header = "timestamp,direction,byteLength,text,hex,base64";
    const rows = entries.map((entry) => [entry.receivedAt, entry.direction, String(entry.byteLength), entry.text, bytesToHex(entry.bytes), entry.data].map(quoteCsv).join(","));
    return { content: `\ufeff${[header, ...rows].join("\n")}`, mime: "text/csv;charset=utf-8" };
  }
  return { content: entries.map((entry) => formatLogEntry(entry, mode, showTimestamp)).join("\n"), mime: "text/plain;charset=utf-8" };
};

const persistPresets = (presets: readonly SerialPreset[]): void => {
  localStorage.setItem(presetStorageKey, JSON.stringify(presets));
};

export const SerialTab = ({ project, devices }: SerialTabProps): JSX.Element => {
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [status, setStatus] = useState<RemoteDebugStatus>("disconnected");
  const [deviceOnline, setDeviceOnline] = useState<boolean | null>(null);
  const [session, setSession] = useState<RemoteDebugSession>(emptySession);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("disconnected");
  const [sendMode, setSendMode] = useState<SerialDisplayMode>("text");
  const [receiveMode, setReceiveMode] = useState<SerialDisplayMode>("text");
  const [lineEnding, setLineEnding] = useState<LineEnding>("none");
  const [checksumMode, setChecksumMode] = useState<ChecksumMode>("none");
  const [sendValue, setSendValue] = useState("");
  const [showTimestamp, setShowTimestamp] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [viewFrozen, setViewFrozen] = useState(false);
  const [logs, setLogs] = useState<readonly SerialLogEntry[]>([]);
  const [frozenLogs, setFrozenLogs] = useState<readonly SerialLogEntry[]>([]);
  const [logSearch, setLogSearch] = useState("");
  const [logDirection, setLogDirection] = useState<"all" | SerialDirection>("all");
  const [logLimit, setLogLimit] = useState<LogLimit>(500);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("txt");
  const [selectedLog, setSelectedLog] = useState<SerialLogEntry | null>(null);
  const [errorText, setErrorText] = useState("");
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [loadingState, setLoadingState] = useState(false);
  const [repeatCount, setRepeatCount] = useState(10);
  const [repeatIntervalMs, setRepeatIntervalMs] = useState(1000);
  const [cycleRunning, setCycleRunning] = useState(false);
  const [cycleSent, setCycleSent] = useState(0);
  const [sendHistory, setSendHistory] = useState<readonly SendHistoryEntry[]>([]);
  const [presets, setPresets] = useState<readonly SerialPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>(undefined);
  const [clock, setClock] = useState(Date.now());
  const knownLogKeysRef = useRef<Set<string>>(new Set());
  const repeatControllerRef = useRef<AbortController | null>(null);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const projectId = project?.projectId ?? "";

  const sendPreview = useMemo(() => {
    try {
      const bytes = buildSendBytes(sendValue, sendMode, lineEnding, checksumMode);
      return { bytes, error: "" };
    } catch (error: unknown) {
      return { bytes: null, error: error instanceof Error ? error.message : "发送帧解析失败。" };
    }
  }, [checksumMode, lineEnding, sendMode, sendValue]);

  const visibleLogs = viewFrozen ? frozenLogs : logs;
  const filteredLogs = useMemo(() => {
    const query = logSearch.trim().toLocaleLowerCase("zh-CN");
    return visibleLogs.filter((entry) => (logDirection === "all" || entry.direction === logDirection)
      && (query.length === 0 || `${entry.text}\n${bytesToHex(entry.bytes)}\n${entry.data}`.toLocaleLowerCase("zh-CN").includes(query)));
  }, [logDirection, logSearch, visibleLogs]);

  const appendLiveLog = useCallback((entry: SerialLogEntry): boolean => {
    if (knownLogKeysRef.current.has(entry.key)) return false;
    knownLogKeysRef.current.add(entry.key);
    setLogs((current) => [...current, entry].slice(-logLimit));
    setSession((current) => updateSessionWithEntry(current, entry));
    return true;
  }, [logLimit]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(presetStorageKey);
      if (stored !== null) setPresets(parseSerialPresets(JSON.parse(stored) as unknown));
    } catch (error: unknown) {
      setErrorText(`SERIAL_PRESET_LOAD_FAILED: ${error instanceof Error ? error.message : "快捷指令读取失败。"}`);
    }
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return (): void => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    repeatControllerRef.current?.abort();
    setSelectedDeviceId("");
    setStatus("disconnected");
    setDeviceOnline(null);
    setSession(emptySession);
    setLogs([]);
    setFrozenLogs([]);
    setViewFrozen(false);
    setErrorText("");
    knownLogKeysRef.current = new Set();
  }, [projectId]);
  useEffect(() => {
    setSelectedDeviceId((current) => devices.some((device) => device.deviceId === current) ? current : devices[0]?.deviceId ?? "");
  }, [devices]);
  useEffect(() => {
    if (!autoScroll || viewFrozen) return;
    const terminal = terminalRef.current;
    if (terminal !== null) terminal.scrollTop = terminal.scrollHeight;
  }, [autoScroll, logs, viewFrozen]);

  useEffect(() => {
    if (project === undefined || selectedDeviceId.length === 0) {
      setDeviceOnline(null);
      setSession(emptySession);
      setLogs([]);
      knownLogKeysRef.current = new Set();
      return;
    }
    let active = true;
    setLoadingState(true);
    setErrorText("");
    void Promise.all([
      requestJson<unknown>(createRemoteDebugPath(project.projectId, selectedDeviceId, "status"), { method: "GET", body: null, headers: projectHeaders(project.token) }),
      requestJson<unknown>(`${createRemoteDebugPath(project.projectId, selectedDeviceId, "logs")}?limit=${logLimit}`, { method: "GET", body: null, headers: projectHeaders(project.token) })
    ]).then(([statusResponse, logsResponse]) => {
      if (!active) return;
      const nextStatus = parseRemoteDebugStatus(statusResponse.data);
      const logPage = parseRemoteDebugLogPage(logsResponse.data);
      setDeviceOnline(nextStatus.online);
      setSession(nextStatus.session);
      setStatus(nextStatus.online && nextStatus.session.active ? "connected" : "disconnected");
      setLogs(logPage.items);
      knownLogKeysRef.current = new Set(logPage.items.map((entry) => entry.key));
    }).catch((error: unknown) => {
      if (!active) return;
      setStatus("error");
      setErrorText(error instanceof Error ? error.message : "远程串口状态加载失败。");
    }).finally(() => {
      if (active) setLoadingState(false);
    });
    return (): void => {
      active = false;
    };
  }, [logLimit, project, selectedDeviceId]);

  useEffect(() => {
    if (project === undefined || selectedDeviceId.length === 0) return;
    let active = true;
    const refresh = async (): Promise<void> => {
      try {
        const response = await requestJson<unknown>(createRemoteDebugPath(project.projectId, selectedDeviceId, "status"), { method: "GET", body: null, headers: projectHeaders(project.token) });
        if (!active) return;
        const nextStatus = parseRemoteDebugStatus(response.data);
        setDeviceOnline(nextStatus.online);
        setSession(nextStatus.session);
        setStatus((current) => current === "connecting" || current === "disconnecting" ? current : nextStatus.online && nextStatus.session.active ? "connected" : "disconnected");
      } catch (error: unknown) {
        if (!active) return;
        setDeviceOnline(null);
        setStatus((current) => current === "connected" ? "error" : current);
        setErrorText(error instanceof Error ? error.message : "远程设备状态检查失败。");
      }
    };
    const timer = window.setInterval(() => void refresh(), 5_000);
    return (): void => {
      active = false;
      window.clearInterval(timer);
    };
  }, [project, selectedDeviceId]);

  useEffect(() => {
    if (project === undefined || selectedDeviceId.length === 0) {
      setStreamStatus("disconnected");
      return;
    }
    return createNamedEventStream(`/api/v1/events?projectId=${encodeURIComponent(project.projectId)}&deviceId=${encodeURIComponent(selectedDeviceId)}&token=${encodeURIComponent(project.token)}`, remoteDebugEventNames, {
      onStatus: setStreamStatus,
      onEvent: (_name, payload) => {
        try {
          const entry = parseRemoteDebugLogEntry(payload);
          if (entry.projectId === project.projectId && entry.deviceId === selectedDeviceId) appendLiveLog(entry);
        } catch (error: unknown) {
          setErrorText(error instanceof Error ? error.message : "远程串口事件解析失败。");
        }
      }
    });
  }, [appendLiveLog, project, selectedDeviceId]);

  useEffect(() => (): void => repeatControllerRef.current?.abort(), []);

  const refreshConnection = async (): Promise<void> => {
    if (project === undefined || selectedDeviceId.length === 0) return;
    setChecking(true);
    setErrorText("");
    try {
      const response = await requestJson<unknown>(createRemoteDebugPath(project.projectId, selectedDeviceId, "status"), { method: "GET", body: null, headers: projectHeaders(project.token) });
      const nextStatus = parseRemoteDebugStatus(response.data);
      setDeviceOnline(nextStatus.online);
      setSession(nextStatus.session);
      setStatus(nextStatus.online && nextStatus.session.active ? "connected" : "disconnected");
      if (!nextStatus.online) setErrorText("REMOTE_DEBUG_DEVICE_OFFLINE: 设备尚未通过 TCP 网关连接后台。");
    } catch (error: unknown) {
      setDeviceOnline(null);
      setErrorText(error instanceof Error ? error.message : "远程设备状态检查失败。");
    } finally {
      setChecking(false);
    }
  };

  const connect = async (): Promise<void> => {
    if (project === undefined || selectedDeviceId.length === 0) {
      setErrorText("REMOTE_DEBUG_DEVICE_REQUIRED: 请先选择项目和设备。");
      return;
    }
    setStatus("connecting");
    setErrorText("");
    try {
      const response = await requestJson<unknown>(createRemoteDebugPath(project.projectId, selectedDeviceId, "open"), { method: "POST", body: null, headers: projectHeaders(project.token) });
      const nextStatus = parseRemoteDebugStatus(response.data);
      setDeviceOnline(nextStatus.online);
      setSession(nextStatus.session);
      setStatus("connected");
    } catch (error: unknown) {
      setStatus("error");
      setErrorText(error instanceof Error ? error.message : "远程调试开启失败。");
    }
  };

  const stopCycle = (): void => {
    repeatControllerRef.current?.abort();
    repeatControllerRef.current = null;
    setCycleRunning(false);
  };

  const disconnect = async (): Promise<void> => {
    stopCycle();
    if (project === undefined || selectedDeviceId.length === 0) {
      setStatus("disconnected");
      return;
    }
    setStatus("disconnecting");
    setErrorText("");
    try {
      await requestJson<unknown>(createRemoteDebugPath(project.projectId, selectedDeviceId, "close"), { method: "POST", body: null, headers: projectHeaders(project.token) });
      setSession((current) => ({ ...current, active: false, closedAt: new Date().toISOString() }));
      setStatus("disconnected");
    } catch (error: unknown) {
      setStatus("error");
      setErrorText(error instanceof Error ? error.message : "远程调试关闭失败。");
    }
  };

  const transmit = async (bytes: Uint8Array): Promise<void> => {
    if (project === undefined || selectedDeviceId.length === 0 || status !== "connected") throw new Error("REMOTE_DEBUG_NOT_OPEN: 请先选择在线设备并开启远程调试。");
    const response = await requestJson<unknown>(createRemoteDebugPath(project.projectId, selectedDeviceId, "write"), { method: "POST", body: { encoding: "base64", data: bytesToBase64(bytes) }, headers: projectHeaders(project.token) });
    const result = parseRemoteDebugWriteResponse(response.data);
    if (result.byteLength !== bytes.byteLength) throw new Error(`REMOTE_DEBUG_WRITE_INVALID: 服务端确认 ${result.byteLength} 字节，但本地发送帧为 ${bytes.byteLength} 字节。`);
    appendLiveLog(result.entry);
  };

  const rememberSend = (bytes: Uint8Array): void => {
    const entry: SendHistoryEntry = { id: createLocalId(), value: sendValue, sendMode, lineEnding, checksumMode, byteLength: bytes.byteLength, sentAt: new Date().toISOString() };
    setSendHistory((current) => [entry, ...current].slice(0, 20));
  };

  const sendOnce = async (): Promise<void> => {
    if (sendPreview.bytes === null) {
      setErrorText(sendPreview.error);
      return;
    }
    setSending(true);
    setErrorText("");
    try {
      await transmit(sendPreview.bytes);
      rememberSend(sendPreview.bytes);
    } catch (error: unknown) {
      setErrorText(error instanceof Error ? error.message : "远程串口数据发送失败。");
    } finally {
      setSending(false);
    }
  };

  const startCycle = async (): Promise<void> => {
    if (sendPreview.bytes === null) {
      setErrorText(sendPreview.error);
      return;
    }
    const bytes = sendPreview.bytes;
    const controller = new AbortController();
    repeatControllerRef.current?.abort();
    repeatControllerRef.current = controller;
    setCycleRunning(true);
    setCycleSent(0);
    setErrorText("");
    rememberSend(bytes);
    try {
      for (let index = 0; index < repeatCount; index += 1) {
        if (controller.signal.aborted) break;
        await transmit(bytes);
        setCycleSent(index + 1);
        if (index + 1 < repeatCount) await waitForInterval(repeatIntervalMs, controller.signal);
      }
    } catch (error: unknown) {
      setErrorText(error instanceof Error ? error.message : "周期发送执行失败。");
    } finally {
      if (repeatControllerRef.current === controller) repeatControllerRef.current = null;
      setCycleRunning(false);
    }
  };

  const clearServerLogs = async (): Promise<void> => {
    if (project === undefined || selectedDeviceId.length === 0) return;
    setErrorText("");
    try {
      await requestJson<unknown>(createRemoteDebugPath(project.projectId, selectedDeviceId, "logs"), { method: "DELETE", body: null, headers: projectHeaders(project.token) });
      knownLogKeysRef.current = new Set();
      setLogs([]);
      setFrozenLogs([]);
      setViewFrozen(false);
      setSession((current) => ({ ...current, lastActivityAt: null, txFrames: 0, txBytes: 0, rxFrames: 0, rxBytes: 0, retainedEntries: 0 }));
    } catch (error: unknown) {
      setErrorText(error instanceof Error ? error.message : "远程串口日志清空失败。");
    }
  };

  const exportLogs = (): void => {
    const exported = formatExportContent(filteredLogs, exportFormat, receiveMode, showTimestamp);
    const url = URL.createObjectURL(new Blob([exported.content], { type: exported.mime }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `远程串口日志-${selectedDeviceId}-${new Date().toISOString().replaceAll(":", "-")}.${exportFormat}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const toggleFrozen = (checked: boolean): void => {
    if (checked) setFrozenLogs(logs);
    setViewFrozen(checked);
  };

  const applySendConfiguration = (entry: Pick<SendHistoryEntry, "value" | "sendMode" | "lineEnding" | "checksumMode">): void => {
    setSendValue(entry.value);
    setSendMode(entry.sendMode);
    setLineEnding(entry.lineEnding);
    setChecksumMode(entry.checksumMode);
  };

  const savePreset = (): void => {
    const name = presetName.trim();
    if (name.length === 0) {
      setErrorText("SERIAL_PRESET_NAME_REQUIRED: 请输入快捷指令名称。");
      return;
    }
    if (sendPreview.bytes === null) {
      setErrorText(sendPreview.error);
      return;
    }
    const preset: SerialPreset = { id: createLocalId(), name, value: sendValue, sendMode, lineEnding, checksumMode };
    const next = [preset, ...presets.filter((item) => item.name !== name)].slice(0, 50);
    try {
      persistPresets(next);
      setPresets(next);
      setPresetName("");
      setSelectedPresetId(preset.id);
    } catch (error: unknown) {
      setErrorText(`SERIAL_PRESET_SAVE_FAILED: ${error instanceof Error ? error.message : "快捷指令保存失败。"}`);
    }
  };

  const deletePreset = (): void => {
    if (selectedPresetId === undefined) return;
    const next = presets.filter((preset) => preset.id !== selectedPresetId);
    try {
      persistPresets(next);
      setPresets(next);
      setSelectedPresetId(undefined);
    } catch (error: unknown) {
      setErrorText(`SERIAL_PRESET_DELETE_FAILED: ${error instanceof Error ? error.message : "快捷指令删除失败。"}`);
    }
  };

  const handleDeviceChange = (deviceId: string): void => {
    stopCycle();
    setSelectedDeviceId(deviceId);
    setStatus("disconnected");
    setSession(emptySession);
    setLogs([]);
    setFrozenLogs([]);
    setViewFrozen(false);
    setLogSearch("");
    setLogDirection("all");
    setErrorText("");
    knownLogKeysRef.current = new Set();
  };

  const currentStatus = statusView[status];
  const currentStreamStatus = streamStatusView[streamStatus];
  const deviceOptions = useMemo(() => devices.map((device) => ({ value: device.deviceId, label: device.deviceId })), [devices]);
  const selectionUnavailable = project === undefined || selectedDeviceId.length === 0;
  const runningDuration = session.active ? formatDuration(session.openedAt, clock) : session.openedAt === null ? "未开始" : "已结束";
  const bufferedCount = Math.max(0, logs.length - frozenLogs.length);

  return <Space direction="vertical" size={16} style={{ width: "100%" }}>
    <Alert type="info" showIcon message="远程串口由公网 TCP 网关转发" description="后台现在统一记录运行期会话、收发帧和字节统计。波特率、数据位、停止位和硬件校验仍由远端单片机固件决定。" />
    {project === undefined ? <Alert type="warning" showIcon message="请先创建并选择项目" description="选择项目后才能列出已经接入的设备。" /> : devices.length === 0 ? <Alert type="warning" showIcon message="当前项目还没有设备" description="设备至少成功上报一次后才会出现，并且需要保持 TCP 连接。" /> : null}
    {errorText.length > 0 ? <Alert type="error" showIcon closable message="远程串口操作失败" description={errorText} onClose={() => setErrorText("")} /> : null}

    <Card className="serial-session-card" title={<Space><CloudServerOutlined /><span>设备与调试会话</span><Tag color={currentStatus.color}>{currentStatus.label}</Tag></Space>} extra={status === "connected" ? <Button danger icon={<LinkOutlined />} onClick={() => void disconnect()}>关闭调试</Button> : <Button type="primary" icon={<LinkOutlined />} loading={status === "connecting"} disabled={selectionUnavailable || status === "disconnecting"} onClick={() => void connect()}>开启远程调试</Button>}>
      <Spin spinning={loadingState}>
        <Row gutter={[16, 12]} align="middle">
          <Col xs={24} sm={12} lg={6}><Typography.Text type="secondary" className="serial-field-label">当前项目</Typography.Text><Typography.Text code>{project?.name ?? "未选择"}</Typography.Text></Col>
          <Col xs={24} sm={12} lg={7}><Typography.Text type="secondary" className="serial-field-label">远程设备</Typography.Text><Select value={selectedDeviceId || undefined} options={deviceOptions} placeholder="选择已接入设备" disabled={status === "connected" || status === "connecting" || status === "disconnecting"} onChange={handleDeviceChange} style={{ width: "100%" }} aria-label="远程串口设备" /></Col>
          <Col xs={12} sm={6} lg={5}><Typography.Text type="secondary" className="serial-field-label">TCP 连接</Typography.Text><Space><Tag color={deviceOnline === true ? "green" : deviceOnline === false ? "red" : "default"}>{deviceOnline === true ? "设备在线" : deviceOnline === false ? "设备离线" : "等待检测"}</Tag><Button size="small" icon={<ReloadOutlined />} loading={checking} disabled={selectionUnavailable} onClick={() => void refreshConnection()}>检测</Button></Space></Col>
          <Col xs={12} sm={6} lg={6}><Typography.Text type="secondary" className="serial-field-label">实时事件</Typography.Text><Tag color={currentStreamStatus.color}>{currentStreamStatus.label}</Tag></Col>
        </Row>
        <div className="serial-session-strip" aria-label="远程串口会话统计">
          <div><Typography.Text type="secondary">会话时长</Typography.Text><strong>{runningDuration}</strong><small>{session.openedAt === null ? "等待开启" : `开始 ${formatTimestamp(session.openedAt)}`}</small></div>
          <div><Typography.Text type="secondary">发送 TX</Typography.Text><strong>{session.txFrames} 帧</strong><small>{formatByteSize(session.txBytes)}</small></div>
          <div><Typography.Text type="secondary">接收 RX</Typography.Text><strong>{session.rxFrames} 帧</strong><small>{formatByteSize(session.rxBytes)}</small></div>
          <div><Typography.Text type="secondary">服务器留存</Typography.Text><strong>{session.retainedEntries} 条</strong><small>每台设备最多 2000 条</small></div>
          <div><Typography.Text type="secondary">最后活动</Typography.Text><strong>{session.lastActivityAt === null ? "暂无" : formatTimestamp(session.lastActivityAt)}</strong><small>{session.active ? "会话进行中" : "会话未运行"}</small></div>
        </div>
      </Spin>
    </Card>

    <Row gutter={[16, 16]} align="stretch">
      <Col xs={24} xl={16}>
        <Card className="serial-log-card" title={<Space><span>收发监视器</span><Tag>{logs.length} / {logLimit}</Tag>{viewFrozen ? <Tag color="gold">视图已冻结{bufferedCount > 0 ? `，后台新增 ${bufferedCount}` : ""}</Tag> : null}</Space>} extra={<Space wrap>
          <Select<LogLimit> value={logLimit} onChange={setLogLimit} aria-label="服务器日志加载数量" style={{ width: 120 }} options={[{ value: 500, label: "最近 500 条" }, { value: 1000, label: "最近 1000 条" }, { value: 2000, label: "最近 2000 条" }]} />
          <Popconfirm title="清空服务器运行期串口日志？" description="所有浏览器看到的这台设备日志和统计都会归零。" okText="清空" cancelText="取消" onConfirm={() => void clearServerLogs()}><Button danger icon={<ClearOutlined />} disabled={session.retainedEntries === 0}>清空</Button></Popconfirm>
          <Space.Compact><Select<ExportFormat> value={exportFormat} onChange={setExportFormat} aria-label="日志导出格式" style={{ width: 82 }} options={[{ value: "txt", label: "TXT" }, { value: "csv", label: "CSV" }, { value: "json", label: "JSON" }]} /><Button icon={<DownloadOutlined />} disabled={filteredLogs.length === 0} onClick={exportLogs}>导出</Button></Space.Compact>
        </Space>} styles={{ body: { padding: 0 } }}>
          <div className="panel-toolbar serial-log-toolbar">
            <div className="panel-toolbar-main">
              <Input.Search value={logSearch} allowClear onChange={(event) => setLogSearch(event.target.value)} placeholder="搜索文本、HEX 或 Base64" aria-label="搜索远程串口日志" style={{ width: 300 }} />
              <Select<"all" | SerialDirection> value={logDirection} onChange={setLogDirection} aria-label="筛选串口日志方向" style={{ width: 132 }} options={[{ value: "all", label: "全部方向" }, { value: "RX", label: "仅接收 RX" }, { value: "TX", label: "仅发送 TX" }]} />
              <Segmented<SerialDisplayMode> value={receiveMode} options={[{ value: "text", label: "文本" }, { value: "hex", label: "HEX" }]} onChange={setReceiveMode} aria-label="日志显示格式" />
            </div>
            <Space wrap>
              <Typography.Text type="secondary">显示 {filteredLogs.length} / {visibleLogs.length}</Typography.Text>
              <Tooltip title="冻结只停止当前画面更新，服务端仍继续记录"><Space size={6}><PauseOutlined /><Typography.Text type="secondary">冻结视图</Typography.Text><Switch size="small" checked={viewFrozen} onChange={toggleFrozen} /></Space></Tooltip>
              <Space size={6}><Typography.Text type="secondary">时间戳</Typography.Text><Switch size="small" checked={showTimestamp} onChange={setShowTimestamp} /></Space>
              <Space size={6}><Typography.Text type="secondary">跟随底部</Typography.Text><Switch size="small" checked={autoScroll} onChange={setAutoScroll} /></Space>
            </Space>
          </div>
          <div ref={terminalRef} className="serial-terminal" role="log" aria-live={viewFrozen ? "off" : "polite"} aria-label="远程串口收发日志" tabIndex={0}>
            {filteredLogs.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span>{visibleLogs.length === 0 ? "暂无串口记录。开启调试并发送数据后会显示在这里。" : "没有匹配当前筛选条件的日志。"}</span>} /> : filteredLogs.map((entry) => <button type="button" key={entry.key} className={`serial-log-row serial-log-${entry.direction.toLowerCase()}`} onClick={() => setSelectedLog(entry)}><span className="serial-log-time">{showTimestamp ? formatTimestamp(entry.receivedAt) : ""}</span><span className="serial-log-direction">{entry.direction}</span><span className="serial-log-size">{entry.byteLength} B</span><code>{receiveMode === "hex" ? bytesToHex(entry.bytes) : entry.text}</code></button>)}
          </div>
        </Card>
      </Col>

      <Col xs={24} xl={8}>
        <Card className="serial-send-card" title="发送工作台" extra={<Tag color={sendPreview.bytes === null ? "default" : "blue"}>{sendPreview.bytes === null ? "等待有效帧" : `${sendPreview.bytes.byteLength} 字节`}</Tag>}>
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <Row gutter={[8, 8]}>
              <Col span={12}><Segmented<SerialDisplayMode> block value={sendMode} options={[{ value: "text", label: "文本" }, { value: "hex", label: "HEX" }]} onChange={setSendMode} aria-label="发送格式" /></Col>
              <Col span={12}><Select<LineEnding> value={lineEnding} disabled={sendMode === "hex"} onChange={setLineEnding} style={{ width: "100%" }} aria-label="文本行尾" options={[{ value: "none", label: "不追加行尾" }, { value: "cr", label: "追加 CR" }, { value: "lf", label: "追加 LF" }, { value: "crlf", label: "追加 CR+LF" }]} /></Col>
              <Col span={24}><Select<ChecksumMode> value={checksumMode} onChange={setChecksumMode} style={{ width: "100%" }} aria-label="发送帧校验" options={[...checksumOptions]} /></Col>
            </Row>
            <Input.TextArea value={sendValue} autoSize={{ minRows: 5, maxRows: 10 }} onChange={(event) => setSendValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendOnce(); } }} placeholder={sendMode === "hex" ? "例如 01 A0 FF，也支持 01A0FF" : "输入待发送文本，Enter 发送，Shift+Enter 换行"} aria-label="待发送远程串口数据" />
            <div className={`serial-frame-preview${sendPreview.bytes === null ? " is-invalid" : ""}`}>
              <div><Typography.Text type="secondary">最终帧预览</Typography.Text><Typography.Text type="secondary">{checksumOptions.find((option) => option.value === checksumMode)?.label}</Typography.Text></div>
              <code>{sendPreview.bytes === null ? sendPreview.error : bytesToHex(Array.from(sendPreview.bytes))}</code>
            </div>
            <Button type="primary" size="large" block icon={<SendOutlined />} loading={sending} disabled={status !== "connected" || cycleRunning || sendPreview.bytes === null} onClick={() => void sendOnce()}>发送当前帧</Button>

            <div className="serial-subsection">
              <div className="section-heading"><Typography.Title level={5}>周期发送</Typography.Title><Typography.Text type="secondary">{cycleRunning ? `${cycleSent} / ${repeatCount}` : "按固定间隔执行"}</Typography.Text></div>
              <Row gutter={[8, 8]}>
                <Col span={12}><Typography.Text type="secondary" className="serial-field-label">发送次数</Typography.Text><InputNumber min={1} max={100} value={repeatCount} onChange={(value) => setRepeatCount(value ?? 1)} disabled={cycleRunning} style={{ width: "100%" }} aria-label="周期发送次数" /></Col>
                <Col span={12}><Typography.Text type="secondary" className="serial-field-label">间隔毫秒</Typography.Text><InputNumber min={200} max={60000} step={100} value={repeatIntervalMs} onChange={(value) => setRepeatIntervalMs(value ?? 200)} disabled={cycleRunning} style={{ width: "100%" }} aria-label="周期发送间隔毫秒" /></Col>
              </Row>
              {cycleRunning ? <Button danger block icon={<PauseOutlined />} onClick={stopCycle}>停止周期发送</Button> : <Button block icon={<PlayCircleOutlined />} disabled={status !== "connected" || sending || sendPreview.bytes === null} onClick={() => void startCycle()}>开始周期发送</Button>}
            </div>

            <div className="serial-subsection">
              <div className="section-heading"><Typography.Title level={5}>快捷指令</Typography.Title><Typography.Text type="secondary">保存在当前浏览器</Typography.Text></div>
              <Space.Compact style={{ width: "100%" }}><Select value={selectedPresetId} placeholder="选择快捷指令" allowClear onChange={(id) => { setSelectedPresetId(id); const preset = presets.find((item) => item.id === id); if (preset !== undefined) applySendConfiguration(preset); }} style={{ flex: 1 }} options={presets.map((preset) => ({ value: preset.id, label: preset.name }))} aria-label="选择串口快捷指令" /><Tooltip title="删除选中的快捷指令"><Button danger icon={<DeleteOutlined />} disabled={selectedPresetId === undefined} onClick={deletePreset} aria-label="删除快捷指令" /></Tooltip></Space.Compact>
              <Space.Compact style={{ width: "100%" }}><Input value={presetName} maxLength={40} onChange={(event) => setPresetName(event.target.value)} placeholder="输入名称后保存当前帧" aria-label="快捷指令名称" /><Button icon={<SaveOutlined />} disabled={sendPreview.bytes === null} onClick={savePreset}>保存</Button></Space.Compact>
            </div>

            <div className="serial-subsection">
              <div className="section-heading"><Typography.Title level={5}>发送历史</Typography.Title><Typography.Text type="secondary">最近 20 条配置</Typography.Text></div>
              <Select placeholder="选择历史帧重新载入" value={undefined} onChange={(id) => { const entry = sendHistory.find((item) => item.id === id); if (entry !== undefined) applySendConfiguration(entry); }} style={{ width: "100%" }} options={sendHistory.map((entry) => ({ value: entry.id, label: `${formatTimestamp(entry.sentAt)}  ${entry.byteLength} B  ${entry.value.slice(0, 28) || "仅行尾"}` }))} suffixIcon={<HistoryOutlined />} aria-label="串口发送历史" />
            </div>
          </Space>
        </Card>
      </Col>
    </Row>

    <Drawer title="串口帧详情" open={selectedLog !== null} width={520} onClose={() => setSelectedLog(null)}>
      {selectedLog === null ? null : <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Descriptions column={1} size="small" bordered items={[
          { key: "direction", label: "方向", children: <Tag color={selectedLog.direction === "TX" ? "blue" : "green"}>{selectedLog.direction}</Tag> },
          { key: "time", label: "时间", children: new Date(selectedLog.receivedAt).toLocaleString("zh-CN", { hour12: false }) },
          { key: "length", label: "长度", children: `${selectedLog.byteLength} 字节` },
          { key: "device", label: "设备", children: selectedLog.deviceId }
        ]} />
        <div><div className="section-heading"><Typography.Title level={5}>文本</Typography.Title><Button size="small" icon={<CopyOutlined />} onClick={() => void navigator.clipboard.writeText(selectedLog.text)}>复制</Button></div><Input.TextArea readOnly value={selectedLog.text} autoSize={{ minRows: 3, maxRows: 10 }} /></div>
        <div><div className="section-heading"><Typography.Title level={5}>HEX</Typography.Title><Button size="small" icon={<CopyOutlined />} onClick={() => void navigator.clipboard.writeText(bytesToHex(selectedLog.bytes))}>复制</Button></div><Input.TextArea readOnly value={bytesToHex(selectedLog.bytes)} autoSize={{ minRows: 3, maxRows: 10 }} /></div>
        <div><div className="section-heading"><Typography.Title level={5}>Base64</Typography.Title><Button size="small" icon={<CopyOutlined />} onClick={() => void navigator.clipboard.writeText(selectedLog.data)}>复制</Button></div><Input.TextArea readOnly value={selectedLog.data} autoSize={{ minRows: 2, maxRows: 8 }} /></div>
      </Space>}
    </Drawer>
  </Space>;
};
