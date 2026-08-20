import { SendOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input, message } from "antd";
import { useState } from "react";
import type { DeviceCommand, DeviceRecord, JsonObject } from "../types";
import { DeviceSelect } from "./DeviceSelect";

export type CustomCommandPanelProps = {
  readonly devices: readonly DeviceRecord[];
  readonly selectedDeviceId: string;
  readonly onSelectDevice: (deviceId: string) => void;
  readonly onSend: (deviceId: string, name: string, payload: JsonObject) => Promise<DeviceCommand>;
  readonly onOutput: (value: unknown) => void;
};

const parseObject = (text: string): JsonObject => {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("命令参数必须是 JSON 对象。");
  return parsed as JsonObject;
};

export const CustomCommandPanel = ({ devices, selectedDeviceId, onSelectDevice, onSend, onOutput }: CustomCommandPanelProps): JSX.Element => {
  const [name, setName] = useState("");
  const [payload, setPayload] = useState('{\n  "key": "value"\n}');
  const [jsonError, setJsonError] = useState("");
  const [pending, setPending] = useState(false);
  const validate = (): boolean => {
    try { parseObject(payload); setJsonError(""); return true; } catch (error: unknown) { setJsonError(error instanceof Error ? error.message : "JSON 格式无效。"); return false; }
  };
  const submit = async (): Promise<void> => {
    if (!validate()) return;
    if (selectedDeviceId.trim().length === 0 || name.trim().length === 0) { message.error("请先选择设备并输入命令名。"); return; }
    setPending(true);
    try {
      const command = await onSend(selectedDeviceId.trim(), name.trim(), parseObject(payload));
      onOutput({ ok: true, data: command, notice: `命令已入队，命令 ID：${command.id}` });
      message.success("自定义命令已入队");
    } finally { setPending(false); }
  };
  return <Card title="自定义命令"><Form layout="vertical" onFinish={() => void submit()}>
    <Form.Item label="设备 ID"><DeviceSelect devices={devices} value={selectedDeviceId} onChange={onSelectDevice} ariaLabel="自定义命令目标设备" /></Form.Item>
    <Form.Item label="命令名"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="set_mode" /></Form.Item>
    <Form.Item label="命令参数（JSON）" validateStatus={jsonError ? "error" : ""} help={jsonError || undefined}><Input.TextArea rows={6} value={payload} onChange={(event) => setPayload(event.target.value)} onBlur={validate} /></Form.Item>
    <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={pending}>发送自定义命令</Button>
  </Form></Card>;
};
