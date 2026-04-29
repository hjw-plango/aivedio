"use client";

import { useState } from "react";

type Visibility = "detail" | "summary" | "hidden";

const LABELS: Record<Visibility, string> = {
  detail: "详细",
  summary: "摘要",
  hidden: "黑盒",
};

export default function VisibilityToggle({
  defaultValue = "summary",
  onChange,
}: {
  defaultValue?: Visibility;
  onChange?: (v: Visibility) => void;
}) {
  const [value, setValue] = useState<Visibility>(defaultValue);
  const select = (v: Visibility) => {
    setValue(v);
    onChange?.(v);
  };
  return (
    <div style={{ display: "inline-flex", gap: 8 }}>
      {(Object.keys(LABELS) as Visibility[]).map((key) => (
        <button
          key={key}
          onClick={() => select(key)}
          style={{
            padding: "4px 12px",
            border: "1px solid #ccc",
            borderRadius: 999,
            background: key === value ? "#1f1f23" : "transparent",
            color: key === value ? "#fff" : "inherit",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          {LABELS[key]}
        </button>
      ))}
    </div>
  );
}
