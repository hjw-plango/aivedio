"use client";

import StepCard from "./StepCard";

type Step = {
  id: string;
  agentName: string;
  status:
    | "pending"
    | "running"
    | "success"
    | "failed"
    | "rejected"
    | "skipped"
    | "paused";
  inputSummary?: string;
  outputSummary?: string;
};

export default function PipelineView({ steps }: { steps: Step[] }) {
  return (
    <section>
      {steps.length === 0 && <p style={{ opacity: 0.6 }}>暂无步骤。</p>}
      {steps.map((s) => (
        <StepCard
          key={s.id}
          agentName={s.agentName}
          status={s.status}
          inputSummary={s.inputSummary}
          outputSummary={s.outputSummary}
        />
      ))}
    </section>
  );
}
