"use client";

import {
  MY_SAFETY_EVENT_TABS,
  type MySafetyEventsPageDto,
  type MySafetyEventTab,
} from "@hse/shared";
import { Megaphone, Trash2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/modules/auth/auth-provider";
import { useErrorMessage } from "@/modules/i18n/use-error-message";
import { NotSyncedChip } from "@/modules/inspections/inspection-ui";
import { useSync } from "@/modules/offline/sync-provider";
import { cn } from "@/utils/cn";

import {
  eventHref,
  keepReports,
  listCopies,
  listDrafts,
  refreshSettingsPack,
  removeDraft,
  REPORT_ROUTE,
  type ReportCopy,
  type ReportDraft,
} from "./safety-event-offline";
import {
  EventCard,
  EventStatusChip,
  SeverityChip,
  useTypeName,
} from "./safety-event-ui";
import { safetyEventsService } from "./safety-events.service";

/** PLT-33 My reports — works offline: drafts, queued reports and the last 20 copies (T-90). */
export function MyReportsScreen() {
  const t = useTranslations("safetyEvents.mine");
  const tc = useTranslations("common");
  const errorMessage = useErrorMessage();
  const params = useSearchParams();
  const { user } = useAuth();
  const { online, items: outbox } = useSync();
  const typeName = useTypeName();
  const initial = params.get("tab") as MySafetyEventTab | null;
  const [tab, setTab] = useState<MySafetyEventTab>(
    initial && MY_SAFETY_EVENT_TABS.includes(initial) ? initial : "reported",
  );
  const [page, setPage] = useState<MySafetyEventsPageDto | null>(null);
  const [copies, setCopies] = useState<ReportCopy[]>([]);
  const [drafts, setDrafts] = useState<ReportDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sent = params.get("sent");

  const syncedCount = outbox.filter((item) => item.state === "synced").length;
  const load = useCallback(async () => {
    if (!user) return;
    if (online) {
      try {
        const result = await safetyEventsService.mine(tab);
        setPage(result);
        setError(null);
        void refreshSettingsPack(user.id);
        if (tab === "reported") await keepReports(user.id, result.items);
      } catch (failure) {
        setError(errorMessage(failure));
      }
    }
    setCopies(await listCopies(user.id));
    setDrafts(await listDrafts(user.id));
  }, [user, online, tab, errorMessage]);

  useEffect(() => {
    void load();
  }, [load, syncedCount]);

  if (!user) return null;
  const pending = new Set(
    outbox
      .filter((item) => item.state !== "synced")
      .map((item) => item.entityId),
  );
  // Online: only what is still waiting to sync; offline: everything this device knows.
  const deviceOnly = online
    ? copies.filter((copy) => pending.has(copy.id))
    : copies;
  const sentCopy = sent ? copies.find((c) => c.id === sent) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Link
          href={REPORT_ROUTE}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-5 font-medium text-white hover:bg-primary/90"
        >
          <Megaphone aria-hidden className="size-5" />
          {t("report")}
        </Link>
      </div>
      {sent ? (
        <Alert tone="success">
          {sentCopy?.reference
            ? t("sentNumber", { ref: sentCopy.reference })
            : online
              ? t("sending")
              : t("savedOffline")}
        </Alert>
      ) : null}
      {!online ? <Alert tone="info">{t("offline")}</Alert> : null}

      {drafts.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="drafts">
          <h2 id="drafts" className="text-lg font-semibold">
            {t("drafts")}
          </h2>
          <ul className="flex flex-col gap-2">
            {drafts.map((draft) => (
              <li
                key={draft.id}
                className="flex items-center gap-2 rounded-xl border border-dashed border-border p-3"
              >
                <Link
                  href={`${REPORT_ROUTE}?draft=${draft.id}`}
                  className="flex flex-1 flex-col gap-1"
                >
                  <span className="font-medium">
                    {draft.body.title || t("untitled")}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    <bdi dir="ltr">{draft.projectCode}</bdi> · {typeName(draft)}
                  </span>
                </Link>
                <button
                  type="button"
                  aria-label={t("deleteDraft")}
                  className="rounded-lg p-2 hover:bg-muted"
                  onClick={() => {
                    void removeDraft(user.id, draft.id).then(load);
                  }}
                >
                  <Trash2 aria-hidden className="size-5" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {online ? (
        <div className="flex flex-wrap gap-2" role="tablist">
          {MY_SAFETY_EVENT_TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => {
                setTab(name);
                setPage(null);
              }}
              className={cn(
                "inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium",
                tab === name
                  ? "border-primary bg-primary text-white"
                  : "border-border hover:bg-muted",
              )}
            >
              {t(`tabs.${name}`)}
              {page ? (
                <span className="tabular-nums">{page.counts[name]}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {deviceOnly.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="on-device">
          <h2 id="on-device" className="text-lg font-semibold">
            {online ? t("waiting") : t("onDevice")}
          </h2>
          <ul className="flex flex-col gap-2">
            {deviceOnly.map((copy) => (
              <li
                key={copy.id}
                className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {copy.reference ? (
                    <bdi dir="ltr" className="text-sm font-semibold">
                      {copy.reference}
                    </bdi>
                  ) : (
                    <NotSyncedChip />
                  )}
                  <EventStatusChip status={copy.status} />
                  <SeverityChip severity={copy.reportedSeverity} proposed />
                  {pending.has(copy.id) ? (
                    <span className="text-xs text-muted-foreground">
                      {t("waitingToSync")}
                    </span>
                  ) : null}
                </div>
                <span className="font-medium">{copy.title}</span>
                <span className="text-sm text-muted-foreground">
                  <bdi dir="ltr">{copy.projectCode}</bdi> · {typeName(copy)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {online ? (
        !page ? (
          <div className="flex items-center gap-3" role="status">
            <Spinner />
            {tc("loading")}
          </div>
        ) : page.items.length === 0 ? (
          <p className="text-muted-foreground">{t(`empty.${tab}`)}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {page.items.map((item) => (
              <EventCard
                key={item.id}
                item={item}
                href={eventHref(item.projectId, item.id)}
              />
            ))}
          </ul>
        )
      ) : deviceOnly.length === 0 && drafts.length === 0 ? (
        <p className="text-muted-foreground">{t("nothingOffline")}</p>
      ) : null}
    </div>
  );
}
