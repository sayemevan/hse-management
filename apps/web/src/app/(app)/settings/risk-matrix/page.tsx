import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { RiskMatrixScreen } from "@/modules/safety-events/risk-matrix-screen";
import { CompanyOnly } from "@/modules/tenant/company-only";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("safetyEvents.matrix"))("title") };
}

/** PLT-34: the company risk matrix (readable by every user; editing needs risk.matrix.manage). */
export default function Page() {
  return (
    <CompanyOnly>
      <RiskMatrixScreen />
    </CompanyOnly>
  );
}
