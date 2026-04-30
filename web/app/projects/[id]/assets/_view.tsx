"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ShotAsset } from "@/lib/api";

const TYPES = [
  "all",
  "jimeng_video_prompt",
  "storyboard_prompt",
  "manual_jimeng_video",
  "real_footage",
  "reference_image",
];

export default function AssetsView({ projectId }: { projectId: string }) {
  const [assets, setAssets] = useState<ShotAsset[]>([]);
  const [type, setType] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");

  const refresh = useCallback(async () => {
    setAssets(
      await api.listAssets(projectId, {
        asset_type: type === "all" ? undefined : type,
        status: status === "all" ? undefined : status,
      }),
    );
  }, [projectId, type, status]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <main className="container">
      <header style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h2>资产管理</h2>
        <span className="tag">{assets.length}</span>
        <Link href={`/projects/${projectId}`} style={{ marginLeft: "auto" }}>← 返回项目</Link>
      </header>

      <div style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        {TYPES.map((t) => (
          <button key={t} className={type === t ? "primary" : "secondary"} onClick={() => setType(t)}>
            {t === "all" ? "全部类型" : t}
          </button>
        ))}
        <span style={{ marginLeft: 12 }} />
        {["all", "draft", "accepted", "rejected"].map((s) => (
          <button key={s} className={status === s ? "primary" : "secondary"} onClick={() => setStatus(s)}>
            {s === "all" ? "全部状态" : s}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {assets.map((a) => (
          <article key={a.id} className="card">
            <header style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <strong>{a.asset_type}</strong>
              <span className="tag">v{a.version}</span>
              <span className="tag">{a.status}</span>
              {a.score != null && <span className="tag">{a.score} 分</span>}
              {a.shot_id && (
                <Link href={`/projects/${projectId}/shots`} className="muted" style={{ fontSize: 12 }}>
                  shot {a.shot_id.slice(0, 12)}
                </Link>
              )}
              <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
                {new Date(a.created_at).toLocaleString()}
              </span>
            </header>
            {a.prompt && (
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, marginTop: 8 }}>
                {a.prompt.slice(0, 400)}
                {a.prompt.length > 400 ? "…" : ""}
              </pre>
            )}
            {a.file_path && a.asset_type.includes("video") && (
              <video src={api.fileUrl(a.file_path)} controls style={{ width: "100%", maxHeight: 240, marginTop: 8, background: "#000", borderRadius: 6 }} />
            )}
            {a.file_path && a.asset_type.includes("image") && (
              <img src={api.fileUrl(a.file_path)} alt="" style={{ maxWidth: "100%", marginTop: 8, borderRadius: 6 }} />
            )}
            {a.failure_tags.length > 0 && (
              <p style={{ marginTop: 6 }}>
                <span className="muted">失败标签:</span>{" "}
                {a.failure_tags.map((t) => (
                  <span key={t} className="tag" style={{ marginRight: 4, background: "var(--warn)", color: "white" }}>{t}</span>
                ))}
              </p>
            )}
            {a.notes && <p style={{ fontSize: 13, marginTop: 6 }}>{a.notes}</p>}
            {a.rights && Object.keys(a.rights).length > 0 && (
              <details style={{ fontSize: 12, marginTop: 6 }}>
                <summary className="muted">版权字段</summary>
                <pre>{JSON.stringify(a.rights, null, 2)}</pre>
              </details>
            )}
          </article>
        ))}
        {assets.length === 0 && <p className="muted">暂无资产</p>}
      </div>
    </main>
  );
}
