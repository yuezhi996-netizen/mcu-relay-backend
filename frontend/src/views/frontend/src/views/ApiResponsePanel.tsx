import { Card } from "antd";

export type ApiResponsePanelProps = { readonly value: unknown };

export const ApiResponsePanel = ({ value }: ApiResponsePanelProps): JSX.Element => <Card title="接口返回">
  <pre style={{ margin: 0, minHeight: 220, maxHeight: 420, overflow: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify(value, null, 2)}</pre>
</Card>;
