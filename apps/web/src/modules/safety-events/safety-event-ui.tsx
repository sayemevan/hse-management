"use client";

import {
  localized,
  rateRisk,
  type RiskBandKey,
  type RiskMatrix,
  type RiskText,
  type SafetyEventFamily,
  type SafetyEventStatus,
  type SafetyEventSummaryDto,
  type SafetySeverity,
} from "@hse/shared";
import {
  AlertOctagon,
  AlertTriangle,
  Ban,
  CircleDashed,
  ClipboardCheck,
  Clock,
  Flame,
  Inbox,
  Lock,
  Search,
  ShieldAlert,
  Wrench,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";

import { NotSyncedChip, SmallChip } from "@/modules/inspections/inspection-ui";
import { useDateFormat } from "@/modules/i18n/use-date-format";
import { cn } from "@/utils/cn";

export const FAMILY_ICONS: Record<SafetyEventFamily, typeof Zap> = {
  hazard: AlertTriangle,
  near_miss: Zap,
  incident: Flame,
};

const STATUS_ICONS: Record<SafetyEventStatus, typeof Zap> = {
  reported: Inbox,
  under_investigation: Search,
  corrective_action: Wrench,
  verification: ClipboardCheck,
  closed: Lock,
};

const STATUS_STYLES: Record<SafetyEventStatus, string> = {
  reported: "border-warning/40 bg-warning/10 text-foreground",
  under_investigation: "border-primary/40 bg-primary/10 text-primary",
  corrective_action: "border-primary/40 bg-primary/10 text-primary",
  verification: "border-success/40 bg-success/10 text-foreground",
  closed: "border-border bg-background text-muted-foreground",
};

/** The type's name in the reader's language (O-143). */
export function useTypeName() {
  const locale = useLocale();
  return useCallback(
    (item: {
      typeNameEn?: string | null;
      typeNameAr?: string | null;
      nameEn?: string | null;
      nameAr?: string | null;
    }) =>
      localized(
        {
          en: item.typeNameEn ?? item.nameEn ?? null,
          ar: item.typeNameAr ?? item.nameAr ?? null,
        },
        locale,
      ),
    [locale],
  );
}

export function useRiskText() {
  const locale = useLocale();
  return useCallback(
    (text: RiskText | null | undefined) => localized(text ?? null, locale),
    [locale],
  );
}

/** Status with icon and word (never colour alone, PLT-33 UI). */
export function EventStatusChip({
  status,
  voided,
}: {
  status: SafetyEventStatus;
  voided?: boolean;
}) {
  const t = useTranslations("safetyEvents.status");
  if (voided) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium">
        <Ban aria-hidden className="size-3.5" />
        {t("voided")}
      </span>
    );
  }
  const Icon = STATUS_ICONS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status],
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {t(status)}
    </span>
  );
}

export function SeverityChip({
  severity,
  proposed,
}: {
  severity: SafetySeverity;
  proposed?: boolean;
}) {
  const t = useTranslations("safetyEvents.severity");
  const high = severity === "high" || severity === "critical";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        severity === "critical" && "border-danger bg-danger text-white",
        severity === "high" && "border-danger/40 bg-danger/10 text-danger",
        !high && "border-border",
      )}
    >
      {high ? (
        <AlertOctagon aria-hidden className="size-3.5" />
      ) : (
        <ShieldAlert aria-hidden className="size-3.5" />
      )}
      {proposed ? t("proposed", { level: t(severity) }) : t(severity)}
    </span>
  );
}

export function RiskBandChip({
  bandKey,
  label,
  score,
}: {
  bandKey: RiskBandKey;
  label: RiskText;
  score?: number;
}) {
  const text = useRiskText();
  const t = useTranslations("safetyEvents.risk");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        bandKey === "critical" && "border-danger bg-danger text-white",
        bandKey === "high" && "border-danger/40 bg-danger/10 text-danger",
        bandKey === "medium" && "border-warning/40 bg-warning/10",
        bandKey === "low" && "border-border",
      )}
    >
      {t("band", { band: text(label) })}
      {score !== undefined ? (
        <bdi dir="ltr" className="tabular-nums">
          {String(score)}
        </bdi>
      ) : null}
    </span>
  );
}

/** One event in a list (Safety events tab, My reports). */
export function EventCard({
  item,
  href,
}: {
  item: SafetyEventSummaryDto;
  href: string;
}) {
  const t = useTranslations("safetyEvents");
  const typeName = useTypeName();
  const { dateTime } = useDateFormat();
  return (
    <li>
      <Link
        href={href}
        className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 hover:bg-muted/50 focus-visible:outline-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          {item.reference ? (
            <bdi dir="ltr" className="text-sm font-semibold">
              {item.reference}
            </bdi>
          ) : (
            <NotSyncedChip />
          )}
          <EventStatusChip status={item.status} voided={item.voided} />
          {item.underReview ? (
            <SmallChip icon={Search}>{t("underReview")}</SmallChip>
          ) : null}
          {item.urgent ? (
            <SmallChip icon={AlertOctagon} tone="danger">
              {t("urgent")}
            </SmallChip>
          ) : null}
          <SeverityChip
            severity={item.severity ?? item.reportedSeverity}
            proposed={item.severity === null}
          />
          {item.riskBandKey && item.riskBandLabel ? (
            <RiskBandChip
              bandKey={item.riskBandKey}
              label={item.riskBandLabel}
            />
          ) : null}
          {item.investigationOverdueDays > 0 ? (
            <SmallChip icon={CircleDashed} tone="danger">
              {t("overdue", { days: item.investigationOverdueDays })}
            </SmallChip>
          ) : null}
          {item.reportedLate ? (
            <SmallChip icon={Clock}>{t("reportedLate")}</SmallChip>
          ) : null}
        </div>
        <p className="font-medium">{item.title}</p>
        <p className="text-sm text-muted-foreground">
          {[
            typeName(item),
            item.placeName,
            item.reportedBy?.name,
            dateTime(item.occurredAt),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </Link>
    </li>
  );
}

/**
 * PLT-34: the matrix as a table (likelihood rows × consequence columns); every cell shows the
 * score and the band word. `onPick` makes the cells buttons (the review sheet).
 */
export function RiskGrid({
  matrix,
  value,
  onPick,
}: {
  matrix: RiskMatrix;
  value?: { likelihood: number; consequence: number } | null;
  onPick?: (likelihood: number, consequence: number) => void;
}) {
  const t = useTranslations("safetyEvents.risk");
  const text = useRiskText();
  const likelihood = [...matrix.likelihood].reverse();
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[28rem] border-collapse text-xs">
        <caption className="sr-only">{t("gridCaption")}</caption>
        <thead>
          <tr>
            <th scope="col" className="p-2 text-start font-medium">
              {t("axes")}
            </th>
            {matrix.consequence.map((c) => (
              <th
                key={c.value}
                scope="col"
                className="p-2 text-center font-medium"
              >
                <bdi dir="ltr">{String(c.value)}</bdi> {text(c.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {likelihood.map((l) => (
            <tr key={l.value}>
              <th scope="row" className="p-2 text-start font-medium">
                <bdi dir="ltr">{String(l.value)}</bdi> {text(l.label)}
              </th>
              {matrix.consequence.map((c) => {
                const rating = rateRisk(matrix, l.value, c.value);
                const chosen =
                  value?.likelihood === l.value &&
                  value.consequence === c.value;
                const key = rating?.band.key;
                const body = (
                  <>
                    <bdi
                      dir="ltr"
                      className="block text-sm font-semibold tabular-nums"
                    >
                      {String(rating?.score ?? l.value * c.value)}
                    </bdi>
                    <span>
                      {rating ? text(rating.band.label) : t("noBand")}
                    </span>
                  </>
                );
                const cellClass = cn(
                  "h-14 w-full rounded-md border p-1 text-center",
                  key === "critical" && "border-danger bg-danger text-white",
                  key === "high" && "border-danger/40 bg-danger/15",
                  key === "medium" && "border-warning/40 bg-warning/15",
                  key === "low" && "border-success/40 bg-success/10",
                  !key && "border-dashed border-border",
                  chosen && "outline-3 outline-offset-1 outline-primary",
                );
                return (
                  <td key={c.value} className="p-1">
                    {onPick ? (
                      <button
                        type="button"
                        aria-pressed={chosen}
                        aria-label={t("cellLabel", {
                          likelihood: text(l.label),
                          consequence: text(c.label),
                          score: rating?.score ?? 0,
                          band: rating ? text(rating.band.label) : "",
                        })}
                        className={cellClass}
                        onClick={() => {
                          onPick(l.value, c.value);
                        }}
                      >
                        {body}
                      </button>
                    ) : (
                      <div className={cellClass}>{body}</div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
