"use client";

type Props = {
  agentName: string;
  status: "pending" | "running" | "success" | "failed" | "rejected" | "skipped" | "paused";
  inputSummary?: string;
  outputSummary?: string;
};

const STATUS_LABEL: Record<Props["status"], string> = {
  pending: "待执行",
  running: "运行中",
  success: "已完成",
  failed: "失败",
  rejected: "拒绝",
  skipped: "跳过",
  paused: "已暂停",
};

export default function StepCard({ agentName, status, inputSummary, outputSummary }: Props) {
  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
        background: "rgba(255,255,255,0.5)",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between" }}>
        <strong>{agentName}</strong>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{STATUS_LABEL[status]}</span>
      </header>
      {inputSummary && <p style={{ fontSize: 14, margin: "8px 0" }}>输入:{inputSummary}</p>}
      {outputSummary && <p style={{ fontSize: 14, margin: "8px 0" }}>输出:{outputSummary}</p>}
    </div>
  );
}
