import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ReportScreen } from "@/modules/safety-events/report-screen";
import { CompanyOnly } from "@/modules/tenant/company-only";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("safetyEvents.report"))("title") };
}

/** US-040 – US-042: report a hazard, near miss or incident. Works offline (T-90). */
export default function Page() {
  return (
    <CompanyOnly>
      <Suspense>
        <ReportScreen />
      </Suspense>
    </CompanyOnly>
  );
}
