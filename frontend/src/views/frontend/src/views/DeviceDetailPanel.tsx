import { Button, Descriptions, Divider, Drawer, Space, Switch, Tag, Typography, message } from "antd";
import { useEffect, useRef, useState } from "react";
import type { DeviceCommand, DeviceRecord, JsonObject, ProbeResult } from "../types";
import { isOnline, relativeTime } from "./DevicesPanel";

export type DeviceDetailPanelProps = {
  readonly device: DeviceRecord | null;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSend: (deviceId: string, name: string, payload: JsonObject) => Promise<DeviceCommand>;
  readonly onNavigateCommands: () => void;
  readonly onNavigateReport: () => void;
  readonly onProbe: (deviceId: string) => Promise<ProbeResult>;
};

const relayStateText = (state: "on" | "off"): string => state === "on" ? "开启" : "关闭";
const probeTransportText = (transport: ProbeResult["transport"]): string => {
  if (transport === "tcp") return "TCP";
  if (transport === "mqtt") return "MQTT";
  if (transport === "both") return "TCP 和 MQTT";
  return "未知通道";
};

export const DeviceDetailPanel = ({ device, open, onClose, onSend, onNavigateCommands, onNavigateReport, onProbe }: DeviceDetailPanelProps): JSX.Element => {
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [pendingRelayKeys, setPendingRelayKeys] = useState<ReadonlySet<string>>(new Set());
  const probeRequestSequenceRef = useRef(0);
  const deviceIdentity = device === null ? "" : `${device.projectId}\u0000${device.deviceId}`;
  useEffect(() => {
    probeRequestSequenceRef.current += 1;
    setProbe(null);
    setProbing(false);
    setPendingRelayKeys(new Set());
  }, [deviceIdentity]);
  if (device === null) return <Drawer open={false} onClose={onClose} />;
  const online = isOnline(device.lastSeenAt, device.activityConfirmed, device.simulated === true);
  const sendRelay = async (key: string, checked: boolean): Promise<void> => {
    if (pendingRelayKeys.has(key)) return;
    setPendingRelayKeys((current) => new Set(current).add(key));
    try {
      await onSend(device.deviceId, "set_relays", { relays: [{ key, state: checked ? "on" : "off" }] });
      message.success(`已为 ${key} 创建继电器命令，请等待设备确认。`);
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : "创建继电器命令失败。");
    } finally {
      setPendingRelayKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };
  const probeDevice = async (): Promise<void> => {
    const requestSequence = ++probeRequestSequenceRef.current;
    setProbing(true);
    try {
      const result = await onProbe(device.deviceId);
      if (probeRequestSequenceRef.current === requestSequence) setProbe(result);
    } catch (error: unknown) {
      if (probeRequestSequenceRef.current === requestSequence) message.error(error instanceof Error ? error.message : "探测失败。");
    } finally {
      if (probeRequestSequenceRef.current === requestSequence) setProbing(false);
    }
  };
  return <Drawer
    title={<Space wrap><span>设备详情</span><Typography.Text code>{device.deviceId}</Typography.Text><Tag color={online ? "green" : "default"}>{online ? "在线" : "离线"}</Tag></Space>}
    open={open}
    width={720}
    onClose={onClose}
    styles={{ body: { paddingBottom: 96 } }}
    footer={<Space wrap style={{ justifyContent: "flex-end", width: "100%" }}><Button onClick={onClose}>关闭</Button><Button onClick={onNavigateReport}>调试上报</Button><Button type="primary" onClick={onNavigateCommands}>前往命令控制</Button></Space>}
  >
    <Typography.Title level={5} style={{ marginTop: 0 }}>基本信息</Typography.Title>
    <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }} items={[
      { key: "device", label: "设备 ID", children: <Typography.Text code copyable={{ text: device.deviceId }}>{device.deviceId}</Typography.Text> },
      { key: "project", label: "项目 ID", children: <Typography.Text code>{device.projectId}</Typography.Text> },
      { key: "created", label: "首次接入", children: new Date(device.createdAt).toLocaleString() },
      { key: "seen", label: "最后活动", children: device.activityConfirmed ? <>{new Date(device.lastSeenAt).toLocaleString()}（{relativeTime(device.lastSeenAt)}）</> : "尚未通信" },
      { key: "status", label: "连接状态", children: <Tag color={online ? "green" : "default"}>{online ? "在线" : "离线"}</Tag> },
      { key: "source", label: "数据来源", children: <Tag color={device.simulated === true ? "orange" : "blue"}>{device.simulated === true ? "模拟数据" : "设备上报"}</Tag> }
    ]} />
    <Divider />
    <div className="section-heading"><Typography.Title level={5}>连通性</Typography.Title><Button loading={probing} onClick={() => void probeDevice()}>立即探测</Button></div>
    {probe === null ? <Typography.Text type="secondary">尚未执行主动探测。</Typography.Text> : <Tag color={probe.reachable ? "green" : "red"}>{probe.reachable ? `设备可达，延迟 ${probe.latencyMs ?? 0} 毫秒，通道 ${probeTransportText(probe.transport)}` : "设备不可达"}</Tag>}
    <Divider />
    <Typography.Title level={5}>采集数据</Typography.Title>
    {device.lastReport.values.length === 0 ? <Typography.Text type="secondary">暂无采集数据</Typography.Text> : <Descriptions size="small" column={1} items={device.lastReport.values.map((item) => ({ key: item.key, label: item.key, children: `${item.value}${item.unit}` }))} />}
    <Divider />
    <Typography.Title level={5}>继电器控制</Typography.Title>
    <Typography.Paragraph type="secondary">切换开关会创建命令；最终状态以设备下一次上报为准。</Typography.Paragraph>
    {device.lastReport.relays.length === 0 ? <Typography.Text type="secondary">暂无继电器数据</Typography.Text> : device.lastReport.relays.map((relay) => <div className="device-relay-row" key={relay.key}><Space><Typography.Text code>{relay.key}</Typography.Text><Tag color={relay.state === "on" ? "green" : "default"}>{relayStateText(relay.state)}</Tag></Space><Switch checked={relay.state === "on"} checkedChildren="开" unCheckedChildren="关" loading={pendingRelayKeys.has(relay.key)} disabled={pendingRelayKeys.has(relay.key)} aria-label={`将继电器 ${relay.key} 切换为${relay.state === "on" ? "关闭" : "开启"}`} onChange={(checked) => void sendRelay(relay.key, checked)} /></div>)}
    <Divider />
    <Typography.Title level={5}>报警状态</Typography.Title>
    <Space wrap>{device.lastReport.alarms.length === 0 ? <Typography.Text type="secondary">暂无报警数据</Typography.Text> : device.lastReport.alarms.map((alarm) => <Tag key={alarm.key} color={alarm.active ? "red" : "green"}>{alarm.key}：{alarm.active ? "活跃" : "正常"}</Tag>)}</Space>
  </Drawer>;
};
