import { Empty, Grid, Space, Tabs, Tag, Typography } from "antd";
import { useMemo } from "react";
import type { DeviceRecord, ProjectRecord } from "../../types";
import { AgentKeysPanel } from "./AgentKeysPanel";
import { FirmwareOtaPanel } from "./FirmwareOtaPanel";
import { RulesPanel } from "./RulesPanel";
import { WebhookForwardersPanel } from "./WebhookForwardersPanel";

export type AutomationTabProps = {
  readonly project: ProjectRecord | undefined;
  readonly devices: readonly DeviceRecord[];
};

export const AutomationTab = ({ project, devices }: AutomationTabProps): JSX.Element => {
  const screens = Grid.useBreakpoint();
  const access = useMemo(() => project === undefined ? null : ({ projectId: project.projectId, token: project.token }), [project?.projectId, project?.token]);
  if (access === null) return <Empty description="请先创建并选择项目，再配置自动化能力。" />;
  return <Space direction="vertical" size="middle" style={{ display: "flex" }}>
    <Space wrap><Typography.Text strong>{project?.name}</Typography.Text><Typography.Text code>{access.projectId}</Typography.Text><Tag>{devices.length} 台设备</Tag></Space>
    <Tabs key={access.projectId} destroyOnHidden tabPosition={screens.lg === true ? "left" : "top"} items={[
      { key: "rules", label: "自动化规则", children: <RulesPanel project={access} /> },
      { key: "webhooks", label: "网络回调", children: <WebhookForwardersPanel project={access} /> },
      { key: "firmware", label: "固件与远程升级", children: <FirmwareOtaPanel project={access} devices={devices} /> },
      { key: "agent-keys", label: "代理访问密钥", children: <AgentKeysPanel project={access} /> }
    ]} />
  </Space>;
};
