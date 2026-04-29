import FactsView from "./_view";

type Props = { params: Promise<{ id: string }> };

export default async function FactsPage({ params }: Props) {
  const { id } = await params;
  return <FactsView projectId={id} />;
}
