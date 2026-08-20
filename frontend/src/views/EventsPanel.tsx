import { DownloadOutlined } from "@ant-design/icons";
import { Button, Card, Input, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import { createTablePagination } from "../tablePagination";
import { eventNames, type EventName } from "../types";

export type DashboardEvent = {
  readonly id: string;
  readonly name: EventName;
  readonly receivedAt: string;
  readonly payload: unknown;
};
export type EventsPanelProps = { readonly events: readonly DashboardEvent[] };

export type EventsPanelControls = EventsPanelProps & {
  readonly paused: boolean;
  readonly onPausedChange: (paused: boolean) => void;
  readonly onClear: () => void;
};

export const eventColor: Readonly<Record<EventName, string>> = {
  connected: "blue",
  device_report: "cyan",
  command_queued: "gold",
  command_acked: "green",
  command_expired: "red",
  device_verified: "purple",
  device_online: "green",
  device_offline: "default",
  rule_triggered: "volcano",
  shadow_updated: "blue",
  firmware_progress: "geekblue",
  forwarder_delivery: "lime",
  alarm_triggered: "red"
};
export const eventLabels: Readonly<Record<EventName, string>> = {
  connected: "事件流已连接",
  device_report: "设备上报",
  command_queued: "命令入队",
  command_acked: "命令确认",
  command_expired: "命令过期",
  device_verified: "设备验证",
  device_online: "设备上线",
  device_offline: "设备离线",
  rule_triggered: "规则触发",
  shadow_updated: "设备影子更新",
  firmware_progress: "固件进度",
  forwarder_delivery: "转发结果",
  alarm_triggered: "报警触发"
};
const serverEventNames = eventNames.filter((name): name is Exclude<EventName, "connected"> => name !== "connected");
const readObject = (value: unknown): object | null => typeof value === "object" && value !== null ? value : null;
const readNestedObject = (value: object, key: string): object | null => key in value ? readObject(value[key as keyof typeof value]) : null;
const readString = (value: object, key: string): string | null => key in value && typeof value[key as keyof typeof value] === "string" ? value[key as keyof typeof value] as string : null;
export const eventTarget = (event: DashboardEvent): { readonly projectId: string; readonly deviceId: string; readonly label: string } => {
  const payload = readObject(event.payload);
  if (payload === null) return { projectId: "-", deviceId: "-", label: eventLabels[event.name] };
  const candidate = ["device", "command", "verify", "shadow", "ota", "rule"]
    .map((key) => readNestedObject(payload, key))
    .find((value): value is object => value !== null) ?? payload;
  const projectId = readString(candidate, "projectId") ?? readString(payload, "projectId") ?? "-";
  const deviceId = readString(candidate, "deviceId") ?? readString(payload, "deviceId") ?? "-";
  const commandName = readString(candidate, "name");
  const alarmKey = readString(payload, "alarmKey");
  const deliveryStatus = readString(payload, "status");
  const label = commandName !== null && (event.name === "command_queued" || event.name === "command_acked" || event.name === "command_expired")
    ? `命令：${commandName}`
    : alarmKey !== null ? `报警：${alarmKey}`
      : event.name === "forwarder_delivery" && deliveryStatus !== null ? `转发：${deliveryStatus}`
        : eventLabels[event.name];
  return {
    projectId,
    deviceId,
    label
  };
};

export const EventsPanel = ({ events, paused, onPausedChange, onClear }: EventsPanelControls): JSX.Element => {
  const [names, setNames] = useState<readonly EventName[]>(serverEventNames);
  const [search, setSearch] = useState("");
  const filteredEvents = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    return events.filter((event) => {
      if (!names.includes(event.name)) return false;
      if (query.length === 0) return true;
      const target = eventTarget(event);
      return `${eventLabels[event.name]}\n${target.projectId}\n${target.deviceId}\n${target.label}`.toLocaleLowerCase("zh-CN").includes(query);
    });
  }, [events, names, search]);
  const exportEvents = (): void => {
    const content = JSON.stringify(filteredEvents, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `实时事件-${new Date().toISOString().replaceAll(":", "-")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return <Card title={<Space><span>实时事件</span><Tag color={paused ? "orange" : "green"}>{paused ? "已暂停入列" : "正在接收"}</Tag></Space>} extra={<Typography.Text type="secondary">页面会话最多保留 100 条</Typography.Text>}>
  <div className="panel-toolbar">
    <div className="panel-toolbar-main">
    <Input.Search value={search} onChange={(event) => setSearch(event.target.value)} allowClear placeholder="搜索项目、设备或事件摘要" aria-label="搜索实时事件" style={{ width: "clamp(220px, 70vw, 360px)" }} />
    <Select mode="multiple" showSearch optionFilterProp="label" value={[...names]} style={{ width: "clamp(180px, 70vw, 420px)" }} placeholder="筛选事件类型" onChange={(next: EventName[]) => setNames(next)} options={serverEventNames.map((name) => ({ value: name, label: eventLabels[name] }))} aria-label="筛选事件类型" />
    {search.length > 0 || names.length !== serverEventNames.length ? <Button onClick={() => { setSearch(""); setNames(serverEventNames); }}>重置筛选</Button> : null}
    </div>
    <Space wrap>
    <Switch checked={paused} onChange={onPausedChange} checkedChildren="已暂停" unCheckedChildren="接收中" aria-label="暂停事件入列" />
    <Button icon={<DownloadOutlined />} disabled={filteredEvents.length === 0} onClick={exportEvents}>导出</Button>
    <Popconfirm title="清空本次页面会话事件？" description="只清空浏览器当前记录，不会删除服务器业务数据。" okText="确认清空" cancelText="取消" onConfirm={onClear}><Button disabled={events.length === 0}>清空</Button></Popconfirm>
    <Typography.Text type="secondary">显示 {filteredEvents.length} / {events.length}</Typography.Text>
    </Space>
  </div>
  <Table<DashboardEvent> rowKey="id" size="small" pagination={createTablePagination(20)} scroll={{ x: 840 }} dataSource={filteredEvents} expandable={{ expandedRowRender: (event) => <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflow: "auto" }}>{JSON.stringify(event.payload, null, 2)}</pre> }} locale={{ emptyText: events.length === 0 ? "选择项目后将显示实时事件。" : "没有匹配的实时事件。" }} columns={[
    { title: "时间", dataIndex: "receivedAt", render: (value: string) => new Date(value).toLocaleTimeString() },
    { title: "事件", dataIndex: "name", render: (value: EventName) => <Tag color={eventColor[value]}>{eventLabels[value]}</Tag> },
    { title: "项目", render: (_, event) => <Typography.Text code>{eventTarget(event).projectId}</Typography.Text> },
    { title: "设备", render: (_, event) => <Typography.Text code>{eventTarget(event).deviceId}</Typography.Text> },
    { title: "摘要", render: (_, event) => eventTarget(event).label },
    { title: "操作", render: () => "展开查看原始数据" }
  ]} />
</Card>;
};
