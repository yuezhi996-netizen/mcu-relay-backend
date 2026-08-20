import { Card, Col, Row, Statistic, Typography, theme } from "antd";
import type { DashboardSnapshot } from "../types";

export type SummaryCardsProps = {
  readonly snapshot: DashboardSnapshot;
};

export const SummaryCards = ({ snapshot }: SummaryCardsProps): JSX.Element => {
  const { token } = theme.useToken();
  const metrics = [
    {
      key: "online",
      title: "在线设备",
      value: snapshot.devices.online,
      suffix: `/ ${snapshot.devices.total}`,
      detail: snapshot.devices.simulated === 0 ? `离线 ${snapshot.devices.offline} 台` : `离线 ${snapshot.devices.offline} 台，模拟 ${snapshot.devices.simulated} 台`,
      color: snapshot.devices.online > 0 ? token.colorSuccess : token.colorText
    },
    {
      key: "alarms",
      title: "活跃报警",
      value: snapshot.telemetry.activeAlarmCount,
      suffix: "项",
      detail: snapshot.telemetry.hasAlarmData ? `涉及 ${snapshot.devices.activeAlarmDevices} 台设备` : "尚未上报告警字段",
      color: snapshot.telemetry.activeAlarmCount > 0 ? token.colorError : token.colorText
    },
    {
      key: "pending",
      title: "待确认命令",
      value: snapshot.commands.pending,
      suffix: "条",
      detail: `累计 ${snapshot.commands.total} 条命令`,
      color: snapshot.commands.pending > 0 ? token.colorWarning : token.colorText
    },
    {
      key: "reports",
      title: "24 小时真实上报",
      value: snapshot.reports.total,
      suffix: "次",
      detail: snapshot.reports.lastReportedAt === null ? "还没有真实设备上报" : `最近 ${new Date(snapshot.reports.lastReportedAt).toLocaleString("zh-CN")}`,
      color: token.colorPrimary
    }
  ] as const;
  return <Card className="metric-strip" styles={{ body: { padding: 0 } }} id="overview">
    <Row>{metrics.map((metric) => <Col xs={12} lg={6} className="metric-cell" key={metric.key}><Statistic title={metric.title} value={metric.value} suffix={metric.suffix} valueStyle={{ color: metric.color }} /><Typography.Text type="secondary">{metric.detail}</Typography.Text></Col>)}</Row>
  </Card>;
};
