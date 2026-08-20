import { Space, Tabs, Typography } from "antd";
import { useEffect, useState } from "react";
import type { CommandTimelineItem } from "../hooks/useCommandTimeline";
import type { BatchDeviceCommandResult, DeviceCommand, DeviceRecord, JsonObject } from "../types";
import { CommandPanel } from "./CommandPanel";
import { CommandHistoryPanel } from "./CommandHistoryPanel";
import { CustomCommandPanel } from "./CustomCommandPanel";
import { ReportPanel, type ReportInput } from "./ReportPanel";

type CommandPanelKey = "relays" | "custom" | "report";
const commandPanelKeys: readonly CommandPanelKey[] = ["relays", "custom", "report"];
const isCommandPanelKey = (value: string): value is CommandPanelKey => commandPanelKeys.includes(value as CommandPanelKey);

export type CommandsTabProps = {
  readonly devices: readonly DeviceRecord[];
  readonly selectedDeviceId: string;
  readonly timeline: readonly CommandTimelineItem[];
  readonly onSelectDevice: (deviceId: string) => void;
  readonly onSend: (deviceId: string, name: string, payload: JsonObject) => Promise<DeviceCommand>;
  readonly onSendBatch: (deviceIds: readonly string[], name: string, payload: JsonObject) => Promise<BatchDeviceCommandResult>;
  readonly onReport: (input: ReportInput) => Promise<DeviceRecord>;
  readonly onBatchReport: (reports: readonly ReportInput[]) => Promise<readonly DeviceRecord[]>;
  readonly onImport: (devices: readonly ReportInput[]) => Promise<readonly DeviceRecord[]>;
  readonly onOutput: (value: unknown) => void;
  readonly requestedPanel: CommandPanelKey;
};

export const CommandsTab = ({ devices, selectedDeviceId, timeline, onSelectDevice, onSend, onSendBatch, onReport, onBatchReport, onImport, onOutput, requestedPanel }: CommandsTabProps): JSX.Element => {
  const [activeKey, setActiveKey] = useState(requestedPanel);
  useEffect(() => setActiveKey(requestedPanel), [requestedPanel]);
  const changePanel = (key: string): void => {
    if (isCommandPanelKey(key)) setActiveKey(key);
  };
  return <Space direction="vertical" size="middle" style={{ display: "flex" }}>
    <div><Typography.Title level={5} style={{ margin: 0 }}>创建命令</Typography.Title><Typography.Text type="secondary">按业务目标选择控制方式，命令创建后可在下方统一搜索和跟踪。</Typography.Text></div>
    <Tabs activeKey={activeKey} onChange={changePanel} items={[
      { key: "relays", label: "继电器批量控制", children: <CommandPanel devices={devices} selectedDeviceId={selectedDeviceId} onSendBatch={onSendBatch} onOutput={onOutput} /> },
      { key: "custom", label: "单设备自定义命令", children: <CustomCommandPanel devices={devices} selectedDeviceId={selectedDeviceId} onSelectDevice={onSelectDevice} onSend={onSend} onOutput={onOutput} /> },
      { key: "report", label: "设备接入调试", children: <ReportPanel devices={devices} selectedDeviceId={selectedDeviceId} onSelectDevice={onSelectDevice} onReport={onReport} onBatchReport={onBatchReport} onImport={onImport} onOutput={onOutput} /> }
    ]} />
    <CommandHistoryPanel items={timeline} />
  </Space>;
};
