import { Select } from "antd";
import type { DeviceRecord } from "../types";

export type DeviceSelectProps = {
  readonly devices: readonly DeviceRecord[];
  readonly value: string;
  readonly onChange: (deviceId: string) => void;
  readonly ariaLabel: string;
};

export const DeviceSelect = ({ devices, value, onChange, ariaLabel }: DeviceSelectProps): JSX.Element => <Select
  showSearch
  allowClear
  value={value || undefined}
  placeholder="选择设备 ID"
  style={{ width: "100%", maxWidth: 360 }}
  options={devices.map((device) => ({ value: device.deviceId, label: device.deviceId }))}
  onChange={(next: string | undefined) => onChange(next ?? "")}
  filterOption={(input, option) => typeof option?.value === "string" && option.value.includes(input)}
  aria-label={ariaLabel}
/>;
