"use client";

import {
  INVESTIGATION_RULES,
  type InvestigationRule,
  RISK_RATING_RULES,
  type RiskRatingRule,
  SAFETY_EVENT_FAMILIES,
  SAFETY_LISTS,
  SAFETY_SEVERITIES,
  type SafetyEventFamily,
  type SafetyEventTypeDto,
  type SafetyList,
  type SafetySettingsDto,
  type SafetySeverity,
} from "@hse/shared";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useState } from "react";

import { FormField } from "@/components/form/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useErrorMessage } from "@/modules/i18n/use-error-message";
import { FormDialog } from "@/modules/workforce/workforce-ui";

import { useTypeName } from "./safety-event-ui";
import { safetySettingsService } from "./safety-events.service";

interface TypeForm {
  id: string | null;
  nameEn: string;
  nameAr: string;
  family: SafetyEventFamily;
  investigation: InvestigationRule;
  minSeverity: SafetySeverity | "";
  injuryDetails: boolean;
  areaRequired: boolean;
  riskRating: RiskRatingRule;
  inUse: boolean;
}

function formOf(type: SafetyEventTypeDto | null): TypeForm {
  return {
    id: type?.id ?? null,
    nameEn: type?.nameEn ?? "",
    nameAr: type?.nameAr ?? "",
    family: type?.family ?? "hazard",
    investigation: type?.investigation ?? "by_severity",
    minSeverity: type?.minSeverity ?? "",
    injuryDetails: type?.injuryDetails ?? false,
    areaRequired: type?.areaRequired ?? false,
    riskRating: type?.riskRating ?? "optional",
    inUse: type?.inUse ?? false,
  };
}

/** PLT-33, US-044: event types with their rules, categories and cause lists. */
export function SafetySettingsScreen() {
  const t = useTranslations("safetyEvents.settings");
  const tf = useTranslations("safetyEvents.family");
  const ts = useTranslations("safetyEvents.severity");
  const tc = useTranslations("common");
  const errorMessage = useErrorMessage();
  const typeName = useTypeName();
  const [settings, setSettings] = useState<SafetySettingsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TypeForm | null>(null);
  const [newItem, setNewItem] = useState<
    Record<SafetyList, { en: string; ar: string }>
  >({
    category: { en: "", ar: "" },
    immediate_cause: { en: "", ar: "" },
    root_cause: { en: "", ar: "" },
  });
  const ids = {
    en: useId(),
    ar: useId(),
    family: useId(),
    investigation: useId(),
    min: useId(),
    risk: useId(),
  };

  const load = useCallback(() => {
    safetySettingsService.get().then(setSettings, (failure: unknown) => {
      setError(errorMessage(failure));
    });
  }, [errorMessage]);
  useEffect(load, [load]);

  if (!settings) {
    return error ? (
      <Alert tone="danger">{error}</Alert>
    ) : (
      <div className="flex items-center gap-3" role="status">
        <Spinner />
        {tc("loading")}
      </div>
    );
  }
  const manage = settings.canManage;
  const run = (work: Promise<unknown>) => {
    setError(null);
    work.then(
      () => {
        setEditing(null);
        load();
      },
      (failure: unknown) => {
        setError(errorMessage(failure));
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <section className="flex flex-col gap-3" aria-labelledby="types">
        <div className="flex items-center justify-between gap-2">
          <h2 id="types" className="text-lg font-semibold">
            {t("types")}
          </h2>
          {manage ? (
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(formOf(null));
              }}
            >
              <Plus aria-hidden className="size-4" />
              {t("addType")}
            </Button>
          ) : null}
        </div>
        <ul className="flex flex-col gap-2">
          {settings.types.map((type, index) => (
            <li
              key={type.id}
              className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center"
            >
              <div className="flex flex-1 flex-col gap-1">
                <span className="font-medium">
                  {typeName(type)}
                  {!type.active ? ` · ${t("inactive")}` : ""}
                </span>
                <span className="text-sm text-muted-foreground">
                  {[
                    tf(type.family),
                    t(`investigation.${type.investigation}`),
                    type.minSeverity
                      ? t("minimum", { level: ts(type.minSeverity) })
                      : null,
                    type.injuryDetails ? t("injuryDetails") : null,
                    type.riskRating === "required" ? t("riskRequired") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              {manage ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    aria-label={t("moveUp")}
                    disabled={index === 0}
                    onClick={() => {
                      run(safetySettingsService.moveType(type.id, "up"));
                    }}
                  >
                    <ArrowUp aria-hidden className="size-4" />
                  </Button>
                  <Button
                    variant="secondary"
                    aria-label={t("moveDown")}
                    disabled={index === settings.types.length - 1}
                    onClick={() => {
                      run(safetySettingsService.moveType(type.id, "down"));
                    }}
                  >
                    <ArrowDown aria-hidden className="size-4" />
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditing(formOf(type));
                    }}
                  >
                    {tc("edit")}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      run(
                        safetySettingsService.setTypeActive(
                          type.id,
                          !type.active,
                        ),
                      );
                    }}
                  >
                    {type.active ? t("deactivate") : t("reactivate")}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {SAFETY_LISTS.map((list) => (
        <section
          key={list}
          className="flex flex-col gap-3"
          aria-labelledby={`list-${list}`}
        >
          <h2 id={`list-${list}`} className="text-lg font-semibold">
            {t(`lists.${list}`)}
          </h2>
          <ul className="flex flex-col gap-2">
            {settings.lists[list].map((item, index) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3"
              >
                <span className="flex-1">
                  {typeName(item)}
                  {!item.active ? ` · ${t("inactive")}` : ""}
                </span>
                {manage ? (
                  <>
                    <Button
                      variant="secondary"
                      aria-label={t("moveUp")}
                      disabled={index === 0}
                      onClick={() => {
                        run(safetySettingsService.moveItem(item.id, "up"));
                      }}
                    >
                      <ArrowUp aria-hidden className="size-4" />
                    </Button>
                    <Button
                      variant="secondary"
                      aria-label={t("moveDown")}
                      disabled={index === settings.lists[list].length - 1}
                      onClick={() => {
                        run(safetySettingsService.moveItem(item.id, "down"));
                      }}
                    >
                      <ArrowDown aria-hidden className="size-4" />
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        run(
                          safetySettingsService.setItemActive(
                            item.id,
                            !item.active,
                          ),
                        );
                      }}
                    >
                      {item.active ? t("deactivate") : t("reactivate")}
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          {manage ? (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                aria-label={t("nameEn")}
                placeholder={t("nameEn")}
                value={newItem[list].en}
                onChange={(e) => {
                  setNewItem({
                    ...newItem,
                    [list]: { ...newItem[list], en: e.target.value },
                  });
                }}
              />
              <Input
                aria-label={t("nameAr")}
                placeholder={t("nameAr")}
                dir="rtl"
                value={newItem[list].ar}
                onChange={(e) => {
                  setNewItem({
                    ...newItem,
                    [list]: { ...newItem[list], ar: e.target.value },
                  });
                }}
              />
              <Button
                variant="secondary"
                disabled={!newItem[list].en.trim() && !newItem[list].ar.trim()}
                onClick={() => {
                  run(
                    safetySettingsService
                      .createItem(list, {
                        nameEn: newItem[list].en.trim() || null,
                        nameAr: newItem[list].ar.trim() || null,
                      })
                      .then(() => {
                        setNewItem({ ...newItem, [list]: { en: "", ar: "" } });
                      }),
                  );
                }}
              >
                <Plus aria-hidden className="size-4" />
                {tc("add")}
              </Button>
            </div>
          ) : null}
        </section>
      ))}

      {editing ? (
        <FormDialog
          open
          title={editing.id ? t("editType") : t("addType")}
          error={error}
          submitLabel={tc("save")}
          cancelLabel={tc("cancel")}
          onClose={() => {
            setEditing(null);
          }}
          onSubmit={() => {
            const body = {
              nameEn: editing.nameEn.trim() || null,
              nameAr: editing.nameAr.trim() || null,
              family: editing.family,
              investigation: editing.investigation,
              minSeverity: editing.minSeverity || null,
              injuryDetails:
                editing.family === "incident" && editing.injuryDetails,
              areaRequired: editing.areaRequired,
              riskRating: editing.riskRating,
            };
            run(
              editing.id
                ? safetySettingsService.updateType(editing.id, body)
                : safetySettingsService.createType(body),
            );
          }}
        >
          <FormField id={ids.en} label={t("nameEn")}>
            <Input
              id={ids.en}
              value={editing.nameEn}
              onChange={(e) => {
                setEditing({ ...editing, nameEn: e.target.value });
              }}
            />
          </FormField>
          <FormField id={ids.ar} label={t("nameAr")}>
            <Input
              id={ids.ar}
              dir="rtl"
              value={editing.nameAr}
              onChange={(e) => {
                setEditing({ ...editing, nameAr: e.target.value });
              }}
            />
          </FormField>
          <FormField id={ids.family} label={t("familyLabel")}>
            <Select
              id={ids.family}
              value={editing.family}
              disabled={editing.inUse}
              onChange={(e) => {
                setEditing({
                  ...editing,
                  family: e.target.value as SafetyEventFamily,
                });
              }}
            >
              {SAFETY_EVENT_FAMILIES.map((f) => (
                <option key={f} value={f}>
                  {tf(f)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField id={ids.investigation} label={t("investigationLabel")}>
            <Select
              id={ids.investigation}
              value={editing.investigation}
              onChange={(e) => {
                setEditing({
                  ...editing,
                  investigation: e.target.value as InvestigationRule,
                });
              }}
            >
              {INVESTIGATION_RULES.map((r) => (
                <option key={r} value={r}>
                  {t(`investigation.${r}`)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField id={ids.min} label={t("minimumLabel")}>
            <Select
              id={ids.min}
              value={editing.minSeverity}
              onChange={(e) => {
                setEditing({
                  ...editing,
                  minSeverity: e.target.value as SafetySeverity | "",
                });
              }}
            >
              <option value="">{t("noMinimum")}</option>
              {SAFETY_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {ts(s)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField id={ids.risk} label={t("riskLabel")}>
            <Select
              id={ids.risk}
              value={editing.riskRating}
              onChange={(e) => {
                setEditing({
                  ...editing,
                  riskRating: e.target.value as RiskRatingRule,
                });
              }}
            >
              {RISK_RATING_RULES.map((r) => (
                <option key={r} value={r}>
                  {t(`risk.${r}`)}
                </option>
              ))}
            </Select>
          </FormField>
          {editing.family === "incident" ? (
            <Checkbox
              id="injury-details"
              label={t("injuryDetails")}
              checked={editing.injuryDetails}
              onChange={(e) => {
                setEditing({ ...editing, injuryDetails: e.target.checked });
              }}
            />
          ) : null}
          <Checkbox
            id="area-required"
            label={t("areaRequired")}
            checked={editing.areaRequired}
            onChange={(e) => {
              setEditing({ ...editing, areaRequired: e.target.checked });
            }}
          />
        </FormDialog>
      ) : null}
    </div>
  );
}
