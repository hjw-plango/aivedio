"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, Shot, ShotAsset } from "@/lib/api";

const FAILURE_TAG_OPTIONS = [
  "ai_face",
  "plastic_texture",
  "wrong_craft",
  "ad_style",
  "motion_error",
  "layout_error",
  "irrelevant",
];

export default function ShotsView({ projectId }: { projectId: string }) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [filter, setFilter] = useState<"all" | "ai" | "real">("all");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setShots(await api.listShots(projectId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const visible = shots.filter((s) => {
    if (filter === "ai") return !s.requires_real_footage;
    if (filter === "real") return s.requires_real_footage;
    return true;
  });

  return (
    <main className="container">
      <header style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h2>分镜与即梦提示词</h2>
        <span className="tag">{shots.length} 个镜头</span>
        <span className="muted">
          (AI 适用 {shots.filter((s) => !s.requires_real_footage).length} / 真拍 {shots.filter((s) => s.requires_real_footage).length})
        </span>
        <Link href={`/projects/${projectId}`} style={{ marginLeft: "auto" }}>
          ← 返回项目
        </Link>
      </header>

      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        {(["all", "ai", "real"] as const).map((f) => (
          <button
            key={f}
            className={filter === f ? "primary" : "secondary"}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "全部" : f === "ai" ? "AI 镜头" : "真拍镜头"}
          </button>
        ))}
        <a
          href="https://jimeng.jianying.com/ai-tool/video"
          target="_blank"
          rel="noreferrer"
          className="secondary"
          style={{ marginLeft: "auto", padding: "6px 12px", border: "1px solid var(--border)", borderRadius: 6 }}
        >
          打开即梦官网 ↗
        </a>
      </div>

      {err && <div className="card" style={{ background: "var(--error)", color: "white" }}>{err}</div>}

      <section style={{ display: "grid", gap: 12 }}>
        {visible.map((shot) => (
          <ShotCard
            key={shot.id}
            shot={shot}
            busy={busy}
            setBusy={setBusy}
            onChanged={refresh}
          />
        ))}
        {visible.length === 0 && (
          <p className="muted">暂无分镜。先跑 Pipeline 让分镜 Agent 生成。</p>
        )}
      </section>
    </main>
  );
}

function ShotCard({
  shot,
  busy,
  setBusy,
  onChanged,
}: {
  shot: Shot;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onChanged: () => void;
}) {
  const jimeng = shot.assets.find((a) => a.asset_type === "jimeng_video_prompt");
  const storyboard = shot.assets.find((a) => a.asset_type === "storyboard_prompt");
  const videos = shot.assets.filter((a) => a.asset_type === "manual_jimeng_video");

  return (
    <article className="card">
      <header style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <strong>#{shot.sequence}</strong>
        <span className="tag">{shot.shot_type || "未分类"}</span>
        {shot.requires_real_footage && (
          <span className="tag" style={{ background: "var(--warn)", color: "white" }}>
            必须真拍
          </span>
        )}
        <span className="muted">{shot.duration_estimate}s</span>
        <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
          {shot.id.slice(0, 16)}
        </span>
      </header>

      <p style={{ marginTop: 8 }}>
        <strong>主体:</strong>{shot.subject}
      </p>
      <p className="muted" style={{ fontSize: 13 }}>
        构图:{shot.composition} · 运镜:{shot.camera_motion} · 光线:{shot.lighting}
      </p>

      {!shot.requires_real_footage && jimeng && (
        <JimengCopyBlock prompt={jimeng.prompt} aspect={String(jimeng.meta.aspect_ratio || "16:9")} duration={String(jimeng.meta.duration_seconds || "5")} />
      )}

      {storyboard && (
        <details style={{ marginTop: 12 }}>
          <summary className="muted">分镜参考图提示词</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{storyboard.prompt}</pre>
        </details>
      )}

      {!shot.requires_real_footage && (
        <UploadVideo
          shotId={shot.id}
          busy={busy}
          setBusy={setBusy}
          onUploaded={onChanged}
        />
      )}

      {videos.length > 0 && (
        <section style={{ marginTop: 12 }}>
          <h4 style={{ margin: "8px 0" }}>已上传视频 ({videos.length})</h4>
          <div style={{ display: "grid", gap: 12 }}>
            {videos.map((v) => (
              <VideoAssetRow
                key={v.id}
                asset={v}
                onChanged={onChanged}
              />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}

function JimengCopyBlock({ prompt, aspect, duration }: { prompt: string; aspect: string; duration: string }) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLPreElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback: select text
      const el = ref.current;
      if (el && window.getSelection) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  };
  return (
    <section style={{ marginTop: 12, border: "1px dashed var(--border)", borderRadius: 8, padding: 10 }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <strong>即梦提示词</strong>
        <span className="muted" style={{ fontSize: 12 }}>建议:{aspect} · {duration}s</span>
        <button className="primary" style={{ marginLeft: "auto", padding: "4px 12px" }} onClick={copy}>
          {copied ? "已复制 ✓" : "复制提示词"}
        </button>
      </header>
      <pre ref={ref} style={{ whiteSpace: "pre-wrap", fontSize: 13, marginTop: 8, fontFamily: "ui-monospace" }}>
        {prompt}
      </pre>
    </section>
  );
}

function UploadVideo({
  shotId,
  busy,
  setBusy,
  onUploaded,
}: {
  shotId: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      await api.uploadJimengVideo(shotId, file, { notes });
      setFile(null);
      setNotes("");
      onUploaded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section style={{ marginTop: 12, padding: 10, background: "rgba(0,0,0,0.02)", borderRadius: 8 }}>
      <strong>回传即梦视频</strong>
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
        <input
          type="file"
          accept="video/*"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        <input
          placeholder="备注(可选,例如'第 1 版,光线偏暗')"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <button className="primary" disabled={!file || busy} onClick={submit}>
          上传
        </button>
      </div>
      {err && <p style={{ color: "var(--error)", fontSize: 13 }}>{err}</p>}
    </section>
  );
}

function VideoAssetRow({ asset, onChanged }: { asset: ShotAsset; onChanged: () => void }) {
  const [score, setScore] = useState(asset.score ?? 0);
  const [tags, setTags] = useState<string[]>(asset.failure_tags);
  const [notes, setNotes] = useState(asset.notes);
  const [status, setStatus] = useState(asset.status);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.patchAsset(asset.id, {
        score: score || null,
        failure_tags: tags,
        notes,
        status,
      });
      onChanged();
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!confirm("确认删除该视频?文件会移到 .trash/")) return;
    await api.deleteAsset(asset.id);
    onChanged();
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong>v{asset.version}</strong>
        <span className="tag">{asset.status}</span>
        {asset.score != null && <span className="tag">{asset.score} 分</span>}
        <span className="muted" style={{ fontSize: 12 }}>
          {new Date(asset.created_at).toLocaleString()}
        </span>
        <button className="danger" style={{ marginLeft: "auto", padding: "2px 10px" }} onClick={remove}>
          删除
        </button>
      </header>

      {asset.file_path && (
        <video
          src={api.fileUrl(asset.file_path)}
          controls
          style={{ width: "100%", maxHeight: 320, marginTop: 8, background: "#000", borderRadius: 6 }}
        />
      )}

      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <label className="muted" style={{ fontSize: 13 }}>评分(1-5)</label>
          <input
            type="number"
            min={0}
            max={5}
            step={0.5}
            value={score || ""}
            onChange={(e) => setScore(parseFloat(e.target.value) || 0)}
            style={{ maxWidth: 100 }}
          />
          <select value={status} onChange={(e) => setStatus(e.target.value as ShotAsset["status"])} style={{ maxWidth: 140 }}>
            <option value="draft">draft</option>
            <option value="accepted">accepted</option>
            <option value="rejected">rejected</option>
          </select>
        </div>
        <div>
          <span className="muted" style={{ fontSize: 13 }}>失败标签:</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {FAILURE_TAG_OPTIONS.map((t) => {
              const on = tags.includes(t);
              return (
                <button
                  key={t}
                  className="secondary"
                  style={{
                    padding: "2px 10px",
                    fontSize: 12,
                    background: on ? "var(--warn)" : "transparent",
                    color: on ? "white" : "inherit",
                    borderColor: on ? "var(--warn)" : "var(--border)",
                  }}
                  onClick={() =>
                    setTags((prev) =>
                      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
                    )
                  }
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>
        <textarea
          placeholder="人工备注(为什么打这个分,问题在哪)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ minHeight: 60 }}
        />
        <button className="primary" disabled={saving} onClick={save} style={{ alignSelf: "flex-start" }}>
          {saving ? "保存中..." : "保存评分"}
        </button>
      </div>
    </div>
  );
}
