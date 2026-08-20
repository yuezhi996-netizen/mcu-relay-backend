import { Button, Card, Input, Select, Space, Table, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import { commandTimelineStatus, type CommandTimelineItem } from "../hooks/useCommandTimeline";
import { createTablePagination } from "../tablePagination";

export type CommandHistoryPanelProps = {
  readonly items: readonly CommandTimelineItem[];
};

export const CommandHistoryPanel = ({ items }: CommandHistoryPanelProps): JSX.Element => {
  const [name, setName] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const names = useMemo(() => [...new Set(items.map((item) => item.name))], [items]);
  const data = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => (name === undefined || item.name === name)
      && (status === undefined || item.status === status)
      && (query.length === 0 || `${item.id}\n${item.name}\n${item.deviceId}`.toLowerCase().includes(query)));
  }, [items, name, search, status]);
  return <Card title="命令历史" extra={<Typography.Text type="secondary">最多显示最近 50 条服务器记录和本次会话命令</Typography.Text>}>
    <div className="panel-toolbar">
      <div className="panel-toolbar-main">
      <Input.Search value={search} onChange={(event) => setSearch(event.target.value)} allowClear placeholder="搜索命令 ID、命令名或设备 ID" aria-label="搜索命令历史" style={{ width: "clamp(240px, 70vw, 380px)" }} />
      <Select showSearch optionFilterProp="label" allowClear value={name} placeholder="按命令名筛选" style={{ width: "clamp(160px, 62vw, 220px)" }} options={names.map((value) => ({ label: value, value }))} onChange={setName} aria-label="按命令名筛选命令历史" />
      <Select allowClear value={status} placeholder="按状态筛选" style={{ width: "clamp(150px, 56vw, 180px)" }} options={[{ label: "待设备确认", value: "queued" }, { label: "已确认", value: "acked" }, { label: "已过期", value: "expired" }]} onChange={setStatus} aria-label="按状态筛选命令历史" />
      {search.length > 0 || name !== undefined || status !== undefined ? <Button onClick={() => { setSearch(""); setName(undefined); setStatus(undefined); }}>重置筛选</Button> : null}
      </div>
      <Typography.Text type="secondary">显示 {data.length} 条，共 {items.length} 条命令</Typography.Text>
    </div>
    <Table<CommandTimelineItem> rowKey="id" size="small" pagination={createTablePagination(10)} scroll={{ x: 700 }} dataSource={data} locale={{ emptyText: items.length === 0 ? "还没有下发过命令。" : "没有匹配的命令，请调整搜索或筛选条件。" }} columns={[
      { title: "命令 ID", dataIndex: "id", render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
      { title: "命令名", dataIndex: "name" },
      { title: "设备 ID", dataIndex: "deviceId", render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
      { title: "创建时间", dataIndex: "queuedAt", render: (value: string) => new Date(value).toLocaleString() },
      { title: "状态", dataIndex: "status", render: (value: CommandTimelineItem["status"]) => <Tag color={commandTimelineStatus(value).color}>{commandTimelineStatus(value).label}</Tag> }
    ]} />
  </Card>;
};
