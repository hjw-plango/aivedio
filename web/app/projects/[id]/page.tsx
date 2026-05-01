import Link from "next/link";
import { api } from "@/lib/api";
import ProjectMaterials from "./_materials";
import ProjectRuns from "./_runs";

type Props = { params: Promise<{ id: string }> };

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params;
  let project;
  try {
    project = await api.getProject(id);
  } catch {
    return (
      <main className="container">
        <h2>项目不存在</h2>
        <Link href="/projects">返回列表</Link>
      </main>
    );
  }

  return (
    <main className="container">
      <header style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h2>{project.title}</h2>
        <span className="tag">{project.direction}</span>
        <span className="muted">{project.id}</span>
      </header>
      {project.brief && <p className="muted">{project.brief}</p>}

      <nav style={{ display: "flex", gap: 16, margin: "12px 0", fontSize: 14 }}>
        <Link href={`/projects/${id}/facts`}>FactCard</Link>
        <Link href={`/projects/${id}/memory`}>项目记忆/参考图</Link>
        <Link href={`/projects/${id}/shots`}>分镜与即梦桥</Link>
        <Link href={`/projects/${id}/assets`}>资产管理</Link>
      </nav>

      <section style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
        <ProjectMaterials projectId={id} />
        <ProjectRuns projectId={id} />
      </section>
    </main>
  );
}
