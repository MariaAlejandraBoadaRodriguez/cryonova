import type { Metadata } from "next";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { draftFromParams } from "@/src/plan/url";

export const metadata: Metadata = { title: "Cryonova · Earth Trend Detective" };

type Params = Record<string, string | string[] | undefined>;

/** The workspace. "?q=" asks the assistant on arrival; setup parameters (from "Back to setup") restore a selection. */
export default async function Home({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 600) : "";
  const draft = draftFromParams(params);
  return <WorkspaceShell key={JSON.stringify(params)} initialQuestion={q} initialDraft={draft} />;
}
