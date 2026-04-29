import Link from "next/link";
import { api, Project } from "@/lib/api";

export const dynamic = "force-dynamic";

async function fetchProjects(): Promise<Project[]> {
  try {
    return await api.listProjects();
  } catch {
    return [];
  }
}

export default async function ProjectsPage() {
  const projects = await fetchProjects();
  return (
    <main className="container">
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h2>项目列表</h2>
        <Link href="/projects/new" className="primary" style={{ padding: "6px 14px", borderRadius: 6, color: "white", background: "var(--accent)" }}>
          + 新建项目
        </Link>
      </header>
      {projects.length === 0 ? (
        <p className="muted">暂无项目。先创建一个,选择 documentary 方向。</p>
      ) : (
        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="card" style={{ display: "block" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <strong>{p.title}</strong>
                <span className="tag">{p.direction}</span>
              </div>
              {p.brief && <p className="muted" style={{ marginTop: 6 }}>{p.brief}</p>}
              <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                {new Date(p.created_at).toLocaleString()} · {p.id.slice(0, 12)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
