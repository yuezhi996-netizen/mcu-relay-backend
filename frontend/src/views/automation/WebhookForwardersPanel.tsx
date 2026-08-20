import { Alert, Button, Card, Col, Form, Input, Popconfirm, Row, Space, Switch, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createWebhookForwarder, deleteWebhookForwarder, listWebhookForwarders, updateWebhookForwarder } from "../../automation/api";
import { parseCommaSeparatedList, parseHttpUrl, type AutomationForwarderInput, type AutomationForwarderRecord, type ProjectAccess } from "../../automation/models";
import { createTablePagination } from "../../tablePagination";

type ForwarderFormValues = {
  readonly name: string;
  readonly url: string;
  readonly deviceIds: string;
  readonly keys: string;
  readonly enabled: boolean;
};
export type WebhookForwardersPanelProps = { readonly project: ProjectAccess };

const forwarderInput = (forwarder: AutomationForwarderRecord, enabled: boolean): AutomationForwarderInput | null => forwarder.type !== "webhook" || forwarder.url === null ? null : ({
  name: forwarder.name,
  type: "webhook",
  enabled,
  config: { url: forwarder.url },
  filter: forwarder.filter ?? { deviceIds: [], keys: [] }
});

export const WebhookForwardersPanel = ({ project }: WebhookForwardersPanelProps): JSX.Element => {
  const [form] = Form.useForm<ForwarderFormValues>();
  const [forwarders, setForwarders] = useState<readonly AutomationForwarderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const filteredForwarders = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    if (query.length === 0) return forwarders;
    return forwarders.filter((forwarder) => `${forwarder.name}\n${forwarder.url ?? ""}\n${forwarder.filter?.deviceIds.join("\n") ?? ""}\n${forwarder.filter?.keys.join("\n") ?? ""}`.toLocaleLowerCase("zh-CN").includes(query));
  }, [forwarders, search]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      setForwarders(await listWebhookForwarders(project));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "网络回调列表加载失败。");
    } finally {
      setLoading(false);
    }
  }, [project]);
  useEffect(() => { void load(); }, [load]);

  const create = async (values: ForwarderFormValues): Promise<void> => {
    setCreating(true);
    setError("");
    try {
      const input: AutomationForwarderInput = {
        name: values.name.trim(),
        type: "webhook",
        enabled: values.enabled,
        config: { url: parseHttpUrl(values.url, "网络回调地址") },
        filter: { deviceIds: parseCommaSeparatedList(values.deviceIds), keys: parseCommaSeparatedList(values.keys) }
      };
      await createWebhookForwarder(project, input);
      form.resetFields();
      await load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "网络回调创建失败。");
    } finally {
      setCreating(false);
    }
  };

  const toggle = async (forwarder: AutomationForwarderRecord, enabled: boolean): Promise<void> => {
    const input = forwarderInput(forwarder, enabled);
    if (input === null) {
      setError("网络回调缺少有效地址，无法更新状态。");
      return;
    }
    setBusyId(forwarder.id);
    setError("");
    try {
      const updated = await updateWebhookForwarder(project, forwarder.id, input);
      setForwarders((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "网络回调状态更新失败。");
    } finally {
      setBusyId("");
    }
  };

  const remove = async (forwarderId: string): Promise<void> => {
    setBusyId(forwarderId);
    setError("");
    try {
      await deleteWebhookForwarder(project, forwarderId);
      setForwarders((current) => current.filter((forwarder) => forwarder.id !== forwarderId));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "网络回调删除失败。");
    } finally {
      setBusyId("");
    }
  };

  return <Space direction="vertical" size="middle" style={{ display: "flex" }}>
    {error.length > 0 ? <Alert type="error" showIcon message="网络回调操作失败" description={error} closable onClose={() => setError("")} /> : null}
    <Card title="创建网络回调（Webhook）">
      <Form<ForwarderFormValues> form={form} layout="vertical" initialValues={{ enabled: true, deviceIds: "", keys: "" }} onFinish={(values) => void create(values)}>
        <Row gutter={16}>
          <Col xs={24} md={10}><Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: "请输入转发器名称。" }]}><Input maxLength={100} placeholder="例如 数据分析服务" /></Form.Item></Col>
          <Col xs={24} md={10}><Form.Item name="url" label="回调地址" rules={[{ required: true, whitespace: true, message: "请输入回调地址。" }]}><Input placeholder="https://example.com/webhook" /></Form.Item></Col>
          <Col xs={24} md={4}><Form.Item name="enabled" label="创建后启用" valuePropName="checked"><Switch /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col xs={24} md={12}><Form.Item name="deviceIds" label="设备 ID 过滤" extra="多个设备 ID 使用英文逗号分隔；留空表示全部设备。"><Input placeholder="device001, device002" /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="keys" label="数据项过滤" extra="多个采集值、继电器或报警数据项名称使用英文逗号分隔；留空表示全部数据项。"><Input placeholder="temperature, relay1" /></Form.Item></Col>
        </Row>
        <Button type="primary" htmlType="submit" loading={creating}>创建网络回调</Button>
      </Form>
    </Card>
    <Card title="网络回调列表">
      <div className="panel-toolbar"><div className="panel-toolbar-main"><Input.Search value={search} allowClear onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称、地址、设备或数据项" aria-label="搜索网络回调" style={{ width: 360 }} /></div><Space><Typography.Text type="secondary">显示 {filteredForwarders.length} / {forwarders.length}</Typography.Text><Button onClick={() => void load()} loading={loading}>刷新</Button></Space></div>
      <Table<AutomationForwarderRecord> rowKey="id" size="small" loading={loading} pagination={createTablePagination(10)} scroll={{ x: 900 }} dataSource={[...filteredForwarders]} locale={{ emptyText: forwarders.length === 0 ? "当前项目还没有网络回调。" : "没有匹配的网络回调。" }} columns={[
        { title: "名称", dataIndex: "name" },
        { title: "状态", render: (_, forwarder) => <Space><Switch size="small" checked={forwarder.enabled} loading={busyId === forwarder.id} disabled={busyId.length > 0 && busyId !== forwarder.id} aria-label={`${forwarder.enabled ? "停用" : "启用"}网络回调 ${forwarder.name}`} onChange={(enabled) => void toggle(forwarder, enabled)} /><Tag color={forwarder.enabled ? "green" : "default"}>{forwarder.enabled ? "已启用" : "已停用"}</Tag></Space> },
        { title: "回调地址", dataIndex: "url", render: (value: string | null) => value === null ? "-" : <Typography.Text code copyable={{ text: value }}>{value}</Typography.Text> },
        { title: "设备过滤", render: (_, forwarder) => forwarder.filter === null || forwarder.filter.deviceIds.length === 0 ? "全部" : forwarder.filter.deviceIds.join(", ") },
        { title: "键过滤", render: (_, forwarder) => forwarder.filter === null || forwarder.filter.keys.length === 0 ? "全部" : forwarder.filter.keys.join(", ") },
        { title: "操作", render: (_, forwarder) => <Popconfirm title="确认删除网络回调？" description={`删除 ${forwarder.name} 后将停止转发。`} okText="确认删除" cancelText="取消" onConfirm={() => remove(forwarder.id)}><Button danger size="small" loading={busyId === forwarder.id} disabled={busyId.length > 0 && busyId !== forwarder.id}>删除</Button></Popconfirm> }
      ]} />
    </Card>
  </Space>;
};
