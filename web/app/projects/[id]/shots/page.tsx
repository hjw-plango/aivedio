import ShotsView from "./_view";

type Props = { params: Promise<{ id: string }> };

export default async function ShotsPage({ params }: Props) {
  const { id } = await params;
  return <ShotsView projectId={id} />;
}
