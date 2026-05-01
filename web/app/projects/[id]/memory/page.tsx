import MemoryView from "./_view";

type Props = { params: Promise<{ id: string }> };

export default async function MemoryPage({ params }: Props) {
  const { id } = await params;
  return <MemoryView projectId={id} />;
}
