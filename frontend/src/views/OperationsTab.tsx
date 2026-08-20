import { ArrowRightOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Descriptions, Row, Skeleton, Space, Statistic, Tag, Typography } from "antd";
import type { OperationalMetrics } from "../types";

export type OperationsState = {
  readonly metrics: OperationalMetrics | null;
  readonly loading: boolean;
  readonly error: string | null;
};

export type OperationsTabProps = {
  readonly state: OperationsState;
  readonly mqttStatus: { readonly status: string; readonly broker: string; readonly port: number } | null;
  readonly onRefresh: () => void;
  readonly onNavigate: (tab: "projects" | "devices" | "commands") => void;
};

const formatBytes = (value: number): string => {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
};

const formatDuration = (seconds: number): string => {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds % 86_400 / 3_600);
  const minutes = Math.floor(seconds % 3_600 / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
};

const gatewayStatus = (value: string): { readonly color: string; readonly label: string } => {
  if (value === "listening" || value === "connected") return { color: "green", label: value === "listening" ? "正在监听" : "已连接" };
  if (value === "disabled" || value === "unavailable" || value === "stopped") return { color: "default", label: value === "disabled" ? "未启用" : value === "stopped" ? "已停止" : "不可用" };
  if (value === "connecting") return { color: "blue", label: "连接中" };
  return { color: "red", label: "已断开" };
};

export const OperationsTab = ({ state, mqttStatus, onRefresh, onNavigate }: OperationsTabProps): JSX.Element => {
  if (state.metrics === null && state.loading) return <Card><Skeleton active paragraph={{ rows: 9 }} /></Card>;
  if (state.metrics === null) return <Alert type="error" showIcon message="运行指标加载失败" description={state.error ?? "服务器没有返回运行指标。"} action={<Button icon={<ReloadOutlined />} onClick={onRefresh}>重试</Button>} />;
  const metrics = state.metrics;
  const tcp = gatewayStatus(metrics.gateways.tcp);
  const mqtt = gatewayStatus(metrics.gateways.mqtt);
  const heapRate = metrics.process.heapTotalBytes === 0 ? 0 : Math.round(metrics.process.heapUsedBytes / metrics.process.heapTotalBytes * 100);
  return <Space direction="vertical" size="middle" style={{ display: "flex" }}>
    <Alert
      type={metrics.ready ? "success" : "warning"}
      showIcon
      message={metrics.ready ? "中转服务已就绪" : "中转服务尚未就绪"}
      description={metrics.ready ? "HTTP 管理接口和 TCP 设备网关均可继续承接业务。" : "管理页面可以访问，但 TCP 设备网关当前不能承接设备连接。"}
      action={<Button icon={<ReloadOutlined />} loading={state.loading} onClick={onRefresh}>刷新指标</Button>}
    />
    {state.error === null ? null : <Alert type="warning" showIcon message="刷新失败，正在显示上次成功数据" description={state.error} />}
    <Card className="metric-strip" styles={{ body: { padding: 0 } }}>
      <Row>
        <Col xs={12} lg={6} className="metric-cell"><Statistic title="项目总数" value={metrics.resources.projectsTotal} suffix="个" /><Button type="link" onClick={() => onNavigate("projects")}>管理项目 <ArrowRightOutlined /></Button></Col>
        <Col xs={12} lg={6} className="metric-cell"><Statistic title="在线设备" value={metrics.resources.devicesOnline} suffix={`/ ${metrics.resources.devicesTotal}`} /><Button type="link" onClick={() => onNavigate("devices")}>查看设备 <ArrowRightOutlined /></Button></Col>
        <Col xs={12} lg={6} className="metric-cell"><Statistic title="待确认命令" value={metrics.resources.commandsPending} suffix="条" valueStyle={{ color: metrics.resources.commandsPending > 0 ? "#d97706" : undefined }} /><Button type="link" onClick={() => onNavigate("commands")}>检查命令 <ArrowRightOutlined /></Button></Col>
        <Col xs={12} lg={6} className="metric-cell"><Statistic title="服务运行时间" value={formatDuration(metrics.uptimeSeconds)} /></Col>
      </Row>
    </Card>
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={12}>
        <Card title="设备网关" style={{ height: "100%" }}>
          <Descriptions column={1} size="small" items={[
            { key: "tcp", label: "TCP 长连接网关", children: <Space><Tag color={tcp.color}>{tcp.label}</Tag><Typography.Text code>{metrics.gateways.tcp}</Typography.Text></Space> },
            { key: "mqtt", label: "MQTT 桥接", children: <Space><Tag color={mqtt.color}>{mqtt.label}</Tag><Typography.Text code>{metrics.gateways.mqtt}</Typography.Text></Space> },
            { key: "broker", label: "MQTT 服务地址", children: mqttStatus === null || mqttStatus.broker.length === 0 ? "未配置" : <Typography.Text code>{`${mqttStatus.broker}:${mqttStatus.port}`}</Typography.Text> },
            { key: "sample", label: "指标采样时间", children: new Date(metrics.generatedAt).toLocaleString("zh-CN") }
          ]} />
        </Card>
      </Col>
      <Col xs={24} xl={12}>
        <Card title="服务进程" style={{ height: "100%" }}>
          <Descriptions column={1} size="small" items={[
            { key: "node", label: "Node.js 版本", children: <Typography.Text code>{metrics.process.nodeVersion}</Typography.Text> },
            { key: "pid", label: "进程 ID", children: metrics.process.pid },
            { key: "rss", label: "常驻内存", children: formatBytes(metrics.process.rssBytes) },
            { key: "heap", label: "堆内存", children: `${formatBytes(metrics.process.heapUsedBytes)} / ${formatBytes(metrics.process.heapTotalBytes)}（${heapRate}%）` }
          ]} />
        </Card>
      </Col>
    </Row>
    <Card title="命令生命周期">
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}><Statistic title="累计命令" value={metrics.resources.commandsTotal} suffix="条" /></Col>
        <Col xs={12} md={6}><Statistic title="待确认" value={metrics.resources.commandsPending} suffix="条" /></Col>
        <Col xs={12} md={6}><Statistic title="已确认" value={metrics.resources.commandsAcked} suffix="条" valueStyle={{ color: "#16a34a" }} /></Col>
        <Col xs={12} md={6}><Statistic title="已过期" value={metrics.resources.commandsExpired} suffix="条" valueStyle={{ color: metrics.resources.commandsExpired > 0 ? "#dc2626" : undefined }} /></Col>
      </Row>
    </Card>
  </Space>;
};
