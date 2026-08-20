import { CloudUploadOutlined } from "@ant-design/icons";
import { Button, Card, Divider, Form, Input, Table, message } from "antd";
import { useState } from "react";
import type { AlarmState, DeviceRecord, DeviceValue, RelayOutput } from "../types";
import { DeviceIdInput } from "./DeviceIdInput";

export type ReportInput = {
  readonly deviceId: string;
  readonly values: readonly DeviceValue[];
  readonly relays: readonly RelayOutput[];
  readonly alarms: readonly AlarmState[];
};
export type ReportPanelProps = {
  readonly devices: readonly DeviceRecord[];
  readonly selectedDeviceId: string;
  readonly onSelectDevice: (deviceId: string) => void;
  readonly onReport: (input: ReportInput) => Promise<DeviceRecord>;
  readonly onBatchReport: (reports: readonly ReportInput[]) => Promise<readonly DeviceRecord[]>;
  readonly onImport: (devices: readonly ReportInput[]) => Promise<readonly DeviceRecord[]>;
  readonly onOutput: (value: unknown) => void;
};

const parseArray = <T,>(text: string, label: string): readonly T[] => {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error(`${label} 必须是 JSON 数组。`);
  return parsed as readonly T[];
};

export const ReportPanel = ({ devices, selectedDeviceId, onSelectDevice, onReport, onBatchReport, onImport, onOutput }: ReportPanelProps): JSX.Element => {
  const [values, setValues] = useState('[\n  {"key":"value1","value":1,"unit":""}\n]');
  const [relays, setRelays] = useState('[\n  {"key":"relay1","state":"off"}\n]');
  const [alarms, setAlarms] = useState('[\n  {"key":"alarm1","active":false}\n]');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [pending, setPending] = useState(false);
  const [batchReports, setBatchReports] = useState("[\n  {\"deviceId\":\"device002\",\"values\":[{\"key\":\"temp\",\"value\":25,\"unit\":\"C\"}],\"relays\":[],\"alarms\":[]}\n]");
  const [importDevices, setImportDevices] = useState("[\n  {\"deviceId\":\"device003\"}\n]");
  const validate = (key: string, text: string, label: string): boolean => {
    try { parseArray<unknown>(text, label); setErrors((current) => ({ ...current, [key]: "" })); return true; } catch (error: unknown) { setErrors((current) => ({ ...current, [key]: error instanceof Error ? error.message : "JSON 格式无效。" })); return false; }
  };
  const submitImport = async (): Promise<void> => {
    if (!validate("import", importDevices, "批量导入")) return;
    setPending(true);
    try {
      const imported = await onImport(parseArray<ReportInput>(importDevices, "批量导入"));
      onOutput({ ok: true, data: { count: imported.length, devices: imported } });
      message.success(`已导入 ${imported.length} 台设备`);
    } finally { setPending(false); }
  };
  const preview = (() => { try { return parseArray<ReportInput>(importDevices, "批量导入"); } catch { return []; } })();
  const submitBatch = async (): Promise<void> => {
    if (!validate("batch", batchReports, "批量上报")) return;
    setPending(true);
    try {
      const records = parseArray<ReportInput>(batchReports, "批量上报");
      const devicesResult = await onBatchReport(records);
      onOutput({ ok: true, data: { count: devicesResult.length, devices: devicesResult } });
      message.success(`已批量上报 ${devicesResult.length} 台设备`);
    } finally { setPending(false); }
  };
  const submit = async (): Promise<void> => {
    const valid = validate("values", values, "单片机数据") && validate("relays", relays, "继电器状态") && validate("alarms", alarms, "报警状态");
    if (!valid) return;
    if (selectedDeviceId.trim().length === 0) { message.error("请先选择或输入设备 ID。"); return; }
    setPending(true);
    try {
      const device = await onReport({ deviceId: selectedDeviceId.trim(), values: parseArray<DeviceValue>(values, "单片机数据"), relays: parseArray<RelayOutput>(relays, "继电器状态"), alarms: parseArray<AlarmState>(alarms, "报警状态") });
      onOutput({ ok: true, data: device });
      message.success("模拟上报成功");
    } finally { setPending(false); }
  };
  const field = (label: string, key: string, value: string, setValue: (next: string) => void): JSX.Element => <Form.Item label={label} validateStatus={errors[key] ? "error" : ""} help={errors[key] || undefined}><Input.TextArea rows={5} value={value} onChange={(event) => setValue(event.target.value)} onBlur={() => validate(key, value, label)} /></Form.Item>;
  return <Card title="接入调试上报"><Form layout="vertical" onFinish={() => void submit()}>
    <Form.Item label="设备 ID"><DeviceIdInput devices={devices} value={selectedDeviceId} onChange={onSelectDevice} ariaLabel="调试上报设备 ID" /></Form.Item>
    {field("单片机数据 JSON", "values", values, setValues)}
    {field("继电器状态 JSON", "relays", relays, setRelays)}
    {field("报警状态 JSON", "alarms", alarms, setAlarms)}
    <Button type="primary" htmlType="submit" icon={<CloudUploadOutlined />} loading={pending}>模拟上报</Button>
    <Divider />
    <Form.Item label="批量上报 JSON" validateStatus={errors.batch ? "error" : ""} help={errors.batch || "输入 [{deviceId, values, relays, alarms}, ...]，最多 50 条。"}><Input.TextArea rows={7} value={batchReports} onChange={(event) => setBatchReports(event.target.value)} onBlur={() => validate("batch", batchReports, "批量上报")} /></Form.Item>
    <Button onClick={() => void submitBatch()} loading={pending}>提交批量上报</Button>
    <Divider />
    <Form.Item label="批量导入 JSON" validateStatus={errors.import ? "error" : ""} help={errors.import || "输入 [{deviceId, values?, relays?, alarms?}, ...]，最多 100 条。"}><Input.TextArea rows={6} value={importDevices} onChange={(event) => setImportDevices(event.target.value)} onBlur={() => validate("import", importDevices, "批量导入")} /></Form.Item>
    <Table<ReportInput> size="small" pagination={false} rowKey="deviceId" style={{ marginBottom: 12 }} dataSource={preview} locale={{ emptyText: "输入合法 JSON 后显示导入预览。" }} columns={[{ title: "将导入的设备 ID", dataIndex: "deviceId" }]} />
    <Button onClick={() => void submitImport()} loading={pending}>提交批量导入</Button>
  </Form></Card>;
};
