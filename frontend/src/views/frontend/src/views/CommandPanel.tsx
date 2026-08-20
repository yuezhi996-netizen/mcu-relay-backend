import { SendOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input, Select, Space, Typography, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { BatchDeviceCommandResult, DeviceRecord, JsonObject, RelayOutput } from "../types";

export type CommandPanelProps = {
  readonly devices: readonly DeviceRecord[];
  readonly selectedDeviceId: string;
  readonly onSendBatch: (deviceIds: readonly string[], name: string, payload: JsonObject) => Promise<BatchDeviceCommandResult>;
  readonly onOutput: (value: unknown) => void;
};

const parseRelayList = (text: string): readonly RelayOutput[] => {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("继电器命令必须是 JSON 数组。");
  return parsed.map((item: unknown, index: number): RelayOutput => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error(`第 ${index + 1} 项必须是对象。`);
    const key = "key" in item ? item.key : undefined;
    const state = "state" in item ? item.state : undefined;
    if (typeof key !== "string" || key.trim().length === 0) throw new Error(`第 ${index + 1} 项的 key 必须是非空字符串。`);
    if (state !== "on" && state !== "off") throw new Error(`第 ${index + 1} 项的 state 只能是 on（开启）或 off（关闭）。`);
    return { key: key.trim(), state };
  });
};

export const CommandPanel = ({ devices, selectedDeviceId, onSendBatch, onOutput }: CommandPanelProps): JSX.Element => {
  const [targetDeviceIds, setTargetDeviceIds] = useState<readonly string[]>(selectedDeviceId.length === 0 ? [] : [selectedDeviceId]);
  const [relays, setRelays] = useState('[\n  {"key":"relay1","state":"on"},\n  {"key":"relay2","state":"off"}\n]');
  const [jsonError, setJsonError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => setTargetDeviceIds(selectedDeviceId.length === 0 ? [] : [selectedDeviceId]), [selectedDeviceId]);
  const deviceOptions = useMemo(() => devices.map((device) => ({ value: device.deviceId, label: device.deviceId })), [devices]);
  const validate = (): boolean => {
    try { parseRelayList(relays); setJsonError(""); return true; } catch (error: unknown) { setJsonError(error instanceof Error ? error.message : "JSON 格式无效。"); return false; }
  };
  const currentDevice = devices.find((device) => device.deviceId === targetDeviceIds[0]);
  const applyShortcut = (state: "current" | "on" | "off"): void => {
    if (currentDevice === undefined || currentDevice.lastReport.relays.length === 0) {
      message.error("请先从设备列表选择一个含继电器状态的设备。");
      return;
    }
    const next = state === "current" ? currentDevice.lastReport.relays : currentDevice.lastReport.relays.map((relay) => ({ key: relay.key, state }));
    setRelays(JSON.stringify(next, null, 2));
    setJsonError("");
  };
  const submit = async (): Promise<void> => {
    if (!validate()) return;
    if (targetDeviceIds.length === 0) { message.error("请至少选择一台目标设备。"); return; }
    setPending(true);
    try {
      const result = await onSendBatch(targetDeviceIds, "set_relays", { relays: parseRelayList(relays) });
      const notice = `已为 ${result.count} 台设备生成命令，实时推送 ${result.dispatched} 台，离线排队 ${result.queuedOffline} 台`;
      onOutput({ ok: true, data: result, notice });
      message.success(notice);
    } finally { setPending(false); }
  };
  return (
    <Card title="继电器批量控制">
      <Form layout="vertical" onFinish={() => void submit()}>
        <Form.Item label="目标设备" extra={`已选择 ${targetDeviceIds.length} 台，最多 50 台；每台设备都会生成独立命令并分别等待确认。`}>
          <Select mode="multiple" showSearch allowClear maxCount={50} maxTagCount={4} maxTagPlaceholder={(omitted) => `另有 ${omitted.length} 台`} value={[...targetDeviceIds]} options={deviceOptions} optionFilterProp="label" placeholder="搜索并选择目标设备" style={{ width: "100%", maxWidth: 720 }} onChange={(next: string[]) => setTargetDeviceIds(next)} aria-label="选择继电器命令目标设备" />
        </Form.Item>
        <Form.Item label="继电器命令 JSON" validateStatus={jsonError ? "error" : ""} help={jsonError || undefined}>
          <Input.TextArea rows={7} value={relays} onChange={(event) => setRelays(event.target.value)} onBlur={validate} />
        </Form.Item>
        <Space wrap>
          <Button onClick={() => applyShortcut("current")}>从设备当前状态生成</Button>
          <Button onClick={() => applyShortcut("on")}>全部开</Button>
          <Button onClick={() => applyShortcut("off")}>全部关</Button>
          <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={pending} disabled={targetDeviceIds.length === 0}>{targetDeviceIds.length > 1 ? `批量下发（${targetDeviceIds.length} 台）` : "下发继电器命令"}</Button>
        </Space>
      </Form>
      <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>后台会立即尝试推送到在线设备；未实时送达的命令进入离线队列，并在 5 分钟后主动标记为过期。</Typography.Paragraph>
    </Card>
  );
};
