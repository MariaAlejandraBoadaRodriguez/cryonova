import type { Metadata } from "next";
import { Workspace } from "@/components/Workspace";

export const metadata: Metadata = { title: "New investigation · Cryonova" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function InvestigatePage({ searchParams }: { searchParams: Promise<{ q?: string; run?: string }> }) {
  const { q, run } = await searchParams;
  return <Workspace initialQuestion={(q ?? "").slice(0, 600)} initialRunId={run && UUID.test(run) ? run : null} />;
}
