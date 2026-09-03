// iframe 属性与响应 CSP 共用同一份权限，避免两层沙箱再次出现配置漂移。
export const REPORT_SANDBOX_TOKENS =
  "allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox allow-modals";

// 报告不需要且不应获得的设备/账号级权限。不在此处禁用
// fullscreen/clipboard-write：它们仍由 iframe allow 与用户手势双重约束。
export const REPORT_PERMISSIONS_POLICY = [
  "accelerometer=()",
  "ambient-light-sensor=()",
  "camera=()",
  "clipboard-read=()",
  "display-capture=()",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "publickey-credentials-create=()",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "serial=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");
