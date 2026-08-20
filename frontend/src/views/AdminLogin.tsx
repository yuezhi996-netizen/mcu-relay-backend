import { LockOutlined, SafetyCertificateOutlined, ThunderboltOutlined, UserAddOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Space, Tabs, Typography } from "antd";
import type { ThemeMode } from "../theme";

const { Title, Paragraph, Text } = Typography;

type AdminLoginFields = { readonly password: string };
type UserLoginFields = { readonly username: string; readonly password: string };
type RegistrationFields = UserLoginFields & { readonly projectId: string; readonly projectName: string };

type AdminLoginProps = {
  readonly mode: ThemeMode;
  readonly loading: boolean;
  readonly error: string;
  readonly notice: string;
  readonly onAdminLogin: (password: string) => Promise<void>;
  readonly onUserLogin: (username: string, password: string) => Promise<void>;
  readonly onRegister: (projectId: string, projectName: string, username: string, password: string) => Promise<void>;
};

const accountFields = <>
  <Form.Item<UserLoginFields> name="username" label="登录账号" rules={[{ required: true, whitespace: true, message: "请输入登录账号。" }]}>
    <Input prefix={<UserOutlined />} size="large" autoComplete="username" maxLength={100} placeholder="请输入项目登录账号" aria-label="登录账号" />
  </Form.Item>
  <Form.Item<UserLoginFields> name="password" label="登录密码" rules={[{ required: true, whitespace: true, message: "请输入登录密码。" }]}>
    <Input.Password prefix={<LockOutlined />} size="large" autoComplete="current-password" maxLength={256} placeholder="请输入登录密码" aria-label="登录密码" />
  </Form.Item>
</>;

export const AdminLogin = ({ mode, loading, error, notice, onAdminLogin, onUserLogin, onRegister }: AdminLoginProps): JSX.Element => <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: mode === "dark" ? "#0f1115" : "#f3f6fa" }}>
  <div style={{ width: "min(100%, 460px)" }}>
    <Space align="center" size={12} style={{ marginBottom: 24 }}>
      <span style={{ width: 42, height: 42, display: "grid", placeItems: "center", borderRadius: 12, background: "#1677ff", color: "white", fontSize: 22 }}><ThunderboltOutlined /></span>
      <div><Text strong style={{ fontSize: 17 }}>单片机中转后台</Text><br /><Text type="secondary">MCU Relay Console</Text></div>
    </Space>
    <Card variant="borderless" style={{ borderRadius: 16, boxShadow: mode === "dark" ? "0 18px 48px rgba(0,0,0,.38)" : "0 18px 48px rgba(15,35,60,.12)" }} styles={{ body: { padding: "clamp(24px, 6vw, 36px)" } }}>
      <Space direction="vertical" size={20} style={{ display: "flex" }}>
        <div>
          <span style={{ width: 48, height: 48, display: "grid", placeItems: "center", borderRadius: 14, background: mode === "dark" ? "#111d2c" : "#e6f4ff", color: "#1677ff", fontSize: 22, marginBottom: 20 }}><SafetyCertificateOutlined /></span>
          <Title level={2} style={{ margin: "0 0 8px", letterSpacing: "-0.02em" }}>登录中转后台</Title>
          <Paragraph type="secondary" style={{ margin: 0, fontSize: 16 }}>项目用户仅能访问管理员审核后绑定的一个项目。</Paragraph>
        </div>
        {error.length > 0 ? <Alert type="error" showIcon message="操作失败" description={error} role="alert" /> : null}
        {notice.length > 0 ? <Alert type="success" showIcon message="提交成功" description={notice} role="status" /> : null}
        <Tabs items={[
          {
            key: "user-login",
            label: "项目用户登录",
            children: <Form<UserLoginFields> layout="vertical" requiredMark={false} onFinish={({ username, password }) => void onUserLogin(username.trim(), password)}>{accountFields}<Button type="primary" size="large" htmlType="submit" block loading={loading}>登录项目</Button></Form>
          },
          {
            key: "register",
            label: "注册申请",
            children: <Form<RegistrationFields> layout="vertical" requiredMark={false} onFinish={({ projectId, projectName, username, password }) => void onRegister(projectId.trim(), projectName.trim(), username.trim(), password)}>
              <Form.Item name="projectName" label="项目中文名称" rules={[{ required: true, whitespace: true, message: "请输入项目中文名称。" }]}><Input prefix={<UserAddOutlined />} size="large" maxLength={100} placeholder="例如 温湿度远程报警系统" aria-label="项目中文名称" /></Form.Item>
              <Form.Item name="projectId" label="项目 ID" extra="审核通过后将作为固件和 App 的稳定身份。" rules={[{ required: true, whitespace: true, message: "请输入项目 ID。" }]}><Input size="large" maxLength={100} placeholder="例如 temp_humidity_alarm" aria-label="项目 ID" /></Form.Item>
              {accountFields}
              <Button type="primary" size="large" htmlType="submit" block loading={loading}>提交审核申请</Button>
            </Form>
          },
          {
            key: "admin",
            label: "管理员登录",
            children: <Form<AdminLoginFields> layout="vertical" requiredMark={false} onFinish={({ password }) => void onAdminLogin(password)}>
              <input type="text" name="username" value="admin" readOnly autoComplete="username" tabIndex={-1} aria-hidden="true" style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
              <Form.Item name="password" label="管理员密码" rules={[{ required: true, whitespace: true, message: "请输入管理员密码。" }]} style={{ marginBottom: 20 }}><Input.Password prefix={<LockOutlined />} size="large" autoFocus autoComplete="current-password" maxLength={256} placeholder="请输入管理员密码" aria-label="管理员密码" /></Form.Item>
              <Button type="primary" size="large" htmlType="submit" block loading={loading}>登录后台</Button>
            </Form>
          }
        ]} />
        <Text type="secondary" style={{ fontSize: 13 }}>登录状态保存在当前标签页中，退出登录或关闭标签页后会清除。</Text>
      </Space>
    </Card>
    <Paragraph type="secondary" style={{ margin: "18px 0 0", textAlign: "center" }}>服务器：{window.location.host}</Paragraph>
  </div>
</main>;
