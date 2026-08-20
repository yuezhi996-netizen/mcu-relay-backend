import { CopyOutlined, DeleteOutlined } from "@ant-design/icons";
import { Button, Drawer, Grid, Space, Tag, Typography, message } from "antd";

export type ApiReturnDrawerProps = {
  readonly open: boolean;
  readonly value: unknown;
  readonly onClose: () => void;
  readonly onClear: () => void;
};

const isSuccessful = (value: unknown): boolean | null => {
  if (typeof value !== "object" || value === null || !("ok" in value) || typeof value.ok !== "boolean") return null;
  return value.ok;
};

export const ApiReturnDrawer = ({ open, value, onClose, onClear }: ApiReturnDrawerProps): JSX.Element => {
  const screens = Grid.useBreakpoint();
  const json = JSON.stringify(value, null, 2);
  const result = isSuccessful(value);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(json);
      message.success("接口返回已复制");
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : "复制失败。");
    }
  };

  return <Drawer title="接口返回" width={screens.sm === true ? 480 : "100%"} open={open} onClose={onClose} extra={<Space>
    {result !== null ? <Tag color={result ? "green" : "red"}>{result ? "ok" : "error"}</Tag> : null}
    <Button size="small" icon={<CopyOutlined />} onClick={() => void copy()} aria-label="复制接口返回">复制</Button>
    <Button size="small" icon={<DeleteOutlined />} onClick={onClear} aria-label="清空接口返回">清空</Button>
  </Space>}>
    <Typography.Paragraph type="secondary">原始 JSON 响应会保留在当前浏览器会话中。</Typography.Paragraph>
    <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflow: "auto" }}>{json}</pre>
  </Drawer>;
};
