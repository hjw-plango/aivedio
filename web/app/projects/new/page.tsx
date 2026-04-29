"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

export default function NewProjectPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [direction, setDirection] = useState("documentary");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const project = await api.createProject({ title, direction, brief });
      router.push(`/projects/${project.id}`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <main className="container" style={{ maxWidth: 720 }}>
      <h2>新建项目</h2>
      <form onSubmit={submit} className="card" style={{ display: "grid", gap: 12 }}>
        <label>
          <div className="muted" style={{ marginBottom: 4 }}>项目名 *</div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          <div className="muted" style={{ marginBottom: 4 }}>方向</div>
          <select value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="documentary">documentary 纪录片(已配置)</option>
            <option value="drama">drama 短剧(P2 微调)</option>
            <option value="comic">comic 漫剧(P2 微调)</option>
            <option value="general">general 通用</option>
          </select>
        </label>
        <label>
          <div className="muted" style={{ marginBottom: 4 }}>Brief</div>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="例:做一部 5 分钟的非遗纪录片,主题是景德镇制瓷"
          />
        </label>
        {err && (
          <div className="card" style={{ background: "var(--error)", color: "white" }}>
            {err}
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "创建中..." : "创建"}
          </button>
          <button type="button" className="secondary" onClick={() => router.back()}>
            取消
          </button>
        </div>
      </form>
    </main>
  );
}
