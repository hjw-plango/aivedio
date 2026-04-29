async function fetchProjects() {
  const base = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
  try {
    const res = await fetch(`${base}/api/projects`, { cache: "no-store" });
    if (!res.ok) return [];
    return (await res.json()) as Array<{
      id: string;
      title: string;
      direction: string;
      status: string;
    }>;
  } catch {
    return [];
  }
}

export default async function ProjectsPage() {
  const projects = await fetchProjects();
  return (
    <main style={{ padding: 32, maxWidth: 760, margin: "0 auto" }}>
      <h1>项目列表</h1>
      {projects.length === 0 ? (
        <p style={{ opacity: 0.7 }}>
          暂无项目。M0 仅提供骨架,创建项目走后端 API:
          <code> POST /api/projects {`{"title":"...","direction":"documentary"}`}</code>
        </p>
      ) : (
        <ul>
          {projects.map((p) => (
            <li key={p.id}>
              <strong>{p.title}</strong> · {p.direction} · {p.status}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
