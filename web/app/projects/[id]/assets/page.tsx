import AssetsView from "./_view";

type Props = { params: Promise<{ id: string }> };

export default async function AssetsPage({ params }: Props) {
  const { id } = await params;
  return <AssetsView projectId={id} />;
}
