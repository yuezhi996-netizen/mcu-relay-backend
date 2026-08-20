import { Alert, Button, Card, Col, Descriptions, Form, Input, InputNumber, Popconfirm, Progress, Row, Select, Space, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { addFirmware, createOtaTask, deleteFirmware, getOtaTask, listFirmware } from "../../automation/api";
import { parseHttpUrl, type FirmwareInput, type FirmwareRecord, type OtaStatus, type OtaTask, type ProjectAccess } from "../../automation/models";
import { createTablePagination } from "../../tablePagination";
import type { DeviceRecord } from "../../types";
import { DeviceSelect } from "../DeviceSelect";

type FirmwareFormValues = {
  readonly version: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly md5: string;
  readonly downloadUrl: string;
};
export type FirmwareOtaPanelProps = {
  readonly project: ProjectAccess;
  readonly devices: readonly DeviceRecord[];
};

const otaStatus = (status: OtaStatus): { readonly color: string; readonly label: string } => {
  if (status === "success") return { color: "green", label: "成功" };
  if (status === "failed") return { color: "red", label: "失败" };
  if (status === "downloading") return { color: "blue", label: "下载中" };
  if (status === "installing") return { color: "purple", label: "安装中" };
  return { color: "gold", label: "等待设备" };
};

export const FirmwareOtaPanel = ({ project, devices }: FirmwareOtaPanelProps): JSX.Element => {
  const [form] = Form.useForm<FirmwareFormValues>();
  const [firmware, setFirmware] = useState<readonly FirmwareRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [firmwareId, setFirmwareId] = useState("");
  const [otaId, setOtaId] = useState("");
  const [otaTask, setOtaTask] = useState<OtaTask | null>(null);
  const [otaBusy, setOtaBusy] = useState<"create" | "query" | "">("");
  const [otaError, setOtaError] = useState("");
  const [search, setSearch] = useState("");
  const filteredFirmware = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    if (query.length === 0) return firmware;
    return firmware.filter((item) => `${item.version}\n${item.fileName}\n${item.md5}\n${item.downloadUrl}`.toLocaleLowerCase("zh-CN").includes(query));
  }, [firmware, search]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      setFirmware(await listFirmware(project));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "固件列表加载失败。");
    } finally {
      setLoading(false);
    }
  }, [project]);
  useEffect(() => {
    setDeviceId("");
    setFirmwareId("");
    setOtaId("");
    setOtaTask(null);
    void load();
  }, [load]);

  const add = async (values: FirmwareFormValues): Promise<void> => {
    setAdding(true);
    setError("");
    try {
      const input: FirmwareInput = {
        version: values.version.trim(),
        fileName: values.fileName.trim(),
        fileSize: values.fileSize,
        md5: values.md5.trim(),
        downloadUrl: parseHttpUrl(values.downloadUrl, "固件下载地址")
      };
      await addFirmware(project, input);
      form.resetFields();
      await load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "固件添加失败。");
    } finally {
      setAdding(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setDeletingId(id);
    setError("");
    try {
      await deleteFirmware(project, id);
      setFirmware((current) => current.filter((item) => item.id !== id));
      if (firmwareId === id) setFirmwareId("");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "固件删除失败。");
    } finally {
      setDeletingId("");
    }
  };

  const createOta = async (): Promise<void> => {
    if (deviceId.length === 0 || firmwareId.length === 0) {
      setOtaError("请选择目标设备和固件。");
      return;
    }
    setOtaBusy("create");
    setOtaError("");
    try {
      const task = await createOtaTask(project, deviceId, firmwareId);
      setOtaTask(task);
      setOtaId(task.id);
    } catch (reason: unknown) {
      setOtaError(reason instanceof Error ? reason.message : "远程升级任务创建失败。");
    } finally {
      setOtaBusy("");
    }
  };

  const queryOta = async (): Promise<void> => {
    if (deviceId.length === 0 || otaId.trim().length === 0) {
      setOtaError("请选择目标设备并输入升级任务 ID。");
      return;
    }
    setOtaBusy("query");
    setOtaError("");
    try {
      setOtaTask(await getOtaTask(project, deviceId, otaId.trim()));
    } catch (reason: unknown) {
      setOtaError(reason instanceof Error ? reason.message : "远程升级状态查询失败。");
    } finally {
      setOtaBusy("");
    }
  };

  return <Space direction="vertical" size="middle" style={{ display: "flex" }}>
    {error.length > 0 ? <Alert type="error" showIcon message="固件操作失败" description={error} closable onClose={() => setError("")} /> : null}
    <Card title="添加固件信息">
      <Form<FirmwareFormValues> form={form} layout="vertical" onFinish={(values) => void add(values)}>
        <Row gutter={16}>
          <Col xs={24} sm={12} lg={6}><Form.Item name="version" label="版本" rules={[{ required: true, whitespace: true, message: "请输入固件版本。" }]}><Input placeholder="1.0.0" /></Form.Item></Col>
          <Col xs={24} sm={12} lg={6}><Form.Item name="fileName" label="文件名" rules={[{ required: true, whitespace: true, message: "请输入固件文件名。" }]}><Input placeholder="firmware.bin" /></Form.Item></Col>
          <Col xs={24} sm={12} lg={6}><Form.Item name="fileSize" label="文件大小（字节）" rules={[{ required: true, message: "请输入文件大小。" }]}><InputNumber min={0} precision={0} style={{ width: "100%" }} /></Form.Item></Col>
          <Col xs={24} sm={12} lg={6}><Form.Item name="md5" label="文件校验值（MD5）" rules={[{ required: true, whitespace: true, message: "请输入文件校验值。" }]}><Input placeholder="32 位十六进制摘要" /></Form.Item></Col>
        </Row>
        <Form.Item name="downloadUrl" label="固件下载地址" extra="设备执行远程升级时会从该 HTTP/HTTPS 地址下载固件，地址不能包含账号密码。" rules={[{ required: true, whitespace: true, message: "请输入固件下载地址。" }]}><Input placeholder="https://example.com/firmware.bin" /></Form.Item>
        <Button type="primary" htmlType="submit" loading={adding}>添加固件</Button>
      </Form>
    </Card>
    <Card title="固件列表">
      <div className="panel-toolbar"><div className="panel-toolbar-main"><Input.Search value={search} allowClear onChange={(event) => setSearch(event.target.value)} placeholder="搜索版本、文件名、校验值或下载地址" aria-label="搜索固件" style={{ width: 380 }} /></div><Space><Typography.Text type="secondary">显示 {filteredFirmware.length} / {firmware.length}</Typography.Text><Button onClick={() => void load()} loading={loading}>刷新</Button></Space></div>
      <Table<FirmwareRecord> rowKey="id" size="small" loading={loading} pagination={createTablePagination(10)} scroll={{ x: 980 }} dataSource={[...filteredFirmware]} locale={{ emptyText: firmware.length === 0 ? "当前项目还没有固件信息。" : "没有匹配的固件。" }} columns={[
        { title: "版本", dataIndex: "version" },
        { title: "文件", dataIndex: "fileName" },
        { title: "大小", dataIndex: "fileSize", render: (value: number) => `${value.toLocaleString()} B` },
        { title: "文件校验值", dataIndex: "md5", render: (value: string) => <Typography.Text code copyable={{ text: value }}>{value}</Typography.Text> },
        { title: "下载地址", dataIndex: "downloadUrl", render: (value: string) => <Typography.Text code copyable={{ text: value }} ellipsis={{ tooltip: value }} style={{ maxWidth: 280 }}>{value}</Typography.Text> },
        { title: "添加时间", dataIndex: "uploadedAt", render: (value: string) => new Date(value).toLocaleString() },
        { title: "操作", render: (_, item) => <Popconfirm title="确认删除固件信息？" description={`${item.version} / ${item.fileName} 删除后无法用于新的远程升级任务。`} okText="确认删除" cancelText="取消" onConfirm={() => remove(item.id)}><Button danger size="small" loading={deletingId === item.id} disabled={deletingId.length > 0 && deletingId !== item.id}>删除</Button></Popconfirm> }
      ]} />
    </Card>
    <Card title="远程升级任务（OTA）">
      {otaError.length > 0 ? <Alert type="error" showIcon message="远程升级操作失败" description={otaError} closable onClose={() => setOtaError("")} style={{ marginBottom: 16 }} /> : null}
      <Space direction="vertical" size="middle" style={{ display: "flex" }}>
        <DeviceSelect devices={devices} value={deviceId} onChange={setDeviceId} ariaLabel="远程升级目标设备" />
        <Select showSearch optionFilterProp="label" value={firmwareId || undefined} onChange={setFirmwareId} placeholder="搜索或选择固件版本" aria-label="远程升级固件版本" style={{ width: "100%", maxWidth: 360 }} options={firmware.map((item) => ({ value: item.id, label: `${item.version} / ${item.fileName}` }))} />
        <Button type="primary" onClick={() => void createOta()} loading={otaBusy === "create"} disabled={otaBusy === "query"}>创建远程升级任务</Button>
        <Space.Compact style={{ width: "100%", maxWidth: 520 }}><Input value={otaId} onChange={(event) => setOtaId(event.target.value)} placeholder="输入升级任务 ID 查询状态" aria-label="升级任务 ID" /><Button onClick={() => void queryOta()} loading={otaBusy === "query"} disabled={otaBusy === "create"}>查询状态</Button></Space.Compact>
        {otaTask === null ? null : <div>
          <Space style={{ marginBottom: 12 }}><Typography.Text strong>升级状态</Typography.Text><Tag color={otaStatus(otaTask.status).color}>{otaStatus(otaTask.status).label}</Tag></Space>
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }} items={[
            { key: "otaId", label: "升级任务 ID", children: <Typography.Text code copyable={{ text: otaTask.id }}>{otaTask.id}</Typography.Text> },
            { key: "deviceId", label: "设备 ID", children: <Typography.Text code>{otaTask.deviceId}</Typography.Text> },
            { key: "createdAt", label: "创建时间", children: new Date(otaTask.createdAt).toLocaleString() },
            { key: "completedAt", label: "完成时间", children: otaTask.completedAt === null ? "尚未完成" : new Date(otaTask.completedAt).toLocaleString() }
          ]} />
          <Progress percent={otaTask.progress} status={otaTask.status === "failed" ? "exception" : otaTask.status === "success" ? "success" : "active"} style={{ marginTop: 16 }} />
        </div>}
      </Space>
    </Card>
  </Space>;
};
