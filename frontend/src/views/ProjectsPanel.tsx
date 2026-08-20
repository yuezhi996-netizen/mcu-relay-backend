import { CopyOutlined, DeleteOutlined, EditOutlined, EyeInvisibleOutlined, EyeOutlined, MoreOutlined, PlusOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Drawer, Dropdown, Form, Input, Modal, Space, Table, Tag, Tooltip, Typography, message, type MenuProps } from "antd";
import { useMemo, useState } from "react";
import { createTablePagination } from "../tablePagination";
import type { ProjectRecord } from "../types";

export type ProjectsPanelProps = {
  readonly projects: readonly ProjectRecord[];
  readonly selectedProjectId: string;
  readonly onCreate: (projectId: string, name: string, username: string, password: string) => Promise<void>;
  readonly onSelect: (projectId: string) => void;
  readonly onRename: (project: ProjectRecord, name: string) => Promise<void>;
  readonly onResetToken: (project: ProjectRecord) => Promise<void>;
  readonly onDelete: (project: ProjectRecord) => Promise<void>;
  readonly onOutput: (value: unknown) => void;
};

const copyText = async (value: string): Promise<void> => navigator.clipboard.writeText(value);

export const ProjectsPanel = ({ projects, selectedProjectId, onCreate, onSelect, onRename, onResetToken, onDelete, onOutput }: ProjectsPanelProps): JSX.Element => {
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [visibleTokens, setVisibleTokens] = useState<ReadonlySet<string>>(new Set());
  const [resettingProject, setResettingProject] = useState<ProjectRecord | null>(null);
  const [resetting, setResetting] = useState(false);
  const [deletingProject, setDeletingProject] = useState<ProjectRecord | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [renamingProject, setRenamingProject] = useState<ProjectRecord | null>(null);
  const [renamedProjectName, setRenamedProjectName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [search, setSearch] = useState("");
  const exists = useMemo(() => projects.some((project) => project.projectId === projectId.trim()), [projectId, projects]);
  const filteredProjects = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    if (query.length === 0) return projects;
    return projects.filter((project) => `${project.name}\n${project.projectId}`.toLocaleLowerCase("zh-CN").includes(query));
  }, [projects, search]);
  const create = async (): Promise<void> => {
    const createdProjectId = projectId.trim();
    setCreating(true);
    setCreateError("");
    try {
      await onCreate(createdProjectId, projectName.trim(), username.trim(), password);
      setProjectId("");
      setProjectName("");
      setUsername("");
      setPassword("");
      setCreateOpen(false);
      message.success("项目已创建并设为当前项目。");
      onSelect(createdProjectId);
    } catch (error: unknown) {
      setCreateError(error instanceof Error ? error.message : "项目创建失败。");
    } finally {
      setCreating(false);
    }
  };
  const copy = async (token: string): Promise<void> => {
    try {
      await copyText(token);
      onOutput({ ok: true, data: { copied: true } });
      message.success("项目令牌已复制");
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "复制失败。";
      onOutput({ ok: false, error: text });
      message.error(text);
    }
  };
  const toggleToken = (id: string): void => setVisibleTokens((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const resetToken = async (): Promise<void> => {
    if (resettingProject === null) return;
    setResetting(true);
    try {
      await onResetToken(resettingProject);
      setResettingProject(null);
    } finally {
      setResetting(false);
    }
  };
  const openDeleteConfirmation = (project: ProjectRecord): void => {
    setDeletingProject(project);
    setDeleteConfirmation("");
    setDeleteError("");
  };
  const closeDeleteConfirmation = (): void => {
    if (deleting) return;
    setDeletingProject(null);
    setDeleteConfirmation("");
    setDeleteError("");
  };
  const deleteProject = async (): Promise<void> => {
    if (deletingProject === null || deleteConfirmation !== deletingProject.projectId) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await onDelete(deletingProject);
      setDeletingProject(null);
      setDeleteConfirmation("");
    } catch (error: unknown) {
      setDeleteError(error instanceof Error ? error.message : "删除项目失败，请稍后重试。");
    } finally {
      setDeleting(false);
    }
  };
  const openRename = (project: ProjectRecord): void => {
    setRenamingProject(project);
    setRenamedProjectName(project.name);
    setRenameError("");
  };
  const closeRename = (): void => {
    if (renaming) return;
    setRenamingProject(null);
    setRenamedProjectName("");
    setRenameError("");
  };
  const renameProject = async (): Promise<void> => {
    if (renamingProject === null || renamedProjectName.trim().length === 0) return;
    setRenaming(true);
    setRenameError("");
    try {
      await onRename(renamingProject, renamedProjectName.trim());
      setRenamingProject(null);
      setRenamedProjectName("");
    } catch (error: unknown) {
      setRenameError(error instanceof Error ? error.message : "修改项目名称失败，请稍后重试。");
    } finally {
      setRenaming(false);
    }
  };
  const projectMenu = (project: ProjectRecord): MenuProps => ({
    items: [
      { key: "rename", icon: <EditOutlined />, label: "修改中文名称" },
      { key: "reset", icon: <SafetyCertificateOutlined />, label: "重置项目令牌" },
      { type: "divider" },
      { key: "delete", icon: <DeleteOutlined />, label: "永久删除项目", danger: true }
    ],
    onClick: ({ key }): void => {
      if (key === "rename") openRename(project);
      if (key === "reset") setResettingProject(project);
      if (key === "delete") openDeleteConfirmation(project);
    }
  });

  return <Card title={<Space><span>项目列表</span><Tag>{projects.length}</Tag></Space>} extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { setCreateError(""); setCreateOpen(true); }}>新建项目</Button>}>
    <Typography.Paragraph type="secondary">项目是设备、应用和自动化配置的业务边界。进入项目后，控制台和各功能页会自动切换到对应数据。</Typography.Paragraph>
    <div className="panel-toolbar">
      <div className="panel-toolbar-main"><Input.Search value={search} onChange={(event) => setSearch(event.target.value)} allowClear placeholder="搜索项目名称或项目 ID" aria-label="搜索项目名称或项目 ID" style={{ width: 380 }} /></div>
      <Typography.Text type="secondary">显示 {filteredProjects.length} 个，共 {projects.length} 个项目</Typography.Text>
    </div>
    <Table<ProjectRecord> rowKey="projectId" size="middle" pagination={createTablePagination(10)} scroll={{ x: 1160 }} dataSource={[...filteredProjects]} locale={{ emptyText: projects.length === 0 ? "还没有项目，点击右上角新建项目。" : "没有匹配的项目，请调整搜索条件。" }} columns={[
      { title: "项目名称", dataIndex: "name", render: (value: string, project) => <Space direction="vertical" size={0}><Typography.Text strong>{value}</Typography.Text>{project.projectId === selectedProjectId ? <Typography.Text type="success">当前项目</Typography.Text> : null}</Space> },
      { title: "项目 ID", dataIndex: "projectId", render: (value: string) => <Typography.Text code copyable={{ text: value }}>{value}</Typography.Text> },
      { title: "绑定账号", render: (_, project) => project.account === null || project.account === undefined ? <Typography.Text type="secondary">未配置</Typography.Text> : <Typography.Text code copyable={{ text: project.account.username }}>{project.account.username}</Typography.Text> },
      { title: "登录密码", render: (_, project) => project.account === null || project.account === undefined ? <Typography.Text type="secondary">未配置</Typography.Text> : <Space size="small"><Typography.Text code>{visibleTokens.has(`account:${project.projectId}`) ? project.account.password : "••••••••"}</Typography.Text><Tooltip title={visibleTokens.has(`account:${project.projectId}`) ? "隐藏" : "显示"}><Button type="text" size="small" icon={visibleTokens.has(`account:${project.projectId}`) ? <EyeInvisibleOutlined /> : <EyeOutlined />} onClick={() => toggleToken(`account:${project.projectId}`)} aria-label={visibleTokens.has(`account:${project.projectId}`) ? "隐藏项目登录密码" : "显示项目登录密码"} /></Tooltip><Tooltip title="复制"><Button type="text" size="small" icon={<CopyOutlined />} onClick={() => void copy(project.account?.password ?? "")} aria-label="复制项目登录密码" /></Tooltip></Space> },
      { title: "项目令牌", render: (_, project) => <Space size="small"><Typography.Text code>{visibleTokens.has(project.projectId) ? project.token : `${project.token.slice(0, 8)}…`}</Typography.Text><Tooltip title={visibleTokens.has(project.projectId) ? "隐藏" : "显示"}><Button type="text" size="small" icon={visibleTokens.has(project.projectId) ? <EyeInvisibleOutlined /> : <EyeOutlined />} onClick={() => toggleToken(project.projectId)} aria-label={visibleTokens.has(project.projectId) ? "隐藏项目令牌" : "显示项目令牌"} /></Tooltip><Tooltip title="复制"><Button type="text" size="small" icon={<CopyOutlined />} onClick={() => void copy(project.token)} aria-label="复制项目令牌" /></Tooltip></Space> },
      { title: "创建时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() },
      { title: "操作", width: 190, fixed: "right", render: (_, project) => <Space><Button size="small" type={project.projectId === selectedProjectId ? "default" : "primary"} onClick={() => onSelect(project.projectId)}>{project.projectId === selectedProjectId ? "返回控制台" : "进入工作台"}</Button><Dropdown menu={projectMenu(project)} placement="bottomRight" trigger={["click"]}><Button size="small" icon={<MoreOutlined />} aria-label={`管理项目 ${project.name}`} /></Dropdown></Space> }
    ]} rowClassName={(project) => project.projectId === selectedProjectId ? "ant-table-row-selected" : ""} />

    <Drawer title="新建项目" open={createOpen} width={480} destroyOnClose={false} onClose={() => { if (!creating) setCreateOpen(false); }} extra={<Button type="primary" loading={creating} disabled={projectName.trim().length === 0 || projectId.trim().length === 0 || username.trim().length === 0 || password.length === 0 || exists} onClick={() => void create()}>创建并进入</Button>}>
      <Typography.Paragraph type="secondary">中文名称用于后台展示；项目 ID 是固件和 App 的稳定协议身份，创建后不应通过改名来变更。</Typography.Paragraph>
      {createError.length === 0 ? null : <Alert type="error" showIcon message="项目创建失败" description={createError} style={{ marginBottom: 16 }} />}
      <Form layout="vertical" onFinish={() => void create()}>
        <Form.Item label="项目中文名称" required><Input value={projectName} maxLength={100} onChange={(event) => { setProjectName(event.target.value); setCreateError(""); }} placeholder="例如 STM32远程继电器控制" aria-label="项目中文名称" /></Form.Item>
        <Form.Item label="项目 ID" required validateStatus={exists ? "error" : ""} help={exists ? "项目已存在" : "建议使用小写字母、数字和下划线，例如 greenhouse_001"}><Input value={projectId} maxLength={100} onChange={(event) => { setProjectId(event.target.value); setCreateError(""); }} placeholder="例如 greenhouse_001" aria-label="项目 ID" /></Form.Item>
        <Form.Item label="项目登录账号" required extra="此账号只能登录和访问当前项目。"><Input value={username} maxLength={100} autoComplete="username" onChange={(event) => { setUsername(event.target.value); setCreateError(""); }} placeholder="例如 greenhouse_owner" aria-label="项目登录账号" /></Form.Item>
        <Form.Item label="项目登录密码" required><Input.Password value={password} maxLength={256} autoComplete="new-password" onChange={(event) => { setPassword(event.target.value); setCreateError(""); }} placeholder="设置项目登录密码" aria-label="项目登录密码" /></Form.Item>
        <Button htmlType="submit" style={{ display: "none" }} aria-hidden="true" />
      </Form>
    </Drawer>
    <Modal title="修改项目中文名称" open={renamingProject !== null} okText="保存" cancelText="取消" okButtonProps={{ disabled: renamedProjectName.trim().length === 0 }} cancelButtonProps={{ disabled: renaming }} confirmLoading={renaming} closable={!renaming} maskClosable={false} onOk={() => void renameProject()} onCancel={closeRename}>
      <Typography.Paragraph type="secondary">项目 ID 保持为 <Typography.Text code>{renamingProject?.projectId}</Typography.Text>，只修改后台显示名称。</Typography.Paragraph>
      <Input value={renamedProjectName} status={renameError.length > 0 ? "error" : undefined} disabled={renaming} onChange={(event) => { setRenamedProjectName(event.target.value); setRenameError(""); }} onPressEnter={() => void renameProject()} placeholder="输入项目中文名称" aria-label="修改项目中文名称" autoComplete="off" />
      {renameError.length > 0 ? <Typography.Paragraph type="danger" role="alert" style={{ margin: "8px 0 0" }}>{renameError}</Typography.Paragraph> : null}
    </Modal>
    <Modal title="重置项目令牌" open={resettingProject !== null} okText="确认重置" cancelText="取消" confirmLoading={resetting} closable={!resetting} maskClosable={false} onOk={() => void resetToken()} onCancel={() => { if (!resetting) setResettingProject(null); }}>
      <Alert type="warning" showIcon message="旧令牌会立即失效" description={`项目 ${resettingProject?.name ?? ""} 的设备和 App 必须改用新令牌后才能继续访问。`} />
    </Modal>
    <Modal title="永久删除项目" open={deletingProject !== null} okText="永久删除" cancelText="取消" okButtonProps={{ danger: true, disabled: deletingProject === null || deleteConfirmation !== deletingProject.projectId }} cancelButtonProps={{ disabled: deleting }} confirmLoading={deleting} closable={!deleting} maskClosable={false} onOk={() => void deleteProject()} onCancel={closeDeleteConfirmation}>
      <Alert type="error" showIcon message="此操作不可撤销" description="项目关联的设备数据、命令、规则、代理访问密钥、网络回调、固件和远程升级任务都会一起删除。" style={{ marginBottom: 16 }} />
      <Typography.Paragraph>请输入项目 ID <Typography.Text code copyable>{deletingProject?.projectId}</Typography.Text> 以确认删除：</Typography.Paragraph>
      <Input value={deleteConfirmation} status={deleteError.length > 0 ? "error" : undefined} disabled={deleting} onChange={(event) => { setDeleteConfirmation(event.target.value); setDeleteError(""); }} onPressEnter={() => void deleteProject()} placeholder="完整输入项目 ID" aria-label="输入项目 ID 确认永久删除" autoComplete="off" />
      {deleteError.length > 0 ? <Typography.Paragraph type="danger" role="alert" style={{ margin: "8px 0 0" }}>{deleteError}</Typography.Paragraph> : null}
    </Modal>
  </Card>;
};
