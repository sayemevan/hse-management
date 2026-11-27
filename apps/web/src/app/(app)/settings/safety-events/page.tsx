import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { RequirePermission } from "@/modules/auth/require-permission";
import { SafetySettingsScreen } from "@/modules/safety-events/settings-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("safetyEvents.settings"))("title") };
}

/** PLT-33, US-044: event types and the company lists. */
export default function Page() {
  return (
    <RequirePermission permission="safety_events.settings.manage">
      <SafetySettingsScreen />
    </RequirePermission>
  );
}
