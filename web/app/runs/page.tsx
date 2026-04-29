import Link from "next/link";
import { api } from "@/lib/api";
import { STEP_STATUS_DISPLAY } from "@/lib/eventTypes";

export const dynamic = "force-dynamic";

export default async function RunsListPage() {
  let runs: Awaited<ReturnType<typeof api.listRuns>> = [];
  try {
    runs = await api.listRuns();
  } catch {
    runs = [];
  }
  return (
    <main className="container">
      <h2>所有 Pipeline 运行记录</h2>
      {runs.length === 0 && <p className="muted">暂无运行记录</p>}
      <div style={{ display: "grid", gap: 8 }}>
        {runs.map((r) => (
          <Link key={r.id} href={`/runs/${r.id}`} className="card" style={{ display: "block" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <strong>{r.id.slice(0, 18)}</strong>
              <span className="tag">{r.status}</span>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              project {r.project_id.slice(0, 12)} · workflow {r.workflow}
            </div>
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
                  }}
                />
              ))}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
