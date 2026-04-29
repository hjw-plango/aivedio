// Centralised fetch helpers. All requests go through Next.js rewrites → FastAPI.

export type Project = {
  id: string;
  title: string;
  direction: string;
  brief: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type Material = {
  id: string;
  project_id: string;
  source_type: string;
  source_url: string | null;
  file_path: string | null;
  file_hash: string | null;
  content: string;
  version: number;
  created_at: string;
};

export type StepStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "rejected"
  | "skipped"
  | "paused";

export type Step = {
  id: string;
  graph_run_id: string;
  parent_step_id: string | null;
  agent_name: string;
  step_name: string;
  status: StepStatus;
  sequence: number;
  input_summary: string;
  output_summary: string;
  artifact_refs: string[];
  warnings: { message: string }[];
  error: string | null;
  retry_count: number;
  created_at: string;
  finished_at: string | null;
};

export type Run = {
  id: string;
  project_id: string;
  workflow: string;
  status: string;
  auto_mode: boolean;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  steps: Step[];
};

export type StepEvent = {
  id: string;
  step_id: string;
  event_type: string;
  visibility: "detail" | "summary" | "hidden";
  payload: Record<string, unknown>;
  created_at: string;
};

export type FactCard = {
  id: string;
  project_id: string;
  topic: string;
  category: string;
  content: string;
  confidence: number;
  source_span: Record<string, unknown>;
  culture_review: Record<string, unknown>;
  review_status: string;
  version: number;
  created_at: string;
  updated_at: string;
};

const BASE = process.env.NEXT_PUBLIC_API_BASE || "";

async function http<T>(
  path: string,
  init: RequestInit = {},
  expectJson = true,
): Promise<T> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return expectJson ? ((await res.json()) as T) : (undefined as unknown as T);
}

export const api = {
  // projects
  listProjects: () => http<Project[]>("/api/projects"),
  createProject: (body: { title: string; direction?: string; brief?: string }) =>
    http<Project>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  getProject: (id: string) => http<Project>(`/api/projects/${id}`),

  // materials
  listMaterials: (projectId: string) =>
    http<Material[]>(`/api/projects/${projectId}/materials`),
  createMaterial: (projectId: string, body: { content: string; source_type?: string }) =>
    http<Material>(`/api/projects/${projectId}/materials`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  uploadMaterial: async (projectId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${BASE}/api/projects/${projectId}/materials/upload`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    return (await res.json()) as Material;
  },

  // facts
  listFacts: (projectId: string, params?: { category?: string; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set("category", params.category);
    if (params?.q) qs.set("q", params.q);
    const tail = qs.toString() ? `?${qs.toString()}` : "";
    return http<FactCard[]>(`/api/projects/${projectId}/facts${tail}`);
  },
  patchFact: (projectId: string, factId: string, patch: Partial<FactCard>) =>
    http<FactCard>(`/api/projects/${projectId}/facts/${factId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  // runs
  workflows: () => http<string[]>("/api/runs/workflows"),
  createRun: (body: { project_id: string; workflow?: string; auto_mode?: boolean }) =>
    http<Run>("/api/runs", { method: "POST", body: JSON.stringify(body) }),
  listRuns: (projectId?: string) => {
    const q = projectId ? `?project_id=${projectId}` : "";
    return http<Run[]>(`/api/runs${q}`);
  },
  getRun: (id: string) => http<Run>(`/api/runs/${id}`),
  resume: (id: string) =>
    http<Run>(`/api/runs/${id}/resume`, { method: "POST" }),
  rerun: (id: string, stepId: string) =>
    http<Run>(`/api/runs/${id}/rerun`, {
      method: "POST",
      body: JSON.stringify({ step_id: stepId }),
    }),
  events: (id: string, since = 0) =>
    http<StepEvent[]>(`/api/runs/${id}/events?since=${since}`),
  streamUrl: (id: string) => `${BASE}/api/runs/${id}/stream`,
};
