import { CheckOutlined, CloseOutlined, CopyOutlined, EyeInvisibleOutlined, EyeOutlined, ReloadOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Card, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import { useState } from "react";
import { createTablePagination } from "../tablePagination";
import type { ProjectAccount } from "../types";

export type AccountsPanelProps = {
  readonly accounts: readonly ProjectAccount[];
  readonly loading: boolean;
  readonly onReview: (account: ProjectAccount, decision: "approve" | "reject") => Promise<void>;
  readonly onRefresh: () => Promise<void>;
};

const statusColor = (status: ProjectAccount["status"]): "processing" | "success" | "error" => status === "pending" ? "processing" : status === "approved" ? "success" : "error";
const statusText = (status: ProjectAccount["status"]): string => status === "pending" ? "待审核" : status === "approved" ? "已通过" : "已拒绝";

export const AccountsPanel = ({ accounts, loading, onReview, onRefresh }: AccountsPanelProps): JSX.Element => {
  const [visiblePasswords, setVisiblePasswords] = useState<ReadonlySet<string>>(new Set());
  const [reviewingId, setReviewingId] = useState("");
  const togglePassword = (id: string): void => setVisiblePasswords((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const review = async (account: ProjectAccount, decision: "approve" | "reject"): Promise<void> => {
    setReviewingId(account.id);
    try {
      await onReview(account, decision);
      message.success(decision === "approve" ? "已审核通过并创建项目。" : "已拒绝注册申请。");
    } finally {
      setReviewingId("");
    }
  };
  const copy = async (value: string): Promise<void> => {
    await navigator.clipboard.writeText(value);
    message.success("已复制");
  };
  const pendingCount = accounts.filter((account) => account.status === "pending").length;
  return <Card title={<Space><UserOutlined /><span>用户审核与项目账号</span><Tag color={pendingCount === 0 ? "default" : "processing"}>{pendingCount} 待审核</Tag></Space>} extra={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => void onRefresh()}>刷新</Button>}>
    <Typography.Paragraph type="secondary">注册申请只有审核通过后才会创建项目并绑定账号。每个已创建项目仅有一个项目用户账号，账号不能进入项目管理、运维和其他项目。</Typography.Paragraph>
    <Table<ProjectAccount> rowKey="id" loading={loading} pagination={createTablePagination(10)} scroll={{ x: 1080 }} dataSource={[...accounts]} columns={[
      { title: "账号", dataIndex: "username", render: (value: string) => <Typography.Text code copyable={{ text: value }}>{value}</Typography.Text> },
      { title: "项目", render: (_, account) => <Space direction="vertical" size={0}><Typography.Text>{account.projectId ?? account.requestedProjectName ?? "未指定"}</Typography.Text><Typography.Text type="secondary" code>{account.projectId ?? account.requestedProjectId ?? ""}</Typography.Text></Space> },
      { title: "密码", render: (_, account) => <Space size="small"><Typography.Text code>{visiblePasswords.has(account.id) ? account.password : "••••••••"}</Typography.Text><Tooltip title={visiblePasswords.has(account.id) ? "隐藏" : "显示"}><Button type="text" size="small" icon={visiblePasswords.has(account.id) ? <EyeInvisibleOutlined /> : <EyeOutlined />} onClick={() => togglePassword(account.id)} aria-label="显示或隐藏账号密码" /></Tooltip><Tooltip title="复制"><Button type="text" size="small" icon={<CopyOutlined />} onClick={() => void copy(account.password)} aria-label="复制账号密码" /></Tooltip></Space> },
      { title: "状态", dataIndex: "status", render: (value: ProjectAccount["status"]) => <Tag color={statusColor(value)}>{statusText(value)}</Tag> },
      { title: "注册时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() },
      { title: "操作", fixed: "right", render: (_, account) => account.status !== "pending" ? <Typography.Text type="secondary">已处理</Typography.Text> : <Space><Button type="primary" size="small" icon={<CheckOutlined />} loading={reviewingId === account.id} onClick={() => void review(account, "approve")}>通过</Button><Button danger size="small" icon={<CloseOutlined />} loading={reviewingId === account.id} onClick={() => void review(account, "reject")}>拒绝</Button></Space> }
    ]} />
  </Card>;
};
