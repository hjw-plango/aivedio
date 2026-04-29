"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, Run, Step, StepEvent } from "@/lib/api";
import { EVENT_DISPLAY, STEP_STATUS_DISPLAY, VISIBILITY_LABEL } from "@/lib/eventTypes";

type Visibility = "detail" | "summary" | "hidden";

export default function RunView({ runId }: { runId: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<Visibility>("summary");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const refreshRun = useCallback(async () => {
    try {
      setRun(await api.getRun(runId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [runId]);

  // initial fetch + history
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.getRun(runId);
        if (cancelled) return;
        setRun(r);
        if (!selected && r.steps.length > 0) setSelected(r.steps[0].id);
        const initial = await api.events(runId);
        if (!cancelled) setEvents(initial);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]); // eslint-disable-line react-hooks/exhaustive-deps

  // SSE subscribe
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = api.streamUrl(runId);
    const es = new EventSource(url);
    eventSourceRef.current = es;
    const handle = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as StepEvent;
        if (!data || !data.id) return;
        setEvents((prev) => {
          if (prev.find((e) => e.id === data.id)) return prev;
          return [...prev, data];
        });
        // any event arrival hints state change — re-fetch run shape
        refreshRun();
      } catch {
        // ignore (ping)
      }
    };
    const types = [
      "progress_note",
      "tool_call",
      "tool_result",
      "artifact",
      "warning",
      "error",
      "finish",
    ];
    types.forEach((t) => es.addEventListener(t, handle as EventListener));
    es.onerror = () => {
      // browser will auto-reconnect; we just refresh
      refreshRun();
    };
    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [runId, refreshRun]);

  // Polling safety net: full event list, dedupe by id, then merge.
  // We do NOT use offset/since here — SSE arrival is unordered relative to
  // DB write commit, and offset-based pagination races with concurrent emits.
  useEffect(() => {
    const t = setInterval(() => {
      api.events(runId)
        .then((all) => {
          setEvents((prev) => {
            if (all.length === prev.length) return prev;
            const seen = new Set(prev.map((e) => e.id));
            const merged = [...prev];
            for (const e of all) {
              if (!seen.has(e.id)) merged.push(e);
            }
            // keep stable insertion order; new events appended.
            return merged;
          });
        })
        .catch(() => {});
      refreshRun();
    }, 5000);
    return () => clearInterval(t);
  }, [runId, refreshRun]);

  const stepsById = useMemo(() => {
    const map: Record<string, Step> = {};
    if (run) for (const s of run.steps) map[s.id] = s;
    return map;
  }, [run]);

  const eventsByStep = useMemo(() => {
    const out: Record<string, StepEvent[]> = {};
    for (const e of events) {
      if (!out[e.step_id]) out[e.step_id] = [];
      out[e.step_id].push(e);
    }
    return out;
  }, [events]);

  if (err) {
    return (
      <main className="container">
        <div className="card" style={{ background: "var(--error)", color: "white" }}>{err}</div>
      </main>
    );
  }
  if (!run) {
    return (
      <main className="container">
        <p className="muted">加载中...</p>
      </main>
    );
  }

  const visibleEvents = (stepId: string) => {
    const list = eventsByStep[stepId] || [];
    if (visibility === "detail") return list;
    if (visibility === "summary") {
      return list.filter((e) =>
        ["artifact", "warning", "error", "finish"].includes(e.event_type),
      );
    }
    // hidden: only show final artifacts per design.md §6
    return list.filter((e) => e.event_type === "artifact");
  };

  return (
    <main className="container">
      <header style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2>Pipeline</h2>
        <span className="tag">{run.status}</span>
        <span className="muted">{run.id}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {(["detail", "summary", "hidden"] as Visibility[]).map((v) => (
            <button
              key={v}
              className={visibility === v ? "primary" : "secondary"}
              onClick={() => setVisibility(v)}
            >
              {VISIBILITY_LABEL[v]}
            </button>
          ))}
          {run.status === "paused" && (
            <button
              className="primary"
              onClick={async () => {
                await api.resume(runId);
                refreshRun();
              }}
            >
              ▶ 继续下一步
            </button>
          )}
        </span>
      </header>

      <section style={{ marginTop: 16, display: "grid", gap: 16, gridTemplateColumns: "260px 1fr" }}>
        {/* Flow nav */}
        <aside className="card" style={{ alignSelf: "start", position: "sticky", top: 80 }}>
          {run.steps.map((s, idx) => {
            const evs = eventsByStep[s.id] || [];
            const last = evs[evs.length - 1];
            return (
              <div
                key={s.id}
                onClick={() => setSelected(s.id)}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  cursor: "pointer",
                  background: selected === s.id ? "rgba(99,102,241,0.1)" : "transparent",
                  borderLeft: `3px solid ${STEP_STATUS_DISPLAY[s.status]?.color}`,
                  marginBottom: 4,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>
                    {idx + 1}. {s.agent_name}
                  </strong>
                  <span className="tag">{STEP_STATUS_DISPLAY[s.status]?.label}</span>
                </div>
                {last && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {EVENT_DISPLAY[last.event_type]?.label}: {summarizeEvent(last)}
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        {/* Selected step detail */}
        <section className="card">
          {(() => {
            const step = selected ? stepsById[selected] : null;
            if (!step) return <p className="muted">选择左侧步骤</p>;
            const evs = visibleEvents(step.id);
            return (
              <div>
                <header style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                  <h3 style={{ margin: 0 }}>{step.agent_name}</h3>
                  <span className="tag" style={{ background: STEP_STATUS_DISPLAY[step.status]?.color, color: "white" }}>
                    {STEP_STATUS_DISPLAY[step.status]?.label}
                  </span>
                  {step.parent_step_id && (
                    <span className="muted">重跑自 {step.parent_step_id.slice(0, 12)}</span>
                  )}
                  <button
                    className="secondary"
                    style={{ marginLeft: "auto" }}
                    onClick={async () => {
                      await api.rerun(runId, step.id);
                      refreshRun();
                    }}
                  >
                    重跑此步
                  </button>
                </header>

                {step.error && (
                  <pre className="card" style={{ background: "rgba(220,38,38,0.1)", color: "var(--error)", marginTop: 12, whiteSpace: "pre-wrap" }}>
                    {step.error}
                  </pre>
                )}
                {step.output_summary && (
                  <p style={{ marginTop: 12 }}>
                    <span className="muted">输出: </span>
                    {step.output_summary}
                  </p>
                )}
                {step.warnings.length > 0 && (
                  <ul style={{ color: "var(--warn)" }}>
                    {step.warnings.map((w, i) => (
                      <li key={i}>{w.message}</li>
                    ))}
                  </ul>
                )}

                <h4 style={{ marginTop: 24 }}>事件流 ({evs.length})</h4>
                <ul style={{ listStyle: "none", padding: 0 }}>
                  {evs.map((e) => {
                    const disp = EVENT_DISPLAY[e.event_type];
                    const open = expanded[e.id];
                    const collapsible = e.event_type === "progress_note";
                    return (
                      <li key={e.id} style={{ padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                          <span className="tag" style={{ borderColor: disp?.color, color: disp?.color }}>
                            {disp?.label || e.event_type}
                          </span>
                          <span className="muted" style={{ fontSize: 12 }}>
                            {new Date(e.created_at).toLocaleTimeString()}
                          </span>
                          {collapsible && (
                            <button
                              className="secondary"
                              style={{ padding: "2px 8px", fontSize: 12 }}
                              onClick={() =>
                                setExpanded((prev) => ({ ...prev, [e.id]: !prev[e.id] }))
                              }
                            >
                              {open ? "收起" : "展开"}
                            </button>
                          )}
                        </div>
                        <div style={{ marginTop: 4, fontSize: 14 }}>
                          {collapsible && !open ? (
                            <span className="muted">
                              {String((e.payload as Record<string, unknown>).note || "").slice(0, 60)}
                              {String((e.payload as Record<string, unknown>).note || "").length > 60 ? "…" : ""}
                            </span>
                          ) : (
                            <PayloadView payload={e.payload} />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })()}
        </section>
      </section>
    </main>
  );
}

function summarizeEvent(e: StepEvent): string {
  const p = e.payload as Record<string, unknown>;
  if (e.event_type === "progress_note") return String(p.note || "");
  if (e.event_type === "tool_call") return `→ ${p.tool}`;
  if (e.event_type === "tool_result") return `${p.tool} ok`;
  if (e.event_type === "artifact") return `${p.kind}: ${p.summary || p.ref || ""}`;
  if (e.event_type === "warning") return String(p.message || "");
  if (e.event_type === "error") return String(p.message || "");
  if (e.event_type === "finish") return String(p.output || "");
  return JSON.stringify(p).slice(0, 80);
}

function PayloadView({ payload }: { payload: Record<string, unknown> }) {
  const note = payload.note as string | undefined;
  if (note) return <span>{note}</span>;
  const message = payload.message as string | undefined;
  if (message) return <span>{message}</span>;
  if (payload.kind && payload.summary) {
    return (
      <span>
        <strong>{String(payload.kind)}</strong>: {String(payload.summary)}
      </span>
    );
  }
  return (
    <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>
      {JSON.stringify(payload, null, 2).slice(0, 600)}
    </pre>
  );
}
