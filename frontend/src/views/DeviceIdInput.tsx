import { AutoComplete } from "antd";
import type { DeviceRecord } from "../types";

export type DeviceIdInputProps = {
  readonly devices: readonly DeviceRecord[];
  readonly value: string;
  readonly onChange: (deviceId: string) => void;
  readonly ariaLabel: string;
};

export const DeviceIdInput = ({ devices, value, onChange, ariaLabel }: DeviceIdInputProps): JSX.Element => <AutoComplete
  value={value}
  options={devices.map((device) => ({ value: device.deviceId, label: device.deviceId }))}
  onChange={onChange}
  placeholder="选择或输入设备 ID"
  style={{ width: "100%", maxWidth: 360 }}
  aria-label={ariaLabel}
  filterOption={(input, option) => typeof option?.value === "string" && option.value.includes(input)}
/>;
