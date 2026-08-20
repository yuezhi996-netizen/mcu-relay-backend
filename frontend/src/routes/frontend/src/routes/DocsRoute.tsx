import { BookOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Space, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { requestJson } from "../api/client";

const { Title, Paragraph, Text } = Typography;
const Code = ({ children }: { readonly children: string }): JSX.Element => <pre style={{ overflow: "auto", padding: 12, borderRadius: 8, background: "rgba(22, 119, 255, 0.08)" }}>{children}</pre>;

type Endpoint = { readonly method: string; readonly path: string; readonly description: string; readonly authentication: boolean | "admin" };
export type DocsRouteProps = { readonly tcpGatewayAddress: string };

export const DocsRoute = ({ tcpGatewayAddress }: DocsRouteProps): JSX.Element => {
  const currentOrigin = window.location.origin;
  const [endpoints, setEndpoints] = useState<readonly Endpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadEndpoints = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const response = await requestJson<readonly Endpoint[]>("/api/endpoints", { method: "GET", body: null, headers: {} });
      setEndpoints(response.data);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "端点清单加载失败。");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void loadEndpoints(); }, [loadEndpoints]);
  return <Space direction="vertical" size="middle" style={{ display: "flex", maxWidth: 1080 }}>
  <Card><Title level={2}><BookOutlined /> 接口文档</Title><Paragraph>本项目是本地版单片机中转后台。后台负责创建项目、生成项目 token、接收设备数据、向小程序/安卓 App 推送实时数据，并给设备下发命令。</Paragraph></Card>
  <Card title="接口总览"><Paragraph>管理后台：<Text code>{`${currentOrigin}/admin`}</Text>；网页接口文档：<Text code>{`${currentOrigin}/docs`}</Text>；TCP 设备网关：<Text code>{tcpGatewayAddress}</Text>。</Paragraph><Paragraph>每个项目都有 <Text code>projectId</Text> 与 <Text code>token</Text>。项目接口可使用 <Text code>x-project-token: {'{token}'}</Text> 或 <Text code>x-agent-key: {'{agentKey}'}</Text> 请求头；SSE 使用 URL 参数 <Text code>?token={'{token}'}</Text>。</Paragraph></Card>
  <Card title="添加项目"><Paragraph><Text code>POST /api/v1/projects</Text>，Content-Type 为 application/json。</Paragraph><Code>{'{"projectId":"{projectId}","name":"{项目中文名称}"}'}</Code><Paragraph>返回会包含项目 ID、token、中文名称、创建时间和更新时间；设备协议继续使用稳定的项目 ID。</Paragraph></Card>
  <Card title="安全与自动化"><Paragraph>配置 <Text code>ADMIN_TOKEN</Text> 后，管理页需要输入管理员密码登录；底层接口继续使用 <Text code>x-admin-token</Text> 请求头，密码只保存在当前页面内存中。永久删除项目时必须完整输入项目 ID，关联设备、命令和自动化数据会被级联删除。</Paragraph><Paragraph>“自动化”页可管理 Agent Key、规则、Webhook/MQTT 转发器、固件和 OTA。Agent Key 完整值只在创建时返回一次；Webhook 默认禁止访问本机与私网目标。</Paragraph></Card>
  <Card title="远程串口调试"><Paragraph>“远程调试”通过后台 TCP 网关连接已经上线的设备，不访问本机 COM 口。工作台支持文本/HEX、行尾、XOR8/SUM8/CRC16 Modbus、帧预览、周期发送、快捷指令、会话统计、日志恢复和多格式导出；远端设备固件继续实现 <Text code>remote_debug_open</Text>、<Text code>remote_debug_write</Text>、<Text code>remote_debug_close</Text> 和 <Text code>remote_debug_data</Text>。</Paragraph><Code>{'GET /api/v1/devices/{projectId}/{deviceId}/remote-debug/logs?limit=500\nPOST /api/v1/devices/{projectId}/{deviceId}/remote-debug/write\n{"encoding":"base64","data":"QVQNCg=="}'}</Code><Paragraph>后台每台设备保留最近 2000 条运行期 TX/RX 日志。服务进程重启后日志重新开始，设备业务数据不受影响。波特率、数据位、停止位和硬件校验位仍由单片机固件配置。</Paragraph></Card>
  <Card title="设备上报"><Paragraph><Text code>POST /api/v1/devices/report</Text>，Content-Type 为 application/json。</Paragraph><Code>{'{\n  "projectId":"{projectId}", "token":"{token}", "deviceId":"{deviceId}",\n  "values":[{"key":"value1","value":1,"unit":""}],\n  "relays":[{"key":"relay1","state":"off"}],\n  "alarms":[{"key":"alarm1","active":false}]\n}'}</Code><Paragraph><Text code>values</Text> 是任意采集值，<Text code>relays</Text> 是多个继电器状态，<Text code>alarms</Text> 是多个报警状态。设备列表为 <Text code>GET /api/v1/devices?projectId={'{projectId}'}</Text>，最新数据为 <Text code>GET /api/v1/devices/{'{projectId}'}/{'{deviceId}'}/latest</Text>，两者都需请求头 token。</Paragraph></Card>
  <Card title="实时事件"><Paragraph><Text code>GET /api/v1/events?projectId={'{projectId}'}&token={'{token}'}</Text> 返回 <Text code>text/event-stream</Text>。事件包括设备上报、上线、离线、报警、连通性验证、命令入队与确认、规则触发、设备影子更新、转发结果、OTA 进度、设备回传的 <Text code>remote_debug_data</Text> 和统一收发日志 <Text code>remote_debug_log</Text>。</Paragraph><Code>{'event: device_report\ndata: {"type":"device_report","device":{...}}'}</Code></Card>
  <Card title="批量继电器"><Paragraph><Text code>POST /api/v1/devices/{'{projectId}'}/{'{deviceId}'}/commands</Text>，请求头携带项目 token。</Paragraph><Code>{'{\n  "name":"set_relays",\n  "payload":{"relays":[{"key":"relay1","state":"on"},{"key":"relay2","state":"off"}]}\n}'}</Code></Card>
  <Card title="自定义命令"><Code>{'{\n  "name":"{commandName}",\n  "payload":{"key":"value"}\n}'}</Code></Card>
  <Card title="设备获取待执行命令"><Paragraph><Text code>GET /api/v1/devices/{'{projectId}'}/{'{deviceId}'}/commands/next</Text>，请求头携带项目 token。若有待执行命令，响应数据包含 <Text code>hasCommand: true</Text> 和 command；否则为 <Text code>hasCommand: false</Text>。</Paragraph></Card>
  <Card title="设备确认命令已执行"><Paragraph><Text code>POST /api/v1/devices/{'{projectId}'}/{'{deviceId}'}/commands/{'{commandId}'}/ack</Text></Paragraph><Paragraph>项目 token 只能通过以下二选一的方式提供：<Text code>x-project-token: {'{token}'}</Text> 请求头，或 <Text code>?token={'{token}'}</Text> query 参数。请求体不支持 token。</Paragraph></Card>
  <Card title="API 端点清单">{error.length > 0 ? <Alert type="error" showIcon message="端点清单加载失败" description={error} action={<Button size="small" onClick={() => void loadEndpoints()}>重试</Button>} style={{ marginBottom: 16 }} /> : null}<Table<Endpoint> rowKey={(item) => `${item.method}-${item.path}`} size="small" pagination={false} loading={loading} scroll={{ x: 680 }} dataSource={[...endpoints]} locale={{ emptyText: error.length > 0 ? "端点清单暂不可用。" : "暂无端点。" }} columns={[{ title: "方法", dataIndex: "method", render: (value: string) => <Tag color="blue">{value}</Tag> }, { title: "路径", dataIndex: "path", render: (value: string) => <Text code>{value}</Text> }, { title: "说明", dataIndex: "description" }, { title: "鉴权", dataIndex: "authentication", render: (value: boolean | "admin") => <Tag color={value === "admin" ? "purple" : value ? "orange" : "green"}>{value === "admin" ? "管理员" : value ? "项目" : "无需"}</Tag> }]} /></Card>
  <Card title="TCP 网关"><Paragraph>TCP 使用“一行 JSON 一条消息”，适合 ESP8266/ESP32 透传。设备上报使用 <Text code>type: "report"</Text>，后台下发使用 <Text code>type: "command"</Text>，设备确认使用 <Text code>type: "ack"</Text>，心跳使用 <Text code>{'{"type":"ping"}'}</Text>。远程串口字节使用 Base64 包在 JSON 中，避免换行和二进制内容破坏协议。</Paragraph><Code>{'{"type":"report","projectId":"{projectId}","token":"{token}","deviceId":"{deviceId}","values":[{"key":"value1","value":1,"unit":""}],"relays":[{"key":"relay1","state":"off"}],"alarms":[{"key":"alarm1","active":false}]}'}</Code><Code>{'{"type":"command","command":{"id":"{commandId}","projectId":"{projectId}","deviceId":"{deviceId}","name":"set_relays","payload":{"relays":[{"key":"relay1","state":"on"}]},"status":"pending","createdAt":"2026-07-21T00:00:00.000Z","acknowledgedAt":null}}\n{"type":"ack","projectId":"{projectId}","token":"{token}","deviceId":"{deviceId}","commandId":"{commandId}"}\n{"type":"remote_debug_data","projectId":"{projectId}","token":"{token}","deviceId":"{deviceId}","encoding":"base64","data":"T0sNCg=="}\n{"type":"ping"}'}</Code><Paragraph>STM32 负责采集和继电器控制，建议与 WiFi 模块通过 UART 用同样的一行 JSON 格式透传。</Paragraph></Card>
</Space>;
};
