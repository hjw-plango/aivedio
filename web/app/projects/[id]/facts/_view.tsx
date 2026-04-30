"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, FactCard } from "@/lib/api";

export default function FactsView({ projectId }: { projectId: string }) {
  const [facts, setFacts] = useState<FactCard[]>([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");

  const refresh = useCallback(async () => {
    try {
      setFacts(await api.listFacts(projectId, { q, category }));
    } catch {
      setFacts([]);
    }
  }, [projectId, q, category]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startEdit = (fc: FactCard) => {
    setEditing(fc.id);
    setDraft(fc.content);
  };
  const save = async (fc: FactCard) => {
    await api.patchFact(projectId, fc.id, { content: draft });
    setEditing(null);
    refresh();
  };

  const cats = Array.from(new Set(facts.map((f) => f.category))).filter(Boolean);

  return (
    <main className="container">
      <header style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h2>FactCard</h2>
        <span className="tag">{facts.length}</span>
        <Link href={`/projects/${projectId}`} style={{ marginLeft: "auto" }}>
          ← 返回项目
        </Link>
      </header>
      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <input
          placeholder="搜索内容..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">所有分类</option>
          {cats.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {facts.map((fc) => (
          <article key={fc.id} className="card">
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span className="tag">{fc.category || "未分类"}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                conf {fc.confidence.toFixed(2)} · {fc.review_status}
              </span>
              <button
                className="secondary"
                style={{ marginLeft: "auto", padding: "2px 10px", fontSize: 12 }}
                onClick={() => (editing === fc.id ? save(fc) : startEdit(fc))}
              >
                {editing === fc.id ? "保存" : "编辑"}
              </button>
            </div>
            {editing === fc.id ? (
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} style={{ marginTop: 8 }} />
            ) : (
              <p style={{ marginTop: 8 }}>{fc.content}</p>
            )}
            {fc.culture_review && Object.keys(fc.culture_review).length > 0 && (
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                文化复核:{JSON.stringify(fc.culture_review)}
              </p>
            )}
            {fc.source_span && Object.keys(fc.source_span).length > 0 && (
              <p className="muted" style={{ fontSize: 12 }}>
                source span: start={String(fc.source_span.start)}, end={String(fc.source_span.end)}
              </p>
            )}
          </article>
        ))}
        {facts.length === 0 && <p className="muted">暂无 FactCard。先跑 Pipeline 让研究 Agent 抽取。</p>}
      </div>
    </main>
  );
}
