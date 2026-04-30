"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, Run } from "@/lib/api";
import { STEP_STATUS_DISPLAY } from "@/lib/eventTypes";

export default function ProjectRuns({ projectId }: { projectId: string }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRuns(await api.listRuns(projectId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.createRun({ project_id: projectId, auto_mode: auto });
      window.location.href = `/runs/${r.id}`;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h3 style={{ marginTop: 0 }}>Pipeline</h3>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="primary" onClick={start} disabled={busy}>
          启动 Pipeline
        </button>
        <label className="muted" style={{ fontSize: 13 }}>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> 自动模式(不暂停)
        </label>
      </div>
      {err && <p style={{ color: "var(--error)" }}>{err}</p>}

      <ul style={{ listStyle: "none", padding: 0, marginTop: 16 }}>
        {runs.length === 0 && <li className="muted">暂无运行记录</li>}
        {runs.map((r) => (
          <li key={r.id} style={{ borderTop: "1px solid var(--border)", padding: "8px 0" }}>
            <Link href={`/runs/${r.id}`}>
              <strong>{r.id.slice(0, 16)}</strong>
            </Link>
            <span className="tag" style={{ marginLeft: 8 }}>{r.status}</span>
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              {r.steps.map((s) => (
                <span
                  key={s.id}
                  title={`${s.step_name}: ${s.status}`}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    background: STEP_STATUS_DISPLAY[s.status]?.color || "#999",
                    display: "inline-block",
                  }}
                />
              ))}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {new Date(r.created_at).toLocaleString()}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
