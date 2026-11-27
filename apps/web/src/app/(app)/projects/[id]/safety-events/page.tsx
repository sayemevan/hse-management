import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ProjectSafetyEventsScreen } from "@/modules/safety-events/project-events-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("safetyEvents.tab"))("title") };
}

/** PLT-33: the project's Safety events tab. */
export default function Page() {
  return (
    <Suspense>
      <ProjectSafetyEventsScreen />
    </Suspense>
  );
}
