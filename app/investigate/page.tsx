import { redirect } from "next/navigation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The old workspace URL: runs move to their dashboard, questions to the new workspace. */
export default async function InvestigatePage({ searchParams }: { searchParams: Promise<{ q?: string; run?: string }> }) {
  const { q, run } = await searchParams;
  if (run && UUID.test(run)) redirect(`/investigations/${run}`);
  redirect(q ? `/?q=${encodeURIComponent(q.slice(0, 600))}` : "/");
}
