import { ControlOutlined, ReloadOutlined } from "@ant-design/icons";
import { Badge, Button, Card, Col, Descriptions, Input, Row, Select, Space, Statistic, Table, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import { createTablePagination } from "../tablePagination";
import type { DeviceRecord } from "../types";

export type DevicesPanelProps = {
  readonly devices: readonly DeviceRecord[];
  readonly onControl: (deviceId: string) => void;
  readonly onRefresh: () => void;
};

export const isOnline = (lastSeenAt: string, activityConfirmed: boolean, simulated: boolean): boolean => {
  if (!activityConfirmed || simulated) return false;
  const timestamp = new Date(lastSeenAt).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp <= 15_000;
};
export const relativeTime = (time: string): string => {
  const elapsed = Date.now() - new Date(time).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "时间未知";
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1000)} 秒前`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  return `${Math.floor(elapsed / 3_600_000)} 小时前`;
};

const previewTags = (items: readonly JSX.Element[]): JSX.Element => <Space wrap>{items.length === 0 ? <Tag>无数据</Tag> : <>{items.slice(0, 3)}{items.length > 3 ? <Tag>+{items.length - 3}</Tag> : null}</>}</Space>;
const relayStateText = (state: "on" | "off"): string => state === "on" ? "开启" : "关闭";
type DeviceFilter = "all" | "online" | "offline" | "relay_on" | "relay_off" | "alarm_active" | "alarm_normal";

export const DevicesPanel = ({ devices, onControl, onRefresh }: DevicesPanelProps): JSX.Element => {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<DeviceFilter>("all");
  const [expandedKeys, setExpandedKeys] = useState<readonly React.Key[]>([]);
  const summary = useMemo(() => ({
    online: devices.filter((device) => isOnline(device.lastSeenAt, device.activityConfirmed, device.simulated === true)).length,
    alarms: devices.filter((device) => device.lastReport.alarms.some((alarm) => alarm.active)).length,
    relayOn: devices.filter((device) => device.lastReport.relays.some((relay) => relay.state === "on")).length
  }), [devices]);
  const filteredDevices = useMemo(() => devices.filter((device) => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    const dataKeys = [...device.lastReport.values, ...device.lastReport.relays, ...device.lastReport.alarms].map((item) => item.key.toLocaleLowerCase("zh-CN"));
    const matchesSearch = query.length === 0 || device.deviceId.toLocaleLowerCase("zh-CN").includes(query) || dataKeys.some((key) => key.includes(query));
    const matchesFilter = filter === "all"
      || filter === "online" && isOnline(device.lastSeenAt, device.activityConfirmed, device.simulated === true)
      || filter === "offline" && !isOnline(device.lastSeenAt, device.activityConfirmed, device.simulated === true)
      || filter === "relay_on" && device.lastReport.relays.some((relay) => relay.state === "on")
      || filter === "relay_off" && device.lastReport.relays.length > 0 && device.lastReport.relays.every((relay) => relay.state === "off")
      || filter === "alarm_active" && device.lastReport.alarms.some((alarm) => alarm.active)
      || filter === "alarm_normal" && device.lastReport.alarms.length > 0 && device.lastReport.alarms.every((alarm) => !alarm.active);
    return matchesSearch && matchesFilter;
  }), [devices, filter, search]);
  const control = (deviceId: string): void => {
    setExpandedKeys((current) => current.includes(deviceId) ? current : [...current, deviceId]);
    onControl(deviceId);
  };
  const detail = (device: DeviceRecord): JSX.Element => <Descriptions size="small" column={1} items={[
    { key: "values", label: "采集值", children: previewTags(device.lastReport.values.map((item) => <Tag color="blue" key={item.key}>{`${item.key}: ${item.value}${item.unit}`}</Tag>)) },
    { key: "relays", label: "继电器", children: previewTags(device.lastReport.relays.map((item) => <Tag color={item.state === "on" ? "green" : "default"} key={item.key}>{`${item.key}: ${relayStateText(item.state)}`}</Tag>)) },
    { key: "alarms", label: "报警状态", children: previewTags(device.lastReport.alarms.map((item) => <Tag color={item.active ? "red" : "green"} key={item.key}>{`${item.key}: ${item.active ? "报警" : "正常"}`}</Tag>)) }
  ]} />;
  return <Space direction="vertical" size="middle" style={{ display: "flex" }}>
    <Card className="metric-strip" styles={{ body: { padding: 0 } }}>
      <Row>
        <Col xs={12} lg={6} className="metric-cell"><Statistic title="设备总数" value={devices.length} suffix="台" /></Col>
        <Col xs={12} lg={6} className="metric-cell"><Statistic title="当前在线" value={summary.online} suffix="台" valueStyle={{ color: summary.online > 0 ? "#16a34a" : undefined }} /></Col>
        <Col xs={12} lg={6} className="metric-cell"><Statistic title="存在报警" value={summary.alarms} suffix="台" valueStyle={{ color: summary.alarms > 0 ? "#dc2626" : undefined }} /></Col>
        <Col xs={12} lg={6} className="metric-cell"><Statistic title="继电器开启" value={summary.relayOn} suffix="台" /></Col>
      </Row>
    </Card>
    <Card title="设备列表" extra={<Typography.Text type="secondary">真实设备 15 秒内有活动才判定为在线</Typography.Text>}>
      <div className="panel-toolbar">
        <div className="panel-toolbar-main">
          <Input.Search value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索设备 ID 或数据项名称" allowClear aria-label="搜索设备 ID 或数据项名称" style={{ width: 340 }} />
          <Select<DeviceFilter> value={filter} onChange={setFilter} aria-label="设备状态筛选" style={{ width: 250 }} options={[{ label: `全部设备（${devices.length}）`, value: "all" }, { label: `在线设备（${summary.online}）`, value: "online" }, { label: `离线设备（${devices.length - summary.online}）`, value: "offline" }, { label: `存在开启的继电器（${summary.relayOn}）`, value: "relay_on" }, { label: "继电器全部关闭", value: "relay_off" }, { label: `存在活跃报警（${summary.alarms}）`, value: "alarm_active" }, { label: "报警状态全部正常", value: "alarm_normal" }]} />
          {search.length > 0 || filter !== "all" ? <Button onClick={() => { setSearch(""); setFilter("all"); }}>重置筛选</Button> : null}
        </div>
        <Space><Typography.Text type="secondary">显示 {filteredDevices.length} / {devices.length}</Typography.Text><Button icon={<ReloadOutlined />} onClick={onRefresh}>刷新</Button></Space>
      </div>
      <Table<DeviceRecord> rowKey="deviceId" size="middle" pagination={createTablePagination(10)} scroll={{ x: 980 }} dataSource={filteredDevices} expandable={{ expandedRowKeys: expandedKeys, onExpandedRowsChange: setExpandedKeys, expandedRowRender: detail }} locale={{ emptyText: devices.length === 0 ? "当前项目还没有设备数据。设备完成上报后会出现在这里。" : "没有匹配的设备，请调整搜索或筛选条件。" }} columns={[
        { title: "设备 ID", dataIndex: "deviceId", render: (value: string, device) => <Space wrap><Typography.Text code copyable={{ text: value }}>{value}</Typography.Text>{device.simulated === true ? <Tag color="orange">模拟数据</Tag> : null}</Space> },
        { title: "连接状态", dataIndex: "lastSeenAt", render: (value: string, device) => {
          const online = isOnline(value, device.activityConfirmed, device.simulated === true);
          const activityText = device.activityConfirmed ? relativeTime(value) : "尚未通信";
          return <Space direction="vertical" size={0}><Badge status={online ? "success" : "default"} text={online ? "在线" : "离线"} /><Typography.Text type="secondary">{activityText}</Typography.Text></Space>;
        } },
        { title: "采集值", render: (_, device) => previewTags(device.lastReport.values.map((item) => <Tag color="blue" key={item.key}>{`${item.key}: ${item.value}${item.unit}`}</Tag>)) },
        { title: "继电器", render: (_, device) => previewTags(device.lastReport.relays.map((item) => <Tag color={item.state === "on" ? "green" : "default"} key={item.key}>{`${item.key}: ${relayStateText(item.state)}`}</Tag>)) },
        { title: "报警", render: (_, device) => previewTags(device.lastReport.alarms.map((item) => <Tag color={item.active ? "red" : "green"} key={item.key}>{`${item.key}: ${item.active ? "报警" : "正常"}`}</Tag>)) },
        { title: "操作", width: 130, fixed: "right", render: (_, device) => <Button size="small" type="primary" ghost icon={<ControlOutlined />} onClick={() => control(device.deviceId)}>详情与控制</Button> }
      ]} />
    </Card>
  </Space>;
};
