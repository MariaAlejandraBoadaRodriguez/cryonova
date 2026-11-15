import type { Metadata } from "next";
import { OpenInvestigation } from "@/components/dashboard/OpenInvestigation";

export const metadata: Metadata = { title: "Open with code · Cryonova" };

export default function OpenPage() {
  return (
    <div className="dash">
      <OpenInvestigation />
    </div>
  );
}
