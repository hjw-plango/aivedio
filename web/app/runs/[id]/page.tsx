import RunView from "./_view";

type Props = { params: Promise<{ id: string }> };

export default async function RunPage({ params }: Props) {
  const { id } = await params;
  return <RunView runId={id} />;
}
