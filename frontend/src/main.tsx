import { ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./app.css";
import { useTheme } from "./theme";

const Root = (): JSX.Element => {
  const [mode, toggleTheme] = useTheme();
  return (
    <ConfigProvider locale={zhCN} theme={{ algorithm: mode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm, token: { colorPrimary: "#2563eb", borderRadius: 8, fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif" } }}>
      <App mode={mode} onToggleTheme={toggleTheme} />
    </ConfigProvider>
  );
};

const root = document.querySelector("#root");
if (root === null) {
  throw new Error("Root element #root was not found.");
}
createRoot(root).render(<Root />);
