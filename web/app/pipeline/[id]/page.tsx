type Props = { params: Promise<{ id: string }> };

export default async function PipelinePage({ params }: Props) {
  const { id } = await params;
  return (
    <main style={{ padding: 32, maxWidth: 960, margin: "0 auto" }}>
      <h1>Pipeline · {id}</h1>
      <p style={{ opacity: 0.7 }}>
        M1 后接入 GraphRun / StepEvent SSE 流。当前为占位页。
      </p>
    </main>
  );
}
