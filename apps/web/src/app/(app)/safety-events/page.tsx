import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { MyReportsScreen } from "@/modules/safety-events/my-reports-screen";
import { CompanyOnly } from "@/modules/tenant/company-only";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("safetyEvents.mine"))("title") };
}

/** PLT-33: My reports. Works offline (T-90). */
export default function Page() {
  return (
    <CompanyOnly>
      <Suspense>
        <MyReportsScreen />
      </Suspense>
    </CompanyOnly>
  );
}
