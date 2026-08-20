import { Card, Table, Tag, Tooltip, Typography } from "antd";
import { commandTimelineStatus, type CommandTimelineItem } from "../hooks/useCommandTimeline";
import { createTablePagination } from "../tablePagination";

export type CommandStatusPanelProps = { readonly items: readonly CommandTimelineItem[] };

export const CommandStatusPanel = ({ items }: CommandStatusPanelProps): JSX.Element => <Card title="命令实时状态"><span aria-live="polite" aria-atomic="true" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>{items.length === 0 ? "暂无命令状态" : `最新命令 ${items[0]?.name ?? "未知"}，状态 ${commandTimelineStatus(items[0]?.status ?? "queued").label}`}</span>
  <Table<CommandTimelineItem> rowKey="id" size="small" pagination={createTablePagination(10)} scroll={{ x: 760 }} dataSource={[...items]} locale={{ emptyText: "页面打开后收到的命令状态会显示在这里。" }} columns={[
    { title: "命令 ID", dataIndex: "id", render: (value: string) => <Tooltip title={value}><Typography.Text code>{value.length > 16 ? `${value.slice(0, 16)}…` : value}</Typography.Text></Tooltip> },
    { title: "命令名", dataIndex: "name" },
    { title: "设备", dataIndex: "deviceId", render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
    { title: "入队时间", dataIndex: "queuedAt", render: (value: string) => new Date(value).toLocaleString() },
    { title: "状态", dataIndex: "status", render: (value: CommandTimelineItem["status"]) => <Tag color={commandTimelineStatus(value).color}>{commandTimelineStatus(value).label}</Tag> }
  ]} />
</Card>;
