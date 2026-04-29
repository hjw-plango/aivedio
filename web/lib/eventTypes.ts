// Display helpers for step event types.

export type EventDisplay = {
  label: string;
  color: string;
};

export const EVENT_DISPLAY: Record<string, EventDisplay> = {
  progress_note: { label: "进度", color: "#6366f1" },
  tool_call: { label: "工具调用", color: "#0891b2" },
  tool_result: { label: "工具返回", color: "#0e7490" },
  artifact: { label: "产物", color: "#16a34a" },
  warning: { label: "警告", color: "#d97706" },
  error: { label: "错误", color: "#dc2626" },
  finish: { label: "完成", color: "#059669" },
};

export const STEP_STATUS_DISPLAY: Record<string, { label: string; color: string }> = {
  pending: { label: "待执行", color: "#9ca3af" },
  running: { label: "运行中", color: "#2563eb" },
  success: { label: "已完成", color: "#16a34a" },
  failed: { label: "失败", color: "#dc2626" },
  rejected: { label: "拒绝", color: "#b91c1c" },
  skipped: { label: "跳过", color: "#6b7280" },
  paused: { label: "已暂停", color: "#d97706" },
};

export const VISIBILITY_LABEL: Record<"detail" | "summary" | "hidden", string> = {
  detail: "详细",
  summary: "摘要",
  hidden: "黑盒",
};
