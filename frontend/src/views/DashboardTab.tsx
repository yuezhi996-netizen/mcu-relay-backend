import { ArrowRightOutlined, DeploymentUnitOutlined, ReloadOutlined, SendOutlined } from "@ant-design/icons";
import { Alert, Badge, Button, Card, Col, Descriptions, Empty, Progress, Row, Skeleton, Space, Table, Tag, Typography, theme } from "antd";
import type { DashboardAttentionDevice, DashboardSnapshot, EventName, ProjectRecord } from "../types";
import { relativeTime } from "./DevicesPanel";
import { eventColor, eventLabels, eventTarget, type DashboardEvent } from "./EventsPanel";
import { SummaryCards } from "./SummaryCards";

export type DashboardState = {
  readonly snapshot: DashboardSnapshot | null;
  readonly loading: boolean;
  readonly error: string | null;
};
export type DashboardTabProps = {
  readonly selectedProject: ProjectRecord | undefined;
  readonly state: DashboardState;
  readonly eventStatus: string;
  readonly events: readonly DashboardEvent[];
  readonly onNavigate: (tab: "projects" | "operations" | "devices" | "commands" | "events" | "automation") => void;
  readonly onRetry: () => void;
};

const ratioPercent = (part: number, total: number): number => total === 0 ? 0 : Math.round(part / total * 100);
const eventBadgeStatus = (status: string): "success" | "error" | "processing" => status === "已连接" ? "success" : status === "已断开" ? "error" : "processing";
const formatHour = (timestamp: string): string => new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

type ReportActivityChartProps = {
  readonly snapshot: DashboardSnapshot;
};
const ReportActivityChart = ({ snapshot }: ReportActivityChartProps): JSX.Element => {
  const { token } = theme.useToken();
  const maximum = Math.max(1, ...snapshot.reports.hourly.map((bucket) => bucket.reports));
  const summary = `最近 24 小时共有 ${snapshot.reports.total} 次真实设备上报，其中 ${snapshot.reports.activeAlarmReports} 次包含活跃报警，涉及 ${snapshot.reports.activeDevices} 台设备。`;
  return <Card title="24 小时设备上报" extra={<Typography.Text type="secondary">固定 24 小时窗口</Typography.Text>} style={{ height: "100%" }}>
    <Space wrap size="middle" style={{ marginBottom: 16 }}>
      <Typography.Text strong>{snapshot.reports.total} 次上报</Typography.Text>
      <Typography.Text type="secondary">活跃设备 {snapshot.reports.activeDevices} 台</Typography.Text>
      {snapshot.reports.total === 0 ? <Tag>窗口内无真实上报</Tag> : snapshot.reports.activeAlarmReports > 0 ? <Tag color="red">含报警上报 {snapshot.reports.activeAlarmReports} 次</Tag> : <Tag color="green">未出现报警上报</Tag>}
    </Space>
    <div role="region" tabIndex={0} aria-label={summary} style={{ overflowX: "auto", paddingBottom: 4 }}>
      <div style={{ minWidth: 960, height: 188, display: "grid", gridTemplateColumns: "repeat(24, minmax(36px, 1fr))", gap: 4, alignItems: "end", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        {snapshot.reports.hourly.map((bucket, index) => {
          const height = `${Math.max(bucket.reports === 0 ? 2 : 8, Math.round(bucket.reports / maximum * 100))}%`;
          const hasAlarm = bucket.activeAlarmReports > 0;
          const axisLabel = index % 6 === 0 || index === snapshot.reports.hourly.length - 1 ? formatHour(bucket.startedAt) : "";
          return <div key={bucket.startedAt} title={`${new Date(bucket.startedAt).toLocaleString("zh-CN")}：${bucket.reports} 次上报，${bucket.activeAlarmReports} 次含报警，${bucket.activeDevices} 台活跃设备`} aria-label={`${formatHour(bucket.startedAt)}，${bucket.reports} 次上报`} style={{ height: "100%", display: "grid", gridTemplateRows: "20px 1fr 24px", alignItems: "end", textAlign: "center" }}>
            <Typography.Text style={{ fontSize: 11, lineHeight: "20px" }}>{bucket.reports}</Typography.Text>
            <div style={{ height: "100%", display: "flex", alignItems: "end", justifyContent: "center" }}><div style={{ width: "70%", minHeight: 2, height, borderRadius: "4px 4px 0 0", background: bucket.reports === 0 ? token.colorFillTertiary : hasAlarm ? token.colorError : token.colorPrimary }} /></div>
            <Typography.Text type="secondary" style={{ fontSize: 10, lineHeight: "24px", whiteSpace: "nowrap" }}>{axisLabel}</Typography.Text>
          </div>;
        })}
      </div>
    </div>
  </Card>;
};

type CommandDeliveryCardProps = {
  readonly snapshot: DashboardSnapshot;
  readonly onNavigate: () => void;
};
const CommandDeliveryCard = ({ snapshot, onNavigate }: CommandDeliveryCardProps): JSX.Element => {
  const percentage = snapshot.commands.acknowledgementRate === null ? 0 : Math.round(snapshot.commands.acknowledgementRate * 100);
  return <Card title="命令确认情况" extra={<Button type="link" onClick={onNavigate}>查看命令 <ArrowRightOutlined /></Button>} style={{ height: "100%" }}>
    {snapshot.commands.acknowledgementRate === null ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前项目还没有已完成命令。" /> : <>
      <Progress percent={percentage} status={snapshot.commands.expired > 0 ? "exception" : "success"} format={(value) => `确认率 ${value ?? 0}%`} />
      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>项目累计确认率仅按已确认和已过期命令计算，待确认命令不进入分母。</Typography.Paragraph>
    </>}
    <Space wrap>
      <Tag color="gold">待确认 {snapshot.commands.pending}</Tag>
      <Tag color="green">已确认 {snapshot.commands.acked}</Tag>
      <Tag color="red">已过期 {snapshot.commands.expired}</Tag>
    </Space>
  </Card>;
};

type TelemetryCardProps = {
  readonly snapshot: DashboardSnapshot;
};
const TelemetryCard = ({ snapshot }: TelemetryCardProps): JSX.Element => {
  const relayOnPercent = ratioPercent(snapshot.telemetry.relayOn, snapshot.telemetry.relayTotal);
  return <Card title="当前遥测状态" style={{ height: "100%" }}>
    <Descriptions column={1} size="small" items={[
      {
        key: "relays",
        label: "继电器",
        children: snapshot.telemetry.hasRelayData ? <Space direction="vertical" size={4} style={{ display: "flex" }}><Progress percent={relayOnPercent} size="small" format={() => `开启 ${snapshot.telemetry.relayOn} / ${snapshot.telemetry.relayTotal}`} /><Typography.Text type="secondary">关闭 {snapshot.telemetry.relayOff} 路</Typography.Text></Space> : <Typography.Text type="secondary">设备尚未上报继电器字段</Typography.Text>
      },
      {
        key: "alarms",
        label: "报警字段",
        children: !snapshot.telemetry.hasAlarmData ? <Typography.Text type="secondary">设备尚未上报告警字段</Typography.Text> : snapshot.telemetry.activeAlarmCount === 0 ? <Tag color="green">已上报，当前正常</Tag> : <Tag color="red">活跃报警 {snapshot.telemetry.activeAlarmCount} 项</Tag>
      }
    ]} />
  </Card>;
};

type AutomationStatusCardProps = {
  readonly snapshot: DashboardSnapshot;
  readonly onNavigate: () => void;
};
const AutomationStatusCard = ({ snapshot, onNavigate }: AutomationStatusCardProps): JSX.Element => <Card title="自动化运行" extra={<Button type="link" onClick={onNavigate}>管理自动化 <ArrowRightOutlined /></Button>} style={{ height: "100%" }}>
  <Descriptions column={1} size="small" items={[
    { key: "rules", label: "启用规则", children: `${snapshot.automation.rulesEnabled} / ${snapshot.automation.rulesTotal}` },
    { key: "ota-active", label: "进行中的远程升级", children: snapshot.automation.otaActive === 0 ? <Tag>无进行中任务</Tag> : <Tag color="blue">{snapshot.automation.otaActive} 个任务</Tag> },
    { key: "ota-finished", label: "远程升级结果", children: <Space wrap><Tag color="green">成功 {snapshot.automation.otaSuccess}</Tag><Tag color="red">失败 {snapshot.automation.otaFailed}</Tag></Space> }
  ]} />
</Card>;

const sortAttentionDevices = (devices: readonly DashboardAttentionDevice[]): readonly DashboardAttentionDevice[] => devices
  .filter((device) => !device.online || device.simulated || device.activeAlarmCount > 0)
  .slice()
  .sort((left, right) => right.activeAlarmCount - left.activeAlarmCount || Number(left.online) - Number(right.online) || left.lastSeenAt.localeCompare(right.lastSeenAt));
type AttentionDevicesTableProps = {
  readonly devices: readonly DashboardAttentionDevice[];
  readonly onNavigate: () => void;
};
const AttentionDevicesTable = ({ devices, onNavigate }: AttentionDevicesTableProps): JSX.Element => <Card title="需要关注的设备" extra={<Button type="link" onClick={onNavigate}>查看全部设备 <ArrowRightOutlined /></Button>}>
  <Table<DashboardAttentionDevice> rowKey="deviceId" size="small" pagination={false} scroll={{ x: 620 }} dataSource={[...sortAttentionDevices(devices)]} locale={{ emptyText: "当前没有离线或报警设备。" }} columns={[
    { title: "设备 ID", dataIndex: "deviceId", render: (value: string, device) => <Space wrap><Typography.Text code>{value}</Typography.Text>{device.simulated ? <Tag color="orange">模拟</Tag> : null}</Space> },
    { title: "连接状态", dataIndex: "online", render: (value: boolean) => <Badge status={value ? "success" : "default"} text={value ? "在线" : "离线"} /> },
    { title: "活跃报警", dataIndex: "activeAlarmCount", responsive: ["sm"], render: (value: number) => value === 0 ? <Tag>无</Tag> : <Tag color="red">{value} 项</Tag> },
    { title: "最后上报", dataIndex: "lastSeenAt", responsive: ["md"], render: (value: string) => <Space direction="vertical" size={0}><span>{new Date(value).toLocaleString("zh-CN")}</span><Typography.Text type="secondary">{relativeTime(value)}</Typography.Text></Space> },
    { title: "操作", render: () => <Button size="small" onClick={onNavigate}>查看设备</Button> }
  ]} />
</Card>;

type SessionEventsCardProps = {
  readonly eventStatus: string;
  readonly events: readonly DashboardEvent[];
  readonly onNavigate: () => void;
};
const SessionEventsCard = ({ eventStatus, events, onNavigate }: SessionEventsCardProps): JSX.Element => <Card title="本次页面会话事件" extra={<Space wrap><Badge status={eventBadgeStatus(eventStatus)} text={eventStatus} /><Button type="link" onClick={onNavigate}>查看全部 <ArrowRightOutlined /></Button></Space>}>
  <Typography.Paragraph type="secondary">这里只显示当前页面收到的实时事件，不参与上方 24 小时业务统计。</Typography.Paragraph>
  <Table<DashboardEvent> rowKey="id" size="small" pagination={false} scroll={{ x: 620 }} dataSource={events.slice(0, 6)} locale={{ emptyText: "等待当前页面接收设备或命令事件。" }} columns={[
    { title: "时间", dataIndex: "receivedAt", render: (value: string) => new Date(value).toLocaleTimeString("zh-CN") },
    { title: "事件类型", dataIndex: "name", render: (value: EventName) => <Tag color={eventColor[value]}>{eventLabels[value]}</Tag> },
    { title: "设备", render: (_, event) => <Typography.Text code>{eventTarget(event).deviceId}</Typography.Text> },
    { title: "摘要", render: (_, event) => eventTarget(event).label }
  ]} />
</Card>;

export const DashboardTab = ({ selectedProject, state, eventStatus, events, onNavigate, onRetry }: DashboardTabProps): JSX.Element => {
  if (selectedProject === undefined) return <Empty description="请先创建项目，再开始接入设备。"><Button type="primary" onClick={() => onNavigate("projects")}>去项目管理创建项目</Button></Empty>;
  if (state.snapshot === null && state.loading) return <Card><Skeleton active paragraph={{ rows: 10 }} /></Card>;
  if (state.snapshot === null) return <Alert type="error" showIcon message="仪表盘加载失败" description={state.error ?? "服务器没有返回仪表盘数据。"} action={<Button icon={<ReloadOutlined />} onClick={onRetry}>重试</Button>} />;
  const snapshot = state.snapshot;
  return <Space direction="vertical" size="middle" style={{ display: "flex" }}>
    <div className="panel-toolbar">
      <Space direction="vertical" size={4}>
        <Space wrap size="middle">
          <Typography.Title level={4} style={{ margin: 0 }}>{selectedProject.name}</Typography.Title>
          <Typography.Text code copyable={{ text: selectedProject.projectId, tooltips: ["复制项目 ID", "项目 ID 已复制"] }}>{selectedProject.projectId}</Typography.Text>
          <Badge status={eventBadgeStatus(eventStatus)} text={`事件流：${eventStatus}`} />
          {state.loading ? <Tag color="processing">正在刷新快照</Tag> : null}
        </Space>
        <Typography.Text type="secondary">统计窗口从 {new Date(snapshot.windowStartedAt).toLocaleString("zh-CN")} 开始，快照生成于 {new Date(snapshot.generatedAt).toLocaleString("zh-CN")}。</Typography.Text>
      </Space>
      <Space wrap><Button icon={<DeploymentUnitOutlined />} onClick={() => onNavigate("operations")}>运维状态</Button><Button type="primary" icon={<SendOutlined />} onClick={() => onNavigate("commands")}>下发命令</Button></Space>
    </div>
    {state.error === null ? null : <Alert type="warning" showIcon message="快照刷新失败，正在显示上次成功数据" description={state.error} action={<Button onClick={onRetry}>重新加载</Button>} />}
    <SummaryCards snapshot={snapshot} />
    {snapshot.devices.total === 0 ? <Card><Empty description="当前项目还没有真实设备数据；模拟设备不会进入业务统计。设备完成真实上报后，24 小时趋势和业务状态会显示在这里。"><Button type="primary" onClick={() => onNavigate("devices")}>查看设备接入状态</Button></Empty></Card> : <>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}><ReportActivityChart snapshot={snapshot} /></Col>
        <Col xs={24} xl={8}><CommandDeliveryCard snapshot={snapshot} onNavigate={() => onNavigate("commands")} /></Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}><TelemetryCard snapshot={snapshot} /></Col>
        <Col xs={24} lg={12}><AutomationStatusCard snapshot={snapshot} onNavigate={() => onNavigate("automation")} /></Col>
      </Row>
      <AttentionDevicesTable devices={snapshot.attentionDevices} onNavigate={() => onNavigate("devices")} />
    </>}
    <SessionEventsCard eventStatus={eventStatus} events={events} onNavigate={() => onNavigate("events")} />
  </Space>;
};
