import { Alert, Button, Card, Form, Input, Popconfirm, Space, Table, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createAgentKey, deleteAgentKey, listAgentKeys } from "../../automation/api";
import type { AgentKeySummary, CreatedAgentKey, ProjectAccess } from "../../automation/models";
import { createTablePagination } from "../../tablePagination";

export type AgentKeysPanelProps = { readonly project: ProjectAccess };

export const AgentKeysPanel = ({ project }: AgentKeysPanelProps): JSX.Element => {
  const [keys, setKeys] = useState<readonly AgentKeySummary[]>([]);
  const [label, setLabel] = useState("");
  const [createdKey, setCreatedKey] = useState<CreatedAgentKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const filteredKeys = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    return query.length === 0 ? keys : keys.filter((item) => `${item.label}\n${item.keyPreview}`.toLocaleLowerCase("zh-CN").includes(query));
  }, [keys, search]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      setKeys(await listAgentKeys(project));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "代理访问密钥列表加载失败。");
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    setCreatedKey(null);
    void load();
  }, [load]);

  const create = async (): Promise<void> => {
    const normalizedLabel = label.trim();
    if (normalizedLabel.length === 0) {
      setError("代理访问密钥标签不能为空。");
      return;
    }
    setCreating(true);
    setError("");
    try {
      setCreatedKey(await createAgentKey(project, normalizedLabel));
      setLabel("");
      await load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "代理访问密钥创建失败。");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (keyId: string): Promise<void> => {
    setDeletingId(keyId);
    setError("");
    try {
      await deleteAgentKey(project, keyId);
      await load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "代理访问密钥删除失败。");
    } finally {
      setDeletingId("");
    }
  };

  return <Space direction="vertical" size="middle" style={{ display: "flex" }}>
    {error.length > 0 ? <Alert type="error" showIcon message="代理访问密钥操作失败" description={error} closable onClose={() => setError("")} /> : null}
    {createdKey === null ? null : <Alert type="success" showIcon message="代理访问密钥已创建" description={<Space direction="vertical"><Typography.Text>完整密钥仅在本次创建结果中显示，请立即复制保存。</Typography.Text><Typography.Text code copyable={{ text: createdKey.key }}>{createdKey.key}</Typography.Text></Space>} closable onClose={() => setCreatedKey(null)} />}
    <Card title="创建代理访问密钥">
      <Form layout="inline" onFinish={() => void create()}>
        <Form.Item style={{ flex: "1 1 240px" }}><Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如 自动化脚本" aria-label="代理访问密钥标签" maxLength={100} /></Form.Item>
        <Form.Item><Button type="primary" htmlType="submit" loading={creating}>创建密钥</Button></Form.Item>
      </Form>
    </Card>
    <Card title="代理访问密钥列表">
      <div className="panel-toolbar"><div className="panel-toolbar-main"><Input.Search value={search} allowClear onChange={(event) => setSearch(event.target.value)} placeholder="搜索标签或密钥预览" aria-label="搜索代理访问密钥" style={{ width: 320 }} /></div><Space><Typography.Text type="secondary">显示 {filteredKeys.length} / {keys.length}</Typography.Text><Button onClick={() => void load()} loading={loading}>刷新</Button></Space></div>
      <Table<AgentKeySummary> rowKey="id" size="small" loading={loading} pagination={createTablePagination(10)} scroll={{ x: 720 }} dataSource={[...filteredKeys]} locale={{ emptyText: keys.length === 0 ? "当前项目还没有代理访问密钥。" : "没有匹配的代理访问密钥。" }} columns={[
        { title: "标签", dataIndex: "label" },
        { title: "密钥预览", dataIndex: "keyPreview", render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
        { title: "创建时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() },
        { title: "最后使用", dataIndex: "lastUsedAt", render: (value: string | null) => value === null ? "从未使用" : new Date(value).toLocaleString() },
        { title: "操作", render: (_, item) => <Popconfirm title="确认删除代理访问密钥？" description={`删除后 ${item.label} 将立即失效。`} okText="确认删除" cancelText="取消" onConfirm={() => remove(item.id)}><Button danger size="small" loading={deletingId === item.id} disabled={deletingId.length > 0 && deletingId !== item.id}>删除</Button></Popconfirm> }
      ]} />
    </Card>
  </Space>;
};
