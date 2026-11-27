"use client";

import {
  BODY_PARTS,
  INJURY_NATURES,
  type OfflinePackDto,
  type OfflineProfileDto,
  type OfflineProjectDto,
  type PersonRole,
  type PlaceDto,
  SAFETY_EVENT_FAMILIES,
  SAFETY_EVENT_LIMITS,
  SAFETY_SEVERITIES,
  type SafetyEventFamily,
  type SafetyEventTypeDto,
  type SafetySettingsPackDto,
  type SafetySeverity,
  severityAtLeast,
  TREATMENTS,
} from "@hse/shared";
import { Camera, LocateFixed, Plus, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";

import { FormField } from "@/components/form/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/modules/auth/auth-provider";
import { authorizedRequest } from "@/modules/auth/auth-session";
import { readReference } from "@/modules/offline/device-store";
import {
  refreshProjectPack,
  storedProfile,
} from "@/modules/offline/offline-profile";
import { type CompressedPhoto, compressPhoto } from "@/modules/offline/photo";
import { useSync } from "@/modules/offline/sync-provider";
import { cn } from "@/utils/cn";

import {
  MY_REPORTS_ROUTE,
  queueReport,
  readDraft,
  readSettingsPack,
  refreshSettingsPack,
  removeDraft,
  saveDraft,
} from "./safety-event-offline";
import { FAMILY_ICONS, useTypeName } from "./safety-event-ui";

/** O-181: projects that take reports (accepting records, or On Hold). */
const REPORTING_STATUSES = ["mobilization", "active", "on_hold"];

interface PersonRow {
  key: string;
  name: string;
  role: PersonRole;
  injuryNature: string;
  bodyPart: string;
  treatment: string;
}

interface WitnessRow {
  key: string;
  name: string;
  contact: string;
}

function localInput(ms: number): string {
  const date = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return date.toISOString().slice(0, 16);
}

/** US-040 – US-042: the one report screen for every family — works offline (T-90). */
export function ReportScreen() {
  const t = useTranslations("safetyEvents.report");
  const ts = useTranslations("safetyEvents.severity");
  const tf = useTranslations("safetyEvents.family");
  const tp = useTranslations("safetyEvents.people");
  const tc = useTranslations("common");
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { online, refresh } = useSync();
  const typeName = useTypeName();
  const ids = {
    project: useId(),
    title: useId(),
    description: useId(),
    area: useId(),
    location: useId(),
    when: useId(),
    outcome: useId(),
    action: useId(),
    damage: useId(),
    environment: useId(),
  };
  const [projects, setProjects] = useState<OfflineProjectDto[] | null>(null);
  const [settings, setSettings] = useState<SafetySettingsPackDto | null>(null);
  const [pack, setPack] = useState<OfflinePackDto | null>(null);
  const [projectId, setProjectId] = useState(params.get("project") ?? "");
  const [family, setFamily] = useState<SafetyEventFamily | null>(null);
  const [typeId, setTypeId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [areaId, setAreaId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [when, setWhen] = useState(() => localInput(Date.now()));
  const [severity, setSeverity] = useState<SafetySeverity | "">("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [immediateAction, setImmediateAction] = useState("");
  const [potentialOutcome, setPotentialOutcome] = useState("");
  const [damage, setDamage] = useState("");
  const [environment, setEnvironment] = useState("");
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [witnesses, setWitnesses] = useState<WitnessRow[]>([]);
  const [photos, setPhotos] = useState<CompressedPhoto[]>([]);
  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number | null;
  } | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const draftId = params.get("draft");
  const followUpOf = params.get("followUp");

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const live = online
        ? await authorizedRequest<OfflineProfileDto>("/me/offline-profile")
            .then((r) => r.data)
            .catch(() => null)
        : null;
      const profile = live ?? (await storedProfile(user.id));
      setProjects(
        (profile?.projects ?? []).filter(
          (p) =>
            p.permissions.includes("projects.safety_events.report") &&
            REPORTING_STATUSES.includes(p.status),
        ),
      );
      setSettings(
        (online ? await refreshSettingsPack(user.id) : null) ??
          (await readSettingsPack(user.id)),
      );
      if (draftId) {
        const draft = await readDraft(user.id, draftId);
        if (draft) {
          setProjectId(draft.projectId);
          const b = draft.body;
          if (b.typeId) setTypeId(b.typeId);
          setTitle(b.title ?? "");
          setDescription(b.description ?? "");
          if (b.reportedSeverity) setSeverity(b.reportedSeverity);
          setImmediateAction(b.immediateAction ?? "");
          setPotentialOutcome(b.potentialOutcome ?? "");
          setCategoryIds(b.categoryIds ?? []);
          if (b.occurredAt) setWhen(localInput(b.occurredAt));
        }
      }
    })();
  }, [user, online, draftId]);

  useEffect(() => {
    if (!user || !projectId) return;
    void (async () => {
      if (online) await refreshProjectPack(user.id, projectId, {});
      const row = await readReference<OfflinePackDto>(
        user.id,
        "project-pack",
        projectId,
      );
      setPack(row?.data ?? null);
    })();
  }, [user, projectId, online]);

  const types = settings?.types ?? [];
  const type: SafetyEventTypeDto | null =
    types.find((x) => x.id === typeId) ?? null;
  useEffect(() => {
    if (type) setFamily(type.family);
  }, [type]);

  if (!user || projects === null) {
    return (
      <div className="flex items-center gap-3" role="status">
        <Spinner />
        {tc("loading")}
      </div>
    );
  }

  const project = projects.find((p) => p.id === projectId) ?? null;
  const areas: PlaceDto[] = (pack?.places.areas ?? []).filter((a) => a.active);
  const area = areas.find((a) => a.id === areaId) ?? null;
  const locations = (area?.children ?? []).filter((l) => l.active);
  const serious = severity === "high" || severity === "critical";

  const body = () => ({
    typeId,
    title: title.trim(),
    description: description.trim(),
    occurredAt: new Date(when).getTime(),
    place: {
      areaId: areaId || null,
      locationId: locationId || null,
      workZoneId: null,
    },
    location,
    reportedSeverity: (severity || "low") as SafetySeverity,
    categoryIds,
    immediateAction: immediateAction.trim() || null,
    potentialOutcome:
      family === "near_miss" ? potentialOutcome.trim() || null : null,
    damageDetails: family === "incident" ? damage.trim() || null : null,
    environmentDetails:
      family === "incident" ? environment.trim() || null : null,
    people: people
      .filter((p) => p.name.trim())
      .map((p) => ({
        name: p.name.trim(),
        role: p.role,
        injuryNature:
          p.role === "injured" && p.injuryNature
            ? (p.injuryNature as (typeof INJURY_NATURES)[number])
            : null,
        bodyPart:
          p.role === "injured" && p.bodyPart
            ? (p.bodyPart as (typeof BODY_PARTS)[number])
            : null,
        treatment:
          p.role === "injured" && p.treatment
            ? (p.treatment as (typeof TREATMENTS)[number])
            : null,
      })),
    witnesses: witnesses
      .filter((w) => w.name.trim())
      .map((w) => ({ name: w.name.trim(), contact: w.contact.trim() || null })),
    ...(followUpOf ? { followUpOf } : {}),
  });

  const validate = (): string | null => {
    if (!project || !type) return t("required");
    if (title.trim().length < SAFETY_EVENT_LIMITS.titleMin)
      return t("titleShort");
    if (description.trim().length < SAFETY_EVENT_LIMITS.descriptionMin)
      return t("descriptionShort");
    if (!severity) return t("severityRequired");
    if (!severityAtLeast(severity, type.minSeverity))
      return t("severityMinimum", { level: ts(type.minSeverity ?? "low") });
    if (type.areaRequired && !areaId) return t("areaRequired");
    if (
      type.family === "near_miss" &&
      potentialOutcome.trim().length < SAFETY_EVENT_LIMITS.potentialOutcomeMin
    ) {
      return t("outcomeRequired");
    }
    if (
      type.injuryDetails &&
      !people.some((p) => p.role === "injured" && p.name.trim())
    )
      return t("injuredRequired");
    if (
      new Date(when).getTime() >
      Date.now() + SAFETY_EVENT_LIMITS.futureToleranceMs
    )
      return t("future");
    return null;
  };

  const send = async () => {
    const problem = validate();
    if (problem || !project || !type) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const copy = await queueReport(user.id, {
        project: { id: project.id, code: project.code },
        type: {
          id: type.id,
          nameEn: type.nameEn,
          nameAr: type.nameAr,
          family: type.family,
        },
        body: body(),
        photos,
      });
      if (draftId) await removeDraft(user.id, draftId);
      await refresh();
      router.push(`${MY_REPORTS_ROUTE}?sent=${copy.id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSaving(false);
    }
  };

  const keepDraft = async () => {
    if (!project) {
      setError(t("required"));
      return;
    }
    await saveDraft(user.id, {
      id: draftId ?? crypto.randomUUID(),
      projectId: project.id,
      projectCode: project.code,
      body: body(),
      typeNameEn: type?.nameEn ?? null,
      typeNameAr: type?.nameAr ?? null,
      updatedAt: Date.now(),
    });
    router.push(MY_REPORTS_ROUTE);
  };

  return (
    <div className="flex flex-col gap-5 pb-28">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {!online ? <Alert tone="info">{t("offline")}</Alert> : null}
      {!online && serious ? (
        <Alert tone="warning">{t("emergencyOffline")}</Alert>
      ) : null}
      {online && serious && family === "incident" ? (
        <Alert tone="warning">{t("alertNow")}</Alert>
      ) : null}
      {projects.length === 0 ? (
        <Alert tone="warning">{t("noProjects")}</Alert>
      ) : null}

      <FormField id={ids.project} label={t("project")}>
        <Select
          id={ids.project}
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setAreaId("");
            setLocationId("");
          }}
        >
          <option value="">{t("chooseProject")}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </Select>
      </FormField>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">{t("what")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {SAFETY_EVENT_FAMILIES.map((f) => {
            const Icon = FAMILY_ICONS[f];
            return (
              <button
                key={f}
                type="button"
                aria-pressed={family === f}
                onClick={() => {
                  setFamily(f);
                  setTypeId(types.find((x) => x.family === f)?.id ?? "");
                }}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border p-2 text-sm font-medium",
                  family === f
                    ? "border-primary bg-primary text-white"
                    : "border-border hover:bg-muted",
                )}
              >
                <Icon aria-hidden className="size-6" />
                {tf(f)}
              </button>
            );
          })}
        </div>
        {family ? (
          <div
            className="flex flex-wrap gap-2"
            role="radiogroup"
            aria-label={t("type")}
          >
            {types
              .filter((x) => x.family === family)
              .map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="radio"
                  aria-checked={typeId === x.id}
                  onClick={() => {
                    setTypeId(x.id);
                  }}
                  className={cn(
                    "min-h-10 rounded-full border px-4 text-sm",
                    typeId === x.id
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "border-border hover:bg-muted",
                  )}
                >
                  {typeName(x)}
                </button>
              ))}
          </div>
        ) : null}
      </fieldset>

      {type ? (
        <>
          <FormField id={ids.title} label={t("titleLabel")}>
            <Input
              id={ids.title}
              value={title}
              maxLength={SAFETY_EVENT_LIMITS.titleMax}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
          </FormField>
          <FormField
            id={ids.description}
            label={family === "hazard" ? t("whatSeen") : t("whatHappened")}
          >
            <Textarea
              id={ids.description}
              value={description}
              maxLength={SAFETY_EVENT_LIMITS.descriptionMax}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
            />
          </FormField>
          {family === "near_miss" ? (
            <FormField id={ids.outcome} label={t("couldHave")}>
              <Textarea
                id={ids.outcome}
                value={potentialOutcome}
                maxLength={SAFETY_EVENT_LIMITS.potentialOutcomeMax}
                onChange={(e) => {
                  setPotentialOutcome(e.target.value);
                }}
              />
            </FormField>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id={ids.area}
              label={type.areaRequired ? t("areaRequiredLabel") : t("area")}
            >
              <Select
                id={ids.area}
                value={areaId}
                onChange={(e) => {
                  setAreaId(e.target.value);
                  setLocationId("");
                }}
              >
                <option value="">{t("noArea")}</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </FormField>
            {locations.length > 0 ? (
              <FormField id={ids.location} label={t("location")}>
                <Select
                  id={ids.location}
                  value={locationId}
                  onChange={(e) => {
                    setLocationId(e.target.value);
                  }}
                >
                  <option value="">{t("noLocation")}</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
            <FormField id={ids.when} label={t("when")}>
              <Input
                id={ids.when}
                type="datetime-local"
                value={when}
                onChange={(e) => {
                  setWhen(e.target.value);
                }}
              />
            </FormField>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              disabled={
                locating ||
                typeof navigator === "undefined" ||
                !("geolocation" in navigator)
              }
              onClick={() => {
                setLocating(true);
                navigator.geolocation.getCurrentPosition(
                  (position) => {
                    setLocation({
                      latitude: position.coords.latitude,
                      longitude: position.coords.longitude,
                      accuracy: Math.round(position.coords.accuracy),
                    });
                    setLocating(false);
                  },
                  () => {
                    setError(t("locationFailed"));
                    setLocating(false);
                  },
                  { enableHighAccuracy: true, timeout: 15000 },
                );
              }}
            >
              <LocateFixed aria-hidden className="size-5" />
              {location ? t("locationAgain") : t("addLocation")}
            </Button>
            {location ? (
              <span className="text-sm text-muted-foreground">
                <bdi dir="ltr">
                  {t("accuracy", { metres: location.accuracy ?? 0 })}
                </bdi>
              </span>
            ) : null}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">
              {family === "incident" ? t("howSerious") : t("howSeriousCould")}
            </legend>
            <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
              {SAFETY_SEVERITIES.map((level) => {
                const allowed = severityAtLeast(level, type.minSeverity);
                return (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={severity === level}
                    disabled={!allowed}
                    onClick={() => {
                      setSeverity(level);
                    }}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-xl border p-3 text-start disabled:opacity-40",
                      severity === level
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-muted",
                    )}
                  >
                    <span className="font-medium">{ts(level)}</span>
                    <span className="text-xs text-muted-foreground">
                      {ts(`guidance.${level}`)}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {(settings?.categories.length ?? 0) > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">
                {t("categories")}
              </legend>
              <div className="flex flex-wrap gap-2">
                {settings?.categories.map((c) => {
                  const on = categoryIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={on}
                      disabled={
                        !on &&
                        categoryIds.length >= SAFETY_EVENT_LIMITS.categoriesMax
                      }
                      onClick={() => {
                        setCategoryIds(
                          on
                            ? categoryIds.filter((x) => x !== c.id)
                            : [...categoryIds, c.id],
                        );
                      }}
                      className={cn(
                        "min-h-9 rounded-full border px-3 text-sm disabled:opacity-40",
                        on
                          ? "border-primary bg-primary/10 font-medium text-primary"
                          : "border-border hover:bg-muted",
                      )}
                    >
                      {typeName(c)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          {family !== "hazard" ? (
            <fieldset className="flex flex-col gap-3 rounded-xl border border-border p-3">
              <legend className="px-1 text-sm font-medium">
                {type.injuryDetails ? tp("titleInjured") : tp("titleInvolved")}
              </legend>
              <p className="text-xs text-muted-foreground">{tp("privacy")}</p>
              {people.map((person, index) => (
                <div
                  key={person.key}
                  className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-2"
                >
                  <Input
                    aria-label={tp("name")}
                    placeholder={tp("name")}
                    value={person.name}
                    onChange={(e) => {
                      setPeople(
                        people.map((p, i) =>
                          i === index ? { ...p, name: e.target.value } : p,
                        ),
                      );
                    }}
                  />
                  <Select
                    aria-label={tp("role")}
                    value={person.role}
                    onChange={(e) => {
                      setPeople(
                        people.map((p, i) =>
                          i === index
                            ? { ...p, role: e.target.value as PersonRole }
                            : p,
                        ),
                      );
                    }}
                  >
                    {type.injuryDetails ? (
                      <option value="injured">{tp("roles.injured")}</option>
                    ) : null}
                    <option value="involved">{tp("roles.involved")}</option>
                  </Select>
                  {person.role === "injured" ? (
                    <>
                      <Select
                        aria-label={tp("nature")}
                        value={person.injuryNature}
                        onChange={(e) => {
                          setPeople(
                            people.map((p, i) =>
                              i === index
                                ? { ...p, injuryNature: e.target.value }
                                : p,
                            ),
                          );
                        }}
                      >
                        <option value="">{tp("nature")}</option>
                        {INJURY_NATURES.map((n) => (
                          <option key={n} value={n}>
                            {tp(`natures.${n}`)}
                          </option>
                        ))}
                      </Select>
                      <Select
                        aria-label={tp("bodyPart")}
                        value={person.bodyPart}
                        onChange={(e) => {
                          setPeople(
                            people.map((p, i) =>
                              i === index
                                ? { ...p, bodyPart: e.target.value }
                                : p,
                            ),
                          );
                        }}
                      >
                        <option value="">{tp("bodyPart")}</option>
                        {BODY_PARTS.map((n) => (
                          <option key={n} value={n}>
                            {tp(`bodyParts.${n}`)}
                          </option>
                        ))}
                      </Select>
                      <Select
                        aria-label={tp("treatment")}
                        value={person.treatment}
                        onChange={(e) => {
                          setPeople(
                            people.map((p, i) =>
                              i === index
                                ? { ...p, treatment: e.target.value }
                                : p,
                            ),
                          );
                        }}
                      >
                        <option value="">{tp("treatment")}</option>
                        {TREATMENTS.map((n) => (
                          <option key={n} value={n}>
                            {tp(`treatments.${n}`)}
                          </option>
                        ))}
                      </Select>
                    </>
                  ) : null}
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setPeople(people.filter((_, i) => i !== index));
                    }}
                  >
                    <Trash2 aria-hidden className="size-4" />
                    {tc("remove")}
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                disabled={people.length >= SAFETY_EVENT_LIMITS.peopleMax}
                onClick={() => {
                  setPeople([
                    ...people,
                    {
                      key: crypto.randomUUID(),
                      name: "",
                      role: type.injuryDetails ? "injured" : "involved",
                      injuryNature: "",
                      bodyPart: "",
                      treatment: "",
                    },
                  ]);
                }}
              >
                <Plus aria-hidden className="size-4" />
                {tp("add")}
              </Button>
            </fieldset>
          ) : null}

          {family === "incident" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id={ids.damage} label={t("damage")}>
                <Textarea
                  id={ids.damage}
                  value={damage}
                  maxLength={SAFETY_EVENT_LIMITS.detailsMax}
                  onChange={(e) => {
                    setDamage(e.target.value);
                  }}
                />
              </FormField>
              <FormField id={ids.environment} label={t("environment")}>
                <Textarea
                  id={ids.environment}
                  value={environment}
                  maxLength={SAFETY_EVENT_LIMITS.detailsMax}
                  onChange={(e) => {
                    setEnvironment(e.target.value);
                  }}
                />
              </FormField>
            </div>
          ) : null}

          <FormField id={ids.action} label={t("immediateAction")}>
            <Textarea
              id={ids.action}
              value={immediateAction}
              maxLength={SAFETY_EVENT_LIMITS.detailsMax}
              onChange={(e) => {
                setImmediateAction(e.target.value);
              }}
            />
          </FormField>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">
              {t("witnesses")}
            </legend>
            {witnesses.map((w, index) => (
              <div
                key={w.key}
                className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
              >
                <Input
                  aria-label={t("witnessName")}
                  placeholder={t("witnessName")}
                  value={w.name}
                  onChange={(e) => {
                    setWitnesses(
                      witnesses.map((x, i) =>
                        i === index ? { ...x, name: e.target.value } : x,
                      ),
                    );
                  }}
                />
                <Input
                  aria-label={t("witnessContact")}
                  placeholder={t("witnessContact")}
                  value={w.contact}
                  onChange={(e) => {
                    setWitnesses(
                      witnesses.map((x, i) =>
                        i === index ? { ...x, contact: e.target.value } : x,
                      ),
                    );
                  }}
                />
                <Button
                  variant="secondary"
                  aria-label={tc("remove")}
                  onClick={() => {
                    setWitnesses(witnesses.filter((_, i) => i !== index));
                  }}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              disabled={witnesses.length >= SAFETY_EVENT_LIMITS.witnessesMax}
              onClick={() => {
                setWitnesses([
                  ...witnesses,
                  { key: crypto.randomUUID(), name: "", contact: "" },
                ]);
              }}
            >
              <Plus aria-hidden className="size-4" />
              {t("addWitness")}
            </Button>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">
              {t("photos", { count: photos.length })}
            </legend>
            <label className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border px-4 font-medium hover:bg-muted">
              <Camera aria-hidden className="size-5" />
              {t("addPhoto")}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="sr-only"
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = "";
                  void (async () => {
                    const next = [...photos];
                    for (const file of files) {
                      if (next.length >= SAFETY_EVENT_LIMITS.reportFilesMax)
                        break;
                      try {
                        next.push(
                          await compressPhoto(
                            file,
                            file.name.replace(/\.[^.]+$/, "") + ".jpg",
                          ),
                        );
                      } catch {
                        setError(t("photoFailed"));
                      }
                    }
                    setPhotos(next);
                  })();
                }}
              />
            </label>
            {photos.length > 0 ? (
              <ul className="flex flex-wrap gap-2 text-sm">
                {photos.map((photo, index) => (
                  <li
                    key={`${photo.name}-${String(index)}`}
                    className="flex items-center gap-2 rounded-full border border-border px-3 py-1"
                  >
                    <bdi dir="ltr">{photo.name}</bdi>
                    <button
                      type="button"
                      aria-label={tc("remove")}
                      onClick={() => {
                        setPhotos(photos.filter((_, i) => i !== index));
                      }}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </fieldset>

          <p className="text-sm text-muted-foreground">{t("nameShown")}</p>
        </>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="fixed inset-x-0 bottom-0 z-10 flex gap-2 border-t border-border bg-background p-4">
        <Button
          className="flex-1"
          disabled={saving || !type || !project}
          onClick={() => void send()}
        >
          {saving ? <Spinner /> : null}
          {t("send")}
        </Button>
        <Button
          variant="secondary"
          disabled={saving || !project}
          onClick={() => void keepDraft()}
        >
          {t("saveDraft")}
        </Button>
      </div>
    </div>
  );
}
