import { ApiOutlined, BookOutlined, CloudServerOutlined, DashboardOutlined, DatabaseOutlined, DeploymentUnitOutlined, LogoutOutlined, MenuOutlined, MoonOutlined, MoreOutlined, ReloadOutlined, SendOutlined, SettingOutlined, SunOutlined, ThunderboltOutlined, UsbOutlined, UserOutlined } from "@ant-design/icons";
import { Badge, Button, Descriptions, Drawer, Dropdown, Grid, Layout, Menu, Popover, Select, Space, Spin, Tooltip, Typography, type MenuProps } from "antd";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { clearAdminSession, clearConsoleSession, readAdminSession, readConsoleSession, saveConsoleSession, type ConsoleSession } from "./adminSession";
import { requestJson, subscribeServerStatus } from "./api/client";
import { formatTcpGatewayAddress, useHealth } from "./hooks/useHealth";
import { AdminRoute, type AdminTabKey } from "./routes/AdminRoute";
import type { ThemeMode } from "./theme";
import type { ProjectRecord, ProjectUserSession } from "./types";
import { AdminLogin } from "./views/AdminLogin";

const { Header, Content, Sider } = Layout;
type AppProps = { readonly mode: ThemeMode; readonly onToggleTheme: () => void };
type NavigationKey = AdminTabKey | "docs";
type AdminAuthState = "checking" | "required" | "authenticated";
type PageMeta = { readonly title: string; readonly description: string };

const DocsRoute = lazy(async () => {
  const module = await import("./routes/DocsRoute");
  return { default: module.DocsRoute };
});

const adminTabs: readonly AdminTabKey[] = ["dashboard", "projects", "accounts", "operations", "devices", "commands", "events", "automation", "serial"];
const navigationItems: MenuProps["items"] = [
  {
    key: "workspace",
    type: "group",
    label: "工作台",
    children: [
      { key: "dashboard", icon: <DashboardOutlined />, label: "控制台" },
      { key: "projects", icon: <DatabaseOutlined />, label: "项目管理" },
      { key: "accounts", icon: <UserOutlined />, label: "用户审核" },
      { key: "operations", icon: <DeploymentUnitOutlined />, label: "运维中心" }
    ]
  },
  {
    key: "device-business",
    type: "group",
    label: "设备业务",
    children: [
      { key: "devices", icon: <CloudServerOutlined />, label: "设备数据" },
      { key: "commands", icon: <SendOutlined />, label: "命令控制" },
      { key: "events", icon: <ThunderboltOutlined />, label: "实时事件" }
    ]
  },
  {
    key: "capabilities",
    type: "group",
    label: "能力与支持",
    children: [
      { key: "automation", icon: <SettingOutlined />, label: "自动化与升级" },
      { key: "serial", icon: <UsbOutlined />, label: "远程调试" },
      { key: "docs", icon: <BookOutlined />, label: "接口文档" }
    ]
  }
];
const projectUserNavigationItems: MenuProps["items"] = [
  { key: "workspace", type: "group", label: "工作台", children: [{ key: "dashboard", icon: <DashboardOutlined />, label: "控制台" }] },
  { key: "device-business", type: "group", label: "设备业务", children: [{ key: "devices", icon: <CloudServerOutlined />, label: "设备数据" }, { key: "commands", icon: <SendOutlined />, label: "命令控制" }, { key: "events", icon: <ThunderboltOutlined />, label: "实时事件" }] },
  { key: "capabilities", type: "group", label: "支持", children: [{ key: "docs", icon: <BookOutlined />, label: "接口文档" }] }
];
const pageMeta: Readonly<Record<NavigationKey, PageMeta>> = {
  dashboard: { title: "控制台", description: "查看当前项目的设备、命令、报警和自动化态势" },
  projects: { title: "项目管理", description: "管理项目身份、显示名称、项目账号和接入令牌" },
  accounts: { title: "用户审核", description: "审核注册申请并查看项目绑定账号" },
  operations: { title: "运维中心", description: "检查服务、网关、资源和命令生命周期" },
  devices: { title: "设备数据", description: "搜索设备并查看实时遥测、继电器与报警状态" },
  commands: { title: "命令控制", description: "下发单台或批量命令，并跟踪确认结果" },
  events: { title: "实时事件", description: "观察当前项目的设备、命令和自动化事件" },
  automation: { title: "自动化与升级", description: "配置规则、回调、代理密钥和远程升级" },
  serial: { title: "远程调试", description: "建立设备调试会话并收发串口数据" },
  docs: { title: "接口文档", description: "查看设备、应用和管理端的接入协议" }
};

const readAppTab = (): AdminTabKey => {
  const tab = new URLSearchParams(window.location.search).get("tab");
  return adminTabs.includes(tab as AdminTabKey) ? tab as AdminTabKey : "dashboard";
};
const isAdminCredentialError = (messageText: string): boolean => messageText.startsWith("ADMIN_TOKEN_REQUIRED:") || messageText.startsWith("INVALID_ADMIN_TOKEN:");

type NavigationPanelProps = {
  readonly selectedKey: NavigationKey;
  readonly collapsed: boolean;
  readonly tcpGatewayAddress: string;
  readonly items: MenuProps["items"];
  readonly onNavigate: (key: NavigationKey) => void;
};

const NavigationPanel = ({ selectedKey, collapsed, tcpGatewayAddress, items, onNavigate }: NavigationPanelProps): JSX.Element => <div className="app-navigation">
  <div className={collapsed ? "app-brand app-brand-collapsed" : "app-brand"}>
    <ThunderboltOutlined className="app-brand-icon" />
    {collapsed ? null : <div><Typography.Text strong className="app-brand-title">单片机中转后台</Typography.Text><Typography.Text className="app-brand-subtitle">MCU Relay Console</Typography.Text></div>}
  </div>
  <Menu className="app-navigation-menu" theme="dark" mode="inline" selectedKeys={[selectedKey]} onClick={({ key }) => onNavigate(key as NavigationKey)} items={items} />
  {collapsed ? null : <div className="app-navigation-footer"><Typography.Text>TCP 设备网关</Typography.Text><Typography.Text code copyable={{ text: tcpGatewayAddress }}>{tcpGatewayAddress}</Typography.Text></div>}
</div>;

const App = ({ mode, onToggleTheme }: AppProps): JSX.Element => {
  const screens = Grid.useBreakpoint();
  const isDesktop = screens.lg === true;
  const [path, setPath] = useState(window.location.pathname);
  const [activeTab, setActiveTab] = useState<AdminTabKey>(readAppTab);
  const [projects, setProjects] = useState<readonly ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [eventStatus, setEventStatus] = useState("未连接");
  const [serverStatus, setServerStatus] = useState("连接中");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [session, setSession] = useState<ConsoleSession | null>(() => readConsoleSession(window.sessionStorage) ?? (() => {
    const legacyAdminToken = readAdminSession(window.sessionStorage);
    return legacyAdminToken.length === 0 ? null : { role: "admin", token: legacyAdminToken };
  })());
  const [adminAuthState, setAdminAuthState] = useState<AdminAuthState>("checking");
  const [adminLoginLoading, setAdminLoginLoading] = useState(false);
  const [adminLoginError, setAdminLoginError] = useState("");
  const [loginNotice, setLoginNotice] = useState("");
  const [refreshCurrent, setRefreshCurrent] = useState<() => Promise<void>>(() => async (): Promise<void> => undefined);
  const [refreshing, setRefreshing] = useState(false);
  const health = useHealth();
  const tcpGatewayAddress = formatTcpGatewayAddress(health, window.location.hostname);
  const adminToken = session?.role === "admin" ? session.token : "";
  const projectUserSessionToken = session?.role === "project_user" ? session.token : "";
  const isProjectUser = session?.role === "project_user";

  useEffect(() => subscribeServerStatus((status) => setServerStatus(status === "running" ? "运行中" : status === "connecting" ? "连接中" : "异常")), []);
  useEffect(() => {
    if (path === "/docs" || adminAuthState !== "checking") return;
    let active = true;
    const headers: Readonly<Record<string, string>> = isProjectUser ? { authorization: `Bearer ${projectUserSessionToken}` } : adminToken.length === 0 ? {} : { "x-admin-token": adminToken };
    const url = isProjectUser ? "/api/v1/auth/me" : "/api/v1/projects";
    void requestJson<unknown>(url, { method: "GET", body: null, headers }).then(() => {
      if (active) setAdminAuthState("authenticated");
    }).catch((error: unknown) => {
      if (!active) return;
      const errorText = error instanceof Error ? error.message : "管理员登录检查失败。";
      if (isAdminCredentialError(errorText) || isProjectUser) {
        clearAdminSession(window.sessionStorage);
        clearConsoleSession(window.sessionStorage);
        setSession(null);
      }
      setAdminLoginError(isAdminCredentialError(errorText) || isProjectUser ? "" : "无法连接服务器，请检查网络后重试。");
      setAdminAuthState("required");
    });
    return (): void => {
      active = false;
    };
  }, [adminAuthState, adminToken, isProjectUser, path, projectUserSessionToken]);
  useEffect(() => {
    const sync = (): void => {
      setPath(window.location.pathname);
      setActiveTab(readAppTab());
    };
    window.addEventListener("popstate", sync);
    return (): void => window.removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    if (!isProjectUser || ["dashboard", "devices", "commands", "events"].includes(activeTab)) return;
    window.history.replaceState({}, "", "/admin?tab=dashboard");
    setPath("/admin");
    setActiveTab("dashboard");
  }, [activeTab, isProjectUser]);

  const navigate = useCallback((key: NavigationKey): void => {
    setMobileNavigationOpen(false);
    if (key === "docs") {
      window.history.pushState({}, "", "/docs");
      setPath("/docs");
      return;
    }
    window.history.pushState({}, "", `/admin?tab=${key}`);
    setPath("/admin");
    setActiveTab(key);
  }, []);
  const updateRefresh = useCallback((refresh: () => Promise<void>): void => setRefreshCurrent(() => refresh), []);
  const requireAdminPassword = useCallback((): void => {
    clearAdminSession(window.sessionStorage);
    clearConsoleSession(window.sessionStorage);
    setSession(null);
    setAdminLoginError(isProjectUser ? "登录已失效，请重新登录项目账号。" : "登录已失效，请重新输入管理员密码。");
    setAdminAuthState("required");
  }, [isProjectUser]);
  const loginAdmin = useCallback(async (password: string): Promise<void> => {
    const value = password.trim();
    if (value.length === 0) return;
    setAdminLoginLoading(true);
    setAdminLoginError("");
    try {
      await requestJson<readonly ProjectRecord[]>("/api/v1/projects", { method: "GET", body: null, headers: { "x-admin-token": value } });
      clearAdminSession(window.sessionStorage);
      saveConsoleSession(window.sessionStorage, { role: "admin", token: value });
      setSession({ role: "admin", token: value });
      setAdminAuthState("authenticated");
    } catch (error: unknown) {
      const errorText = error instanceof Error ? error.message : "管理员登录失败。";
      setAdminLoginError(isAdminCredentialError(errorText) ? "管理员密码错误，请重新输入。" : "无法连接服务器，请稍后重试。");
    } finally {
      setAdminLoginLoading(false);
    }
  }, []);
  const loginProjectUser = useCallback(async (username: string, password: string): Promise<void> => {
    setAdminLoginLoading(true);
    setAdminLoginError("");
    setLoginNotice("");
    try {
      const response = await requestJson<ProjectUserSession>("/api/v1/auth/login", { method: "POST", body: { username, password }, headers: {} });
      const nextSession: ConsoleSession = { role: "project_user", token: response.data.sessionToken, projectId: response.data.user.projectId, username: response.data.user.username };
      clearAdminSession(window.sessionStorage);
      saveConsoleSession(window.sessionStorage, nextSession);
      setSession(nextSession);
      setAdminAuthState("authenticated");
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "项目用户登录失败。";
      setAdminLoginError(text.startsWith("ACCOUNT_PENDING_REVIEW:") ? "注册申请正在等待管理员审核。" : text.startsWith("ACCOUNT_REJECTED:") ? "注册申请未获通过，请联系管理员。" : "账号或密码错误，请重新输入。");
    } finally {
      setAdminLoginLoading(false);
    }
  }, []);
  const registerProjectUser = useCallback(async (projectId: string, projectName: string, username: string, password: string): Promise<void> => {
    setAdminLoginLoading(true);
    setAdminLoginError("");
    setLoginNotice("");
    try {
      await requestJson<unknown>("/api/v1/auth/register", { method: "POST", body: { projectId, projectName, username, password }, headers: {} });
      setLoginNotice("已提交，管理员审核通过后即可使用项目账号登录。");
    } catch (error: unknown) {
      setAdminLoginError(error instanceof Error ? error.message : "注册申请提交失败。请稍后重试。");
    } finally {
      setAdminLoginLoading(false);
    }
  }, []);
  const logout = useCallback((): void => {
    clearAdminSession(window.sessionStorage);
    clearConsoleSession(window.sessionStorage);
    setSession(null);
    setProjects([]);
    setSelectedProjectId("");
    setEventStatus("未连接");
    setAdminLoginError("");
    setLoginNotice("");
    setAdminAuthState("required");
  }, []);
  const refresh = useCallback(async (): Promise<void> => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshCurrent();
    } finally {
      setRefreshing(false);
    }
  }, [refreshCurrent, refreshing]);

  const isDocs = path === "/docs";
  const selectedNavigationKey: NavigationKey = isDocs ? "docs" : activeTab;
  const currentPage = pageMeta[selectedNavigationKey];
  const healthBadge = health.status === "healthy" ? health.tcpGateway === "listening" ? "success" : "warning" : health.status === "error" ? "error" : "processing";
  const healthText = health.status === "healthy" ? health.tcpGateway === "listening" ? "服务正常" : "TCP 网关异常" : health.status === "error" ? "服务异常" : "正在检查";
  const projectOptions = useMemo(() => projects.map((project) => ({ value: project.projectId, label: project.name, title: `${project.name}（${project.projectId}）` })), [projects]);
  const moreItems: MenuProps["items"] = isDocs ? [
    { key: "theme", icon: mode === "dark" ? <SunOutlined /> : <MoonOutlined />, label: mode === "dark" ? "切换至浅色模式" : "切换至深色模式" }
  ] : [
    { key: "api", icon: <ApiOutlined />, label: "查看最近接口返回" },
    { key: "theme", icon: mode === "dark" ? <SunOutlined /> : <MoonOutlined />, label: mode === "dark" ? "切换至浅色模式" : "切换至深色模式" },
    { type: "divider" },
    { key: "logout", icon: <LogoutOutlined />, label: "退出登录", danger: true }
  ];
  const runMoreAction = ({ key }: { readonly key: string }): void => {
    if (key === "api") setDrawerOpen(true);
    if (key === "theme") onToggleTheme();
    if (key === "logout") logout();
  };

  if (!isDocs && adminAuthState === "checking") return <div className={`app-auth-loading app-theme-${mode}`}><Space direction="vertical" align="center"><Spin size="large" /><Typography.Text type="secondary">正在检查登录状态…</Typography.Text></Space></div>;
  if (!isDocs && adminAuthState === "required") return <AdminLogin mode={mode} loading={adminLoginLoading} error={adminLoginError} notice={loginNotice} onAdminLogin={loginAdmin} onUserLogin={loginProjectUser} onRegister={registerProjectUser} />;

  const statusDetails = <Descriptions size="small" column={1} className="app-status-details" items={[
    { key: "server", label: "HTTP 服务", children: <Badge status={serverStatus === "运行中" ? "success" : serverStatus === "异常" ? "error" : "processing"} text={serverStatus} /> },
    { key: "health", label: "就绪检查", children: <Badge status={healthBadge} text={healthText} /> },
    { key: "events", label: "项目事件流", children: <Badge status={eventStatus === "已连接" ? "success" : eventStatus === "已断开" ? "error" : "processing"} text={eventStatus} /> },
    { key: "tcp", label: "TCP 地址", children: <Typography.Text code copyable={{ text: tcpGatewayAddress }}>{tcpGatewayAddress}</Typography.Text> }
  ]} />;

  return <Layout className={`app-shell app-theme-${mode}`}>
    {isDesktop ? <Sider collapsible collapsed={desktopCollapsed} collapsedWidth={76} onCollapse={setDesktopCollapsed} width={248} className="app-sider"><NavigationPanel selectedKey={selectedNavigationKey} collapsed={desktopCollapsed} tcpGatewayAddress={tcpGatewayAddress} items={isProjectUser ? projectUserNavigationItems : navigationItems} onNavigate={navigate} /></Sider> : <Drawer placement="left" width={288} open={mobileNavigationOpen} onClose={() => setMobileNavigationOpen(false)} closable={false} styles={{ body: { padding: 0, background: "#07111f" } }}><NavigationPanel selectedKey={selectedNavigationKey} collapsed={false} tcpGatewayAddress={tcpGatewayAddress} items={isProjectUser ? projectUserNavigationItems : navigationItems} onNavigate={navigate} /></Drawer>}
    <Layout className="app-main-layout">
      <Header className={isDocs ? "app-topbar app-topbar-docs" : "app-topbar"}>
        <div className="app-page-context">
          {isDesktop ? null : <Button type="text" icon={<MenuOutlined />} aria-label="打开导航" onClick={() => setMobileNavigationOpen(true)} />}
          <div className="app-page-heading"><Typography.Title level={4}>{currentPage.title}</Typography.Title><Typography.Text type="secondary">{currentPage.description}</Typography.Text></div>
        </div>
        {isDocs ? null : <div className="app-project-context"><Typography.Text type="secondary">当前项目</Typography.Text><Select value={selectedProjectId || undefined} placeholder={projects.length === 0 ? "暂无项目" : "搜索或选择项目"} showSearch allowClear={false} notFoundContent="没有匹配的项目" filterOption={(input, option) => {
          const query = input.trim().toLocaleLowerCase("zh-CN");
          const name = typeof option?.label === "string" ? option.label : "";
          const id = typeof option?.value === "string" ? option.value : "";
          return `${name}\n${id}`.toLocaleLowerCase("zh-CN").includes(query);
        }} optionRender={(option) => <div className="app-project-option"><span>{String(option.label)}</span><Typography.Text type="secondary" ellipsis>{String(option.value)}</Typography.Text></div>} options={projectOptions} onChange={setSelectedProjectId} aria-label="搜索或选择当前项目" /></div>}
        <Space className="app-topbar-actions" size="small">
          {isDocs ? null : <Popover title="系统运行状态" content={statusDetails} trigger="click" placement="bottomRight"><Button type="text" className="app-status-button"><Badge status={healthBadge} text={healthText} /></Button></Popover>}
          {isDocs ? null : <Tooltip title="刷新当前页面"><Button type="text" icon={<ReloadOutlined spin={refreshing} />} disabled={refreshing} onClick={() => void refresh()} aria-label="刷新当前页面" /></Tooltip>}
          <Dropdown menu={{ items: moreItems, onClick: runMoreAction }} placement="bottomRight" trigger={["click"]}><Button type="text" icon={<MoreOutlined />} aria-label="更多操作" /></Dropdown>
        </Space>
      </Header>
      <Content className="app-content">
        <div className="app-content-inner">
          {isDocs ? <Suspense fallback={<div className="app-route-loading"><Spin tip="正在加载接口文档…" /></div>}><DocsRoute tcpGatewayAddress={tcpGatewayAddress} /></Suspense> : <AdminRoute requestedTab={activeTab} selectedProjectId={selectedProjectId} drawerOpen={drawerOpen} adminToken={adminToken} projectUserSessionToken={projectUserSessionToken} onAdminTokenRequired={requireAdminPassword} onActiveTabChange={setActiveTab} onProjectsChange={setProjects} onSelectedProjectIdChange={setSelectedProjectId} onEventStatus={setEventStatus} onDrawerOpenChange={setDrawerOpen} onRefreshChange={updateRefresh} />}
        </div>
      </Content>
    </Layout>
  </Layout>;
};

export default App;
