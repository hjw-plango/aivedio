"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ShotAsset } from "@/lib/api";

export default function MemoryView({ projectId }: { projectId: string }) {
  const [assets, setAssets] = useState<ShotAsset[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await api.listAssets(projectId);
      setAssets(rows.filter((a) => ["production_memory", "reference_image_prompt"].includes(a.asset_type)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const memory = assets.find((a) => a.asset_type === "production_memory");
  const references = useMemo(
    () =>
      assets
        .filter((a) => a.asset_type === "reference_image_prompt")
        .sort((a, b) => String(a.meta.reference_id || "").localeCompare(String(b.meta.reference_id || ""))),
    [assets],
  );

  const copy = async (asset: ShotAsset) => {
    await navigator.clipboard.writeText(asset.prompt);
    setCopied(asset.id);
    setTimeout(() => setCopied(null), 1200);
  };

  return (
    <main className="container">
      <header style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h2>项目记忆与参考图</h2>
        <span className="tag">{references.length} 条参考图提示词</span>
        <Link href={`/projects/${projectId}`} style={{ marginLeft: "auto" }}>
          ← 返回项目
        </Link>
      </header>

      {err && <div className="card" style={{ background: "var(--error)", color: "white" }}>{err}</div>}

      {memory && (
        <section className="card" style={{ marginTop: 12 }}>
          <header style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h3 style={{ margin: 0 }}>Production Memory</h3>
            <button className="secondary" style={{ marginLeft: "auto" }} onClick={() => copy(memory)}>
              {copied === memory.id ? "已复制" : "复制 JSON"}
            </button>
          </header>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 360, overflow: "auto" }}>
            {memory.prompt}
          </pre>
        </section>
      )}

      <section style={{ display: "grid", gap: 12, marginTop: 12 }}>
        {references.map((ref) => (
          <article key={ref.id} className="card">
            <header style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <strong>{String(ref.meta.reference_id || "REFERENCE")}</strong>
              <span className="tag">{String(ref.meta.reference_type || "reference")}</span>
              {Boolean(ref.meta.state) && <span className="tag">{String(ref.meta.state)}</span>}
              {Boolean(ref.meta.variant_of) && <span className="muted">基于 {String(ref.meta.variant_of)}</span>}
              <button className="primary" style={{ marginLeft: "auto", padding: "4px 12px" }} onClick={() => copy(ref)}>
                {copied === ref.id ? "已复制" : "复制提示词"}
              </button>
            </header>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, marginTop: 8 }}>{ref.prompt}</pre>
          </article>
        ))}
        {!memory && references.length === 0 && (
          <p className="muted">暂无项目记忆。启动 Pipeline 后会生成主体、环境、物品和状态参考图提示词。</p>
        )}
      </section>
    </main>
  );
}
