import { Alert, Button, Card, Col, Form, Input, InputNumber, Popconfirm, Row, Select, Space, Switch, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createRule, deleteRule, listRules, updateRule } from "../../automation/api";
import { parseCommaSeparatedList, parseRuleActionsText, parseRuleConditionsText, type AutomationRuleInput, type AutomationRuleRecord, type ProjectAccess } from "../../automation/models";
import { createTablePagination } from "../../tablePagination";

type RuleFormValues = {
  readonly name: string;
  readonly logic: "all" | "any";
  readonly cooldownMs: number;
  readonly sourceDeviceIds: string;
  readonly conditions: string;
  readonly actions: string;
};
export type RulesPanelProps = { readonly project: ProjectAccess };

const defaultConditions = '[\n  {"field":"temperature","operator":">","value":30}\n]';
const defaultActions = '[\n  {"deviceId":"device001","command":{"name":"set_relays","payload":{"relays":[{"key":"relay1","state":"on"}]}}}\n]';
const ruleInput = (rule: AutomationRuleRecord, enabled: boolean): AutomationRuleInput => ({
  name: rule.name,
  enabled,
  sourceDeviceIds: rule.sourceDeviceIds,
  conditions: rule.conditions,
  logic: rule.logic,
  actions: rule.actions,
  cooldownMs: rule.cooldownMs
});

export const RulesPanel = ({ project }: RulesPanelProps): JSX.Element => {
  const [form] = Form.useForm<RuleFormValues>();
  const [rules, setRules] = useState<readonly AutomationRuleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [enabledFilter, setEnabledFilter] = useState<"enabled" | "disabled" | undefined>(undefined);
  const filteredRules = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    return rules.filter((rule) => (enabledFilter === undefined || rule.enabled === (enabledFilter === "enabled"))
      && (query.length === 0 || `${rule.name}\n${rule.sourceDeviceIds.join("\n")}`.toLocaleLowerCase("zh-CN").includes(query)));
  }, [enabledFilter, rules, search]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      setRules(await listRules(project));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "规则列表加载失败。");
    } finally {
      setLoading(false);
    }
  }, [project]);
  useEffect(() => { void load(); }, [load]);

  const create = async (values: RuleFormValues): Promise<void> => {
    setCreating(true);
    setError("");
    try {
      const conditions = parseRuleConditionsText(values.conditions);
      const actions = parseRuleActionsText(values.actions);
      const sourceDeviceIds = parseCommaSeparatedList(values.sourceDeviceIds);
      await createRule(project, { name: values.name.trim(), enabled: true, sourceDeviceIds, conditions, logic: values.logic, actions, cooldownMs: values.cooldownMs });
      form.resetFields();
      await load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "规则创建失败。");
    } finally {
      setCreating(false);
    }
  };

  const toggle = async (rule: AutomationRuleRecord, enabled: boolean): Promise<void> => {
    setBusyId(rule.id);
    setError("");
    try {
      const updated = await updateRule(project, rule.id, ruleInput(rule, enabled));
      setRules((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "规则状态更新失败。");
    } finally {
      setBusyId("");
    }
  };

  const remove = async (ruleId: string): Promise<void> => {
    setBusyId(ruleId);
    setError("");
    try {
      await deleteRule(project, ruleId);
      setRules((current) => current.filter((rule) => rule.id !== ruleId));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "规则删除失败。");
    } finally {
      setBusyId("");
    }
  };

  return <Space direction="vertical" size="middle" style={{ display: "flex" }}>
    {error.length > 0 ? <Alert type="error" showIcon message="规则操作失败" description={error} closable onClose={() => setError("")} /> : null}
    <Card title="创建规则">
      <Form<RuleFormValues> form={form} layout="vertical" initialValues={{ logic: "all", cooldownMs: 0, sourceDeviceIds: "", conditions: defaultConditions, actions: defaultActions }} onFinish={(values) => void create(values)}>
        <Row gutter={16}>
          <Col xs={24} md={12}><Form.Item name="name" label="规则名称" rules={[{ required: true, whitespace: true, message: "请输入规则名称。" }]}><Input maxLength={100} placeholder="例如 温度过高开启风扇" /></Form.Item></Col>
          <Col xs={24} sm={12} md={6}><Form.Item name="logic" label="条件逻辑" rules={[{ required: true }]}><Select options={[{ value: "all", label: "全部满足" }, { value: "any", label: "任一满足" }]} aria-label="规则条件逻辑" /></Form.Item></Col>
          <Col xs={24} sm={12} md={6}><Form.Item name="cooldownMs" label="冷却时间（毫秒）" rules={[{ required: true, message: "请输入冷却时间。" }]}><InputNumber min={0} precision={0} style={{ width: "100%" }} /></Form.Item></Col>
        </Row>
        <Form.Item name="sourceDeviceIds" label="来源设备 ID" extra="多个设备 ID 使用英文逗号分隔；留空表示项目内任意设备的上报都可触发。"><Input allowClear placeholder="例如 sensor001,sensor002" /></Form.Item>
        <Form.Item name="conditions" label="条件 JSON" extra="field 直接填写设备上报的数据键；operator 支持 >、<、>=、<=、==、!=。" rules={[{ required: true, message: "请输入条件 JSON。" }]}><Input.TextArea rows={7} spellCheck={false} /></Form.Item>
        <Form.Item name="actions" label="动作 JSON" extra="每项需要 deviceId 和 command；command 需要 name 与 payload。" rules={[{ required: true, message: "请输入动作 JSON。" }]}><Input.TextArea rows={8} spellCheck={false} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={creating}>创建规则</Button>
      </Form>
    </Card>
    <Card title="规则列表">
      <div className="panel-toolbar"><div className="panel-toolbar-main"><Input.Search value={search} allowClear onChange={(event) => setSearch(event.target.value)} placeholder="搜索规则名称或来源设备" aria-label="搜索自动化规则" style={{ width: 340 }} /><Select<"enabled" | "disabled"> allowClear value={enabledFilter} onChange={setEnabledFilter} placeholder="筛选启用状态" aria-label="筛选规则启用状态" style={{ width: 170 }} options={[{ value: "enabled", label: "已启用" }, { value: "disabled", label: "已停用" }]} /></div><Space><Typography.Text type="secondary">显示 {filteredRules.length} / {rules.length}</Typography.Text><Button onClick={() => void load()} loading={loading}>刷新</Button></Space></div>
      <Table<AutomationRuleRecord> rowKey="id" size="small" loading={loading} pagination={createTablePagination(10)} scroll={{ x: 980 }} dataSource={[...filteredRules]} locale={{ emptyText: rules.length === 0 ? "当前项目还没有规则。" : "没有匹配的规则。" }} expandable={{ expandedRowRender: (rule) => <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflow: "auto" }}>{JSON.stringify({ sourceDeviceIds: rule.sourceDeviceIds, conditions: rule.conditions, actions: rule.actions }, null, 2)}</pre> }} columns={[
        { title: "名称", dataIndex: "name" },
        { title: "状态", render: (_, rule) => <Space><Switch size="small" checked={rule.enabled} loading={busyId === rule.id} disabled={busyId.length > 0 && busyId !== rule.id} aria-label={`${rule.enabled ? "停用" : "启用"}规则 ${rule.name}`} onChange={(enabled) => void toggle(rule, enabled)} /><Tag color={rule.enabled ? "green" : "default"}>{rule.enabled ? "已启用" : "已停用"}</Tag></Space> },
        { title: "逻辑", dataIndex: "logic", render: (value: AutomationRuleRecord["logic"]) => value === "all" ? "全部满足" : "任一满足" },
        { title: "来源设备", dataIndex: "sourceDeviceIds", render: (value: readonly string[]) => value.length === 0 ? <Tag>任意设备</Tag> : <Space wrap>{value.map((deviceId) => <Tag key={deviceId}>{deviceId}</Tag>)}</Space> },
        { title: "条件/动作", render: (_, rule) => `${rule.conditions.length} / ${rule.actions.length}` },
        { title: "冷却", dataIndex: "cooldownMs", render: (value: number) => `${value} ms` },
        { title: "最后触发", dataIndex: "lastTriggeredAt", render: (value: string | null) => value === null ? "从未触发" : new Date(value).toLocaleString() },
        { title: "操作", render: (_, rule) => <Popconfirm title="确认删除规则？" description={`规则 ${rule.name} 删除后无法恢复。`} okText="确认删除" cancelText="取消" onConfirm={() => remove(rule.id)}><Button danger size="small" loading={busyId === rule.id} disabled={busyId.length > 0 && busyId !== rule.id}>删除</Button></Popconfirm> }
      ]} />
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>展开行可查看条件和动作原始 JSON。</Typography.Paragraph>
    </Card>
  </Space>;
};
