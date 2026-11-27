"use client";

import {
  SAFETY_EVENT_FAMILIES,
  SAFETY_SEVERITIES,
  type SafetyEventPageDto,
} from "@hse/shared";
import { Megaphone } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useErrorMessage } from "@/modules/i18n/use-error-message";
import { useCurrentProject } from "@/modules/projects/project-context";
import { cn } from "@/utils/cn";

import { eventHref, REPORT_ROUTE } from "./safety-event-offline";
import { EventCard } from "./safety-event-ui";
import { safetyEventsService } from "./safety-events.service";

const FILTERS = [
  "open",
  "critical_high",
  "to_review",
  "overdue",
  "verification",
] as const;
type Filter = (typeof FILTERS)[number];

/** PLT-33: the project's Safety events tab — counts, filters, cards. */
export function ProjectSafetyEventsScreen() {
  const t = useTranslations("safetyEvents.tab");
  const ts = useTranslations("safetyEvents.severity");
  const tf = useTranslations("safetyEvents.family");
  const tc = useTranslations("common");
  const errorMessage = useErrorMessage();
  const { project } = useCurrentProject();
  const [filter, setFilter] = useState<Filter | null>("open");
  const [severity, setSeverity] = useState("");
  const [family, setFamily] = useState("");
  const [search, setSearch] = useState("");
  const [voided, setVoided] = useState(false);
  const [page, setPage] = useState<SafetyEventPageDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      safetyEventsService
        .list(project.id, {
          filter,
          severity,
          family,
          search: search.trim(),
          voided,
          limit: 50,
        })
        .then(
          (result) => {
            setPage(result);
            setError(null);
          },
          (failure: unknown) => {
            setError(errorMessage(failure));
          },
        );
    }, 200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [project.id, filter, severity, family, search, voided, errorMessage]);

  const counts = page?.counts;
  const countOf = (name: Filter) =>
    !counts
      ? null
      : name === "open"
        ? counts.open
        : name === "critical_high"
          ? counts.criticalHigh
          : name === "to_review"
            ? counts.toReview
            : name === "overdue"
              ? counts.overdueInvestigations
              : counts.verification;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        {page?.canReport ? (
          <Link
            href={`${REPORT_ROUTE}?project=${project.id}`}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-5 font-medium text-white hover:bg-primary/90"
          >
            <Megaphone aria-hidden className="size-5" />
            {t("report")}
          </Link>
        ) : null}
      </div>
      {page && !page.canViewAll ? (
        <Alert tone="info">{t("ownOnly")}</Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={filter === name}
            onClick={() => {
              setFilter(filter === name ? null : name);
            }}
            className={cn(
              "inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium",
              filter === name
                ? "border-primary bg-primary text-white"
                : "border-border hover:bg-muted",
            )}
          >
            {t(`filters.${name}`)}
            {countOf(name) !== null ? (
              <span className="tabular-nums">{countOf(name)}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          aria-label={t("search")}
          placeholder={t("search")}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
        />
        <Select
          aria-label={t("severity")}
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value);
          }}
        >
          <option value="">{t("anySeverity")}</option>
          {SAFETY_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {ts(s)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t("family")}
          value={family}
          onChange={(e) => {
            setFamily(e.target.value);
          }}
        >
          <option value="">{t("anyFamily")}</option>
          {SAFETY_EVENT_FAMILIES.map((f) => (
            <option key={f} value={f}>
              {tf(f)}
            </option>
          ))}
        </Select>
      </div>
      <Checkbox
        id="show-voided"
        label={t("showVoided")}
        checked={voided}
        onChange={(e) => {
          setVoided(e.target.checked);
        }}
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!page ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner />
          {tc("loading")}
        </div>
      ) : page.items.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
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
      )}
    </div>
  );
}
