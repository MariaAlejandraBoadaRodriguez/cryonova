import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RunDashboard } from "@/components/dashboard/RunDashboard";

export const metadata: Metadata = { title: "Investigation results · Cryonova" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function InvestigationPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!UUID.test(runId)) notFound();
  return (
    <div className="dash">
      <RunDashboard runId={runId} />
    </div>
  );
}
