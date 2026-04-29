"use client";

import { useEffect, useState } from "react";
import { api, Material } from "@/lib/api";

export default function ProjectMaterials({ projectId }: { projectId: string }) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setMaterials(await api.listMaterials(projectId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    refresh();
  }, [projectId]);

  const addText = async () => {
    if (!content.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.createMaterial(projectId, { content, source_type: "text" });
      setContent("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      await api.uploadMaterial(projectId, file);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h3 style={{ marginTop: 0 }}>资料 ({materials.length})</h3>

      <textarea
        placeholder="粘贴非遗资料文本..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={6}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="primary" onClick={addText} disabled={busy || !content.trim()}>
          添加文本
        </button>
        <label className="secondary" style={{ display: "inline-flex", alignItems: "center", padding: "6px 12px", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer" }}>
          上传文件
          <input
            type="file"
            accept=".txt,.md,.json"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </label>
      </div>
      {err && <p style={{ color: "var(--error)" }}>{err}</p>}

      <ul style={{ listStyle: "none", padding: 0, marginTop: 16 }}>
        {materials.map((m) => (
          <li key={m.id} style={{ borderTop: "1px solid var(--border)", padding: "8px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="tag">{m.source_type}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {new Date(m.created_at).toLocaleString()}
              </span>
            </div>
            <p style={{ margin: "6px 0", fontSize: 14, whiteSpace: "pre-wrap" }}>
              {m.content.slice(0, 200)}
              {m.content.length > 200 ? "…" : ""}
            </p>
            {m.file_path && <p className="muted" style={{ fontSize: 12 }}>{m.file_path}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
