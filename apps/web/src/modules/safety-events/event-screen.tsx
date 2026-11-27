"use client";

import {
  type CauseKind,
  investigationRequired,
  type RiskMatrixDto,
  SAFETY_EVENT_LIMITS,
  SAFETY_SEVERITIES,
  SAFETY_VOID_KINDS,
  type SafetyEventDto,
  type SafetyRecommendationDto,
  type SafetySettingsDto,
  type SafetySeverity,
  type SafetyVoidKind,
  type SafetyWitnessDto,
  type TimelinePageDto,
  addIsoDays,
  zonedIsoDate,
} from "@hse/shared";
import { AlertOctagon, Lock, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { FormField } from "@/components/form/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  type CommentApi,
  CommentThread,
} from "@/modules/actions/comment-thread";
import { PersonSelect } from "@/modules/actions/person-select";
import { useReadOnly } from "@/modules/billing/use-subscription-state";
import { useDateFormat } from "@/modules/i18n/use-date-format";
import { useErrorMessage } from "@/modules/i18n/use-error-message";
import { SmallChip } from "@/modules/inspections/inspection-ui";
import { useCurrentProject } from "@/modules/projects/project-context";
import { useActivitySentence } from "@/modules/projects/timeline-screen";
import { useCompany } from "@/modules/tenant/tenant-provider";
import { FormDialog } from "@/modules/workforce/workforce-ui";

import { REPORT_ROUTE } from "./safety-event-offline";
import {
  EventStatusChip,
  RiskBandChip,
  RiskGrid,
  SeverityChip,
  useTypeName,
} from "./safety-event-ui";
import {
  riskMatrixService,
  safetyEventsService,
  safetySettingsService,
} from "./safety-events.service";

type Dialog =
  | { kind: "assign"; required?: boolean }
  | { kind: "reassign" }
  | { kind: "act" }
  | { kind: "close" }
  | { kind: "void" }
  | { kind: "return" }
  | { kind: "raise"; recommendation: SafetyRecommendationDto | null }
  | { kind: "noAction"; recommendation: SafetyRecommendationDto }
  | { kind: "statement"; witness: SafetyWitnessDto }
  | null;

/** US-043 – US-046: the event page — report, review, people, witnesses, investigation, closure. */
export function SafetyEventScreen() {
  const t = useTranslations("safetyEvents.page");
  const tc = useTranslations("common");
  const tr = useTranslations("safetyEvents.report");
  const errorMessage = useErrorMessage();
  const readOnly = useReadOnly();
  const { project } = useCurrentProject();
  const params = useParams<{ eventId: string }>();
  const id = params.eventId;
  const typeName = useTypeName();
  const { dateTime, calendarDate } = useDateFormat();
  const [dto, setDto] = useState<SafetyEventDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    safetyEventsService.get(project.id, id).then(
      (loaded) => {
        setDto(loaded);
        if (loaded.canClassify && !loaded.underReview && !readOnly) {
          void safetyEventsService
            .reviewStart(project.id, id)
            .catch(() => undefined);
        }
      },
      (failure: unknown) => {
        setError(errorMessage(failure));
      },
    );
  }, [project.id, id, errorMessage, readOnly]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!dto) return;
    let cancelled = false;
    const urls: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      for (const file of dto.files
        .filter((f) => f.contentType.startsWith("image/"))
        .slice(0, 40)) {
        const blob = await safetyEventsService
          .file(project.id, dto.id, file.id)
          .catch(() => null);
        if (!blob || cancelled) continue;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        next[file.id] = url;
      }
      if (!cancelled) setPhotoUrls(next);
    })();
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [dto, project.id]);

  const comments: CommentApi = useMemo(
    () => ({
      comments: (before) =>
        safetyEventsService.comments(project.id, id, before),
      add: (body) => safetyEventsService.addComment(project.id, id, body),
      edit: (commentId, body) =>
        safetyEventsService.editComment(project.id, id, commentId, body),
    }),
    [project.id, id],
  );

  if (error && !dto) return <Alert tone="danger">{error}</Alert>;
  if (!dto) {
    return (
      <div className="flex items-center gap-3" role="status">
        <Spinner />
        {tc("loading")}
      </div>
    );
  }

  const run = (work: Promise<unknown>, message: string) => {
    setError(null);
    work.then(
      () => {
        setNotice(message);
        setDialog(null);
        load();
      },
      (failure: unknown) => {
        setError(errorMessage(failure));
      },
    );
  };
  const allowed = readOnly ? [] : dto.transitions;

  return (
    <div className="flex flex-col gap-6 pb-24">
      <div className="flex flex-col gap-2">
        <Link
          href={`/projects/${project.id}/safety-events`}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {t("back")}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {dto.reference ? (
            <bdi dir="ltr" className="text-lg font-semibold">
              {dto.reference}
            </bdi>
          ) : null}
          <EventStatusChip status={dto.status} voided={dto.voided} />
          {dto.underReview ? (
            <SmallChip icon={Search}>{t("underReview")}</SmallChip>
          ) : null}
          {dto.urgent ? (
            <SmallChip icon={AlertOctagon} tone="danger">
              {t("urgent")}
            </SmallChip>
          ) : null}
          <SeverityChip
            severity={dto.severity ?? dto.reportedSeverity}
            proposed={dto.severity === null}
          />
          {dto.risk ? (
            <RiskBandChip
              bandKey={dto.risk.bandKey}
              label={dto.risk.bandLabel}
              score={dto.risk.score}
            />
          ) : null}
          {dto.investigationRequired ? (
            <SmallChip icon={Search} tone="warning">
              {t("investigationRequired")}
            </SmallChip>
          ) : null}
        </div>
        <h1 className="text-2xl font-semibold">{dto.title}</h1>
        <p className="text-sm text-muted-foreground">
          {[
            typeName(dto),
            dto.placeName,
            dto.reportedBy
              ? t("reportedBy", { name: dto.reportedBy.name })
              : null,
            dateTime(dto.occurredAt),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {dto.voided ? (
        <Alert tone="warning">
          {t("voidedBanner", { reason: dto.voidReason ?? "" })}
        </Alert>
      ) : null}
      {dto.status === "closed" ? (
        <section className="rounded-xl border border-success/40 bg-success/10 p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Lock aria-hidden className="size-4" />
            {t("closedBanner", {
              date: dto.closedAt ? dateTime(dto.closedAt) : "",
              name: dto.closedBy?.name ?? "",
            })}
          </h2>
          <p className="mt-2 whitespace-pre-line">{dto.closureSummary}</p>
        </section>
      ) : null}

      <section className="flex flex-col gap-3 rounded-xl border border-border p-4">
        <h2 className="text-lg font-semibold">{t("report")}</h2>
        <p className="whitespace-pre-line">{dto.description}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {dto.potentialOutcome ? (
            <Detail label={tr("couldHave")} value={dto.potentialOutcome} />
          ) : null}
          {dto.immediateAction ? (
            <Detail label={tr("immediateAction")} value={dto.immediateAction} />
          ) : null}
          {dto.damageDetails ? (
            <Detail label={tr("damage")} value={dto.damageDetails} />
          ) : null}
          {dto.environmentDetails ? (
            <Detail label={tr("environment")} value={dto.environmentDetails} />
          ) : null}
          {dto.categories.length > 0 ? (
            <Detail
              label={tr("categories")}
              value={dto.categories.map((c) => typeName(c)).join(", ")}
            />
          ) : null}
          {dto.reportedLate ? (
            <Detail
              label={t("received")}
              value={t("reportedLate", { date: dateTime(dto.receivedAt) })}
            />
          ) : null}
          {dto.latitude !== null && dto.longitude !== null ? (
            <Detail
              label={tr("location")}
              value={`${dto.latitude.toFixed(5)}, ${dto.longitude.toFixed(5)}`}
              ltr
            />
          ) : null}
        </dl>
        {dto.files.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {dto.files.map((file) => (
              <li key={file.id}>
                {photoUrls[file.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- blob URL from an authorised request
                  <img
                    src={photoUrls[file.id]}
                    alt={file.fileName}
                    className="size-24 rounded-lg border border-border object-cover"
                  />
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-sm">
                    {file.sensitive ? (
                      <Lock aria-hidden className="size-3.5" />
                    ) : null}
                    <bdi dir="ltr">{file.fileName}</bdi>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {dto.canClassify && !readOnly ? (
        <ReviewPanel
          dto={dto}
          projectId={project.id}
          onDone={(message) => {
            setNotice(message);
            load();
          }}
          onError={setError}
          onDialog={setDialog}
        />
      ) : null}

      <PeopleSection
        dto={dto}
        projectId={project.id}
        readOnly={readOnly}
        onSaved={() => {
          setNotice(t("saved"));
          load();
        }}
        onError={setError}
      />

      <WitnessSection
        dto={dto}
        projectId={project.id}
        readOnly={readOnly}
        onChanged={load}
        onError={setError}
        onStatement={(witness) => {
          setDialog({ kind: "statement", witness });
        }}
      />

      {dto.investigation ? (
        <InvestigationSection
          dto={dto}
          projectId={project.id}
          readOnly={readOnly}
          onChanged={(message) => {
            setNotice(message);
            load();
          }}
          onError={setError}
        />
      ) : null}

      {dto.recommendations &&
      (dto.recommendations.length > 0 || dto.canRaiseActions) ? (
        <section
          className="flex flex-col gap-3 rounded-xl border border-border p-4"
          aria-labelledby="recommendations"
        >
          <h2 id="recommendations" className="text-lg font-semibold">
            {t("recommendations")}
          </h2>
          <ul className="flex flex-col gap-2">
            {dto.recommendations.map((rec) => (
              <li
                key={rec.id}
                id={`recommendation-${rec.id}`}
                className="flex flex-col gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">
                    {t("recommendationNo", { seq: rec.seq })}
                  </span>
                  <SmallChip icon={Plus}>
                    {t(`recommendationKind.${rec.kind}`)}
                  </SmallChip>
                  <SmallChip icon={Lock}>
                    {t(`recommendationStatus.${rec.status}`)}
                  </SmallChip>
                </div>
                <p>{rec.description}</p>
                {rec.noActionReason ? (
                  <p className="text-sm text-muted-foreground">
                    {rec.noActionReason}
                  </p>
                ) : null}
                {rec.actions.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-sm">
                    {rec.actions.map((action) => (
                      <li key={action.id}>
                        <Link
                          href={`/projects/${project.id}/actions/${action.id}`}
                          className="text-primary hover:underline"
                        >
                          <bdi dir="ltr">{action.reference}</bdi>
                        </Link>{" "}
                        ·{" "}
                        {t(
                          `actionStatus.${action.voided ? "voided" : action.status}`,
                        )}{" "}
                        · {action.ownerName ?? ""} ·{" "}
                        {calendarDate(action.dueOn)}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {dto.canRaiseActions &&
                !readOnly &&
                rec.status !== "no_action" ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setDialog({ kind: "raise", recommendation: rec });
                      }}
                    >
                      {t("raiseAction")}
                    </Button>
                    {rec.status === "open" ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setDialog({ kind: "noAction", recommendation: rec });
                        }}
                      >
                        {t("noActionNeeded")}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {dto.status === "closed" && dto.access.manage && !readOnly ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setDialog({ kind: "raise", recommendation: null });
            }}
          >
            {t("addendum")}
          </Button>
          <Link
            href={`${REPORT_ROUTE}?project=${project.id}&followUp=${dto.id}`}
            className="inline-flex min-h-10 items-center rounded-lg border border-border px-4 font-medium hover:bg-muted"
          >
            {t("followUp")}
          </Link>
        </div>
      ) : null}

      <section aria-labelledby="comments">
        <h2 id="comments" className="mb-2 text-lg font-semibold">
          {t("comments")}
        </h2>
        <p className="mb-2 text-xs text-muted-foreground">{t("commentHint")}</p>
        <CommentThread
          projectId={project.id}
          actionId={dto.id}
          api={comments}
        />
      </section>
      <History projectId={project.id} id={dto.id} />

      {allowed.some((step) =>
        [
          "close",
          "return",
          "reassign",
          "void",
          "complete_investigation",
        ].includes(step),
      ) && dto.status !== "reported" ? (
        <div className="fixed inset-x-0 bottom-0 z-10 flex flex-wrap gap-2 border-t border-border bg-background p-4">
          {allowed.includes("complete_investigation") ? (
            <Button
              className="flex-1"
              onClick={() => {
                run(
                  safetyEventsService.transition(project.id, dto.id, {
                    to: "complete_investigation",
                  }),
                  t("completed"),
                );
              }}
            >
              {t("complete")}
            </Button>
          ) : null}
          {allowed.includes("close") ? (
            <Button
              className="flex-1"
              onClick={() => {
                setDialog({ kind: "close" });
              }}
            >
              {t("close")}
            </Button>
          ) : null}
          {allowed.includes("return") ? (
            <Button
              variant="secondary"
              onClick={() => {
                setDialog({ kind: "return" });
              }}
            >
              {t("return")}
            </Button>
          ) : null}
          {allowed.includes("reassign") ? (
            <Button
              variant="secondary"
              onClick={() => {
                setDialog({ kind: "reassign" });
              }}
            >
              {t("reassign")}
            </Button>
          ) : null}
          {allowed.includes("void") ? (
            <Button
              variant="secondary"
              onClick={() => {
                setDialog({ kind: "void" });
              }}
            >
              {t("void")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {dialog?.kind === "assign" || dialog?.kind === "reassign" ? (
        <AssignDialog
          dto={dto}
          projectId={project.id}
          reassign={dialog.kind === "reassign"}
          required={
            dialog.kind === "assign"
              ? (dialog.required ?? dto.investigationRequired)
              : dto.investigationRequired
          }
          onClose={() => {
            setDialog(null);
          }}
          onSubmit={(body) => {
            run(
              safetyEventsService.transition(project.id, dto.id, body),
              t("assigned"),
            );
          }}
        />
      ) : null}
      {dialog?.kind === "act" || dialog?.kind === "raise" ? (
        <ActionDialog
          dto={dto}
          projectId={project.id}
          addendum={dialog.kind === "raise" && dialog.recommendation === null}
          onClose={() => {
            setDialog(null);
          }}
          onSubmit={(action, recommendationText) => {
            if (dialog.kind === "act") {
              run(
                safetyEventsService.transition(project.id, dto.id, {
                  to: "act",
                  actions: [action],
                }),
                t("actionRaised"),
              );
            } else if (dialog.recommendation) {
              run(
                safetyEventsService.raiseAction(
                  project.id,
                  dto.id,
                  dialog.recommendation.id,
                  action,
                ),
                t("actionRaised"),
              );
            } else {
              run(
                safetyEventsService.addendum(project.id, dto.id, {
                  ...action,
                  recommendation: recommendationText,
                }),
                t("actionRaised"),
              );
            }
          }}
        />
      ) : null}
      {dialog?.kind === "close" ? (
        <TextDialog
          title={
            dto.status === "reported" ? t("closeNoFurther") : t("closeTitle")
          }
          label={t("closureSummary")}
          min={SAFETY_EVENT_LIMITS.closureMin}
          max={SAFETY_EVENT_LIMITS.closureMax}
          initial={
            dto.status === "reported"
              ? ""
              : (dto.investigation?.lessonsLearned ?? "")
          }
          submitLabel={t("close")}
          onClose={() => {
            setDialog(null);
          }}
          onSubmit={(summary) => {
            run(
              safetyEventsService.transition(project.id, dto.id, {
                to: "close",
                summary,
                noFurtherAction: dto.status === "reported",
              }),
              t("closedNotice"),
            );
          }}
        />
      ) : null}
      {dialog?.kind === "return" ? (
        <TextDialog
          title={t("returnTitle")}
          label={t("reason")}
          min={5}
          max={1000}
          submitLabel={t("return")}
          onClose={() => {
            setDialog(null);
          }}
          onSubmit={(reason) => {
            run(
              safetyEventsService.transition(project.id, dto.id, {
                to: "return",
                reason,
              }),
              t("returned"),
            );
          }}
        />
      ) : null}
      {dialog?.kind === "noAction" ? (
        <TextDialog
          title={t("noActionNeeded")}
          label={t("reason")}
          min={5}
          max={500}
          submitLabel={t("noActionNeeded")}
          onClose={() => {
            setDialog(null);
          }}
          onSubmit={(reason) => {
            run(
              safetyEventsService.noAction(
                project.id,
                dto.id,
                dialog.recommendation.id,
                reason,
              ),
              t("saved"),
            );
          }}
        />
      ) : null}
      {dialog?.kind === "statement" ? (
        <TextDialog
          title={t("statementTitle", { name: dialog.witness.name })}
          label={t("statement")}
          min={1}
          max={SAFETY_EVENT_LIMITS.statementMax}
          initial={dialog.witness.statement ?? ""}
          submitLabel={tc("save")}
          onClose={() => {
            setDialog(null);
          }}
          onSubmit={(statement) => {
            run(
              safetyEventsService.updateWitness(
                project.id,
                dto.id,
                dialog.witness.id,
                { statement, baseVersion: dialog.witness.version },
              ),
              t("saved"),
            );
          }}
        />
      ) : null}
      {dialog?.kind === "void" ? (
        <VoidDialog
          onClose={() => {
            setDialog(null);
          }}
          onSubmit={(kind, reason) => {
            run(
              safetyEventsService.transition(project.id, dto.id, {
                to: "void",
                kind,
                reason,
              }),
              t("voided"),
            );
          }}
        />
      ) : null}
    </div>
  );
}

function Detail({
  label,
  value,
  ltr,
}: {
  label: string;
  value: string;
  ltr?: boolean;
}) {
  return (
    <div>
      <dt className="font-medium">{label}</dt>
      <dd className="whitespace-pre-line text-muted-foreground">
        {ltr ? <bdi dir="ltr">{value}</bdi> : value}
      </dd>
    </div>
  );
}

/** US-043: classification on the matrix grid and the decision. */
function ReviewPanel({
  dto,
  projectId,
  onDone,
  onError,
  onDialog,
}: {
  dto: SafetyEventDto;
  projectId: string;
  onDone: (message: string) => void;
  onError: (message: string | null) => void;
  onDialog: (dialog: Dialog) => void;
}) {
  const t = useTranslations("safetyEvents.review");
  const ts = useTranslations("safetyEvents.severity");
  const tp = useTranslations("safetyEvents.page");
  const typeName = useTypeName();
  const errorMessage = useErrorMessage();
  const ids = { type: useId(), severity: useId(), note: useId() };
  const [settings, setSettings] = useState<SafetySettingsDto | null>(null);
  const [matrix, setMatrix] = useState<RiskMatrixDto | null>(null);
  const [typeId, setTypeId] = useState(dto.typeId);
  const [categoryIds, setCategoryIds] = useState(dto.categoryIds);
  const [severity, setSeverity] = useState<SafetySeverity>(
    dto.severity ?? dto.reportedSeverity,
  );
  const [risk, setRisk] = useState(
    dto.risk
      ? { likelihood: dto.risk.likelihood, consequence: dto.risk.consequence }
      : null,
  );
  const [note, setNote] = useState(dto.reviewNote ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void safetySettingsService.get().then(setSettings, () => undefined);
    void riskMatrixService.current().then(setMatrix, () => undefined);
  }, []);

  const type = settings?.types.find((x) => x.id === typeId);
  const required = type
    ? investigationRequired(type.investigation, severity)
    : dto.investigationRequired;
  const save = async (): Promise<boolean> => {
    setSaving(true);
    onError(null);
    try {
      await safetyEventsService.classify(projectId, dto.id, {
        typeId,
        categoryIds,
        severity,
        risk,
        reviewNote: note.trim() || null,
        baseVersion: dto.version,
      });
      return true;
    } catch (failure) {
      onError(errorMessage(failure));
      return false;
    } finally {
      setSaving(false);
    }
  };
  const decide = (next: Dialog) => {
    void save().then((ok) => {
      if (ok) onDialog(next);
    });
  };

  return (
    <section
      className="flex flex-col gap-4 rounded-xl border-2 border-primary/40 p-4"
      aria-labelledby="review"
    >
      <h2 id="review" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id={ids.type} label={t("type")}>
          <Select
            id={ids.type}
            value={typeId}
            onChange={(e) => {
              setTypeId(e.target.value);
            }}
          >
            {(settings?.types ?? [])
              .filter((x) => x.active || x.id === dto.typeId)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {typeName(x)}
                </option>
              ))}
          </Select>
        </FormField>
        <FormField
          id={ids.severity}
          label={t("severity", { proposed: ts(dto.reportedSeverity) })}
        >
          <Select
            id={ids.severity}
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value as SafetySeverity);
            }}
          >
            {SAFETY_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {ts(s)}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{t("categories")}</legend>
        <div className="flex flex-wrap gap-2">
          {(settings?.lists.category ?? [])
            .filter((c) => c.active)
            .map((c) => {
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
                  className={`min-h-9 rounded-full border px-3 text-sm disabled:opacity-40 ${on ? "border-primary bg-primary/10 font-medium text-primary" : "border-border hover:bg-muted"}`}
                >
                  {typeName(c)}
                </button>
              );
            })}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">
          {type?.riskRating === "required" ? t("riskRequired") : t("risk")}
        </h3>
        {matrix ? (
          <RiskGrid
            matrix={matrix}
            value={risk}
            onPick={(likelihood, consequence) => {
              setRisk({ likelihood, consequence });
            }}
          />
        ) : (
          <Spinner />
        )}
      </div>
      <FormField id={ids.note} label={t("note")}>
        <Textarea
          id={ids.note}
          value={note}
          maxLength={SAFETY_EVENT_LIMITS.reviewNoteMax}
          onChange={(e) => {
            setNote(e.target.value);
          }}
        />
      </FormField>
      <Alert tone={required ? "warning" : "info"}>
        {required ? t("required") : t("optional")}
      </Alert>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={saving}
          onClick={() => {
            void save().then((ok) => {
              if (ok) onDone(tp("saved"));
            });
          }}
        >
          {t("save")}
        </Button>
        <Button
          disabled={saving}
          onClick={() => {
            decide({ kind: "assign", required });
          }}
        >
          {t("assign")}
        </Button>
        {!required ? (
          <Button
            variant="secondary"
            disabled={saving}
            onClick={() => {
              decide({ kind: "act" });
            }}
          >
            {t("act")}
          </Button>
        ) : null}
        {!required && dto.access.close ? (
          <Button
            variant="secondary"
            disabled={saving}
            onClick={() => {
              decide({ kind: "close" });
            }}
          >
            {t("closeNoFurther")}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          disabled={saving}
          onClick={() => {
            onDialog({ kind: "void" });
          }}
        >
          {tp("void")}
        </Button>
      </div>
    </section>
  );
}

function AssignDialog({
  dto,
  projectId,
  reassign,
  required,
  onClose,
  onSubmit,
}: {
  dto: SafetyEventDto;
  projectId: string;
  reassign: boolean;
  required: boolean;
  onClose: () => void;
  onSubmit: (
    body:
      | { to: "assign"; leadId: string; memberIds: string[]; dueOn?: string }
      | {
          to: "reassign";
          leadId?: string;
          memberIds: string[];
          reason?: string;
        },
  ) => void;
}) {
  const t = useTranslations("safetyEvents.assign");
  const tc = useTranslations("common");
  const company = useCompany();
  const ids = { lead: useId(), member: useId(), due: useId(), reason: useId() };
  const severity = (dto.severity ?? dto.reportedSeverity) as SafetySeverity;
  const today = zonedIsoDate(Date.now(), company?.timeZone ?? "UTC");
  const days = { critical: 7, high: 14, medium: 21, low: 30 }[severity];
  const [lead, setLead] = useState("");
  const [members, setMembers] = useState<{ id: string; name: string }[]>(
    dto.investigation?.members ?? [],
  );
  const [due, setDue] = useState(
    dto.investigation?.dueOn ?? addIsoDays(today, days),
  );
  const [reason, setReason] = useState("");
  return (
    <FormDialog
      open
      title={reassign ? t("reassignTitle") : t("title")}
      submitLabel={reassign ? t("reassign") : t("assign")}
      cancelLabel={tc("cancel")}
      onClose={onClose}
      onSubmit={() => {
        const memberIds = members.map((m) => m.id);
        if (reassign)
          onSubmit({
            to: "reassign",
            ...(lead ? { leadId: lead } : {}),
            memberIds,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          });
        else if (lead)
          onSubmit({ to: "assign", leadId: lead, memberIds, dueOn: due });
      }}
    >
      <FormField id={ids.lead} label={reassign ? t("newLead") : t("lead")}>
        <PersonSelect
          id={ids.lead}
          projectId={projectId}
          value={lead}
          exclude={required ? [dto.reportedBy?.id ?? ""] : []}
          onChange={(userId) => {
            setLead(userId);
          }}
        />
      </FormField>
      <FormField
        id={ids.member}
        label={t("team", { max: SAFETY_EVENT_LIMITS.teamMax })}
      >
        <PersonSelect
          id={ids.member}
          projectId={projectId}
          value=""
          exclude={[lead, ...members.map((m) => m.id)]}
          onChange={(userId, name) => {
            if (members.length < SAFETY_EVENT_LIMITS.teamMax)
              setMembers([...members, { id: userId, name }]);
          }}
        />
      </FormField>
      {members.length > 0 ? (
        <ul className="flex flex-wrap gap-2 text-sm">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-1 rounded-full border border-border px-3 py-1"
            >
              {m.name}
              <button
                type="button"
                aria-label={tc("remove")}
                onClick={() => {
                  setMembers(members.filter((x) => x.id !== m.id));
                }}
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {reassign ? (
        <FormField id={ids.reason} label={t("reason")}>
          <Textarea
            id={ids.reason}
            value={reason}
            maxLength={500}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
        </FormField>
      ) : (
        <FormField id={ids.due} label={t("due")}>
          <Input
            id={ids.due}
            type="date"
            min={today}
            value={due}
            onChange={(e) => {
              setDue(e.target.value);
            }}
          />
        </FormField>
      )}
    </FormDialog>
  );
}

function ActionDialog({
  dto,
  projectId,
  addendum,
  onClose,
  onSubmit,
}: {
  dto: SafetyEventDto;
  projectId: string;
  addendum: boolean;
  onClose: () => void;
  onSubmit: (
    action: {
      title: string;
      ownerId: string;
      dueOn: string;
      priority: SafetySeverity;
    },
    recommendation: string,
  ) => void;
}) {
  const t = useTranslations("safetyEvents.action");
  const ts = useTranslations("safetyEvents.severity");
  const tc = useTranslations("common");
  const company = useCompany();
  const ids = {
    title: useId(),
    owner: useId(),
    due: useId(),
    priority: useId(),
    rec: useId(),
  };
  const today = zonedIsoDate(Date.now(), company?.timeZone ?? "UTC");
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState(addIsoDays(today, 3));
  const [priority, setPriority] = useState<SafetySeverity>(
    (dto.severity ?? dto.reportedSeverity) as SafetySeverity,
  );
  const [recommendation, setRecommendation] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      open
      title={addendum ? t("addendumTitle") : t("title")}
      error={error}
      submitLabel={t("raise")}
      cancelLabel={tc("cancel")}
      onClose={onClose}
      onSubmit={() => {
        if (
          title.trim().length < 5 ||
          !owner ||
          (addendum && recommendation.trim().length < 5)
        ) {
          setError(t("incomplete"));
          return;
        }
        onSubmit(
          { title: title.trim(), ownerId: owner, dueOn: due, priority },
          recommendation.trim(),
        );
      }}
    >
      {addendum ? (
        <FormField id={ids.rec} label={t("recommendation")}>
          <Textarea
            id={ids.rec}
            value={recommendation}
            onChange={(e) => {
              setRecommendation(e.target.value);
            }}
          />
        </FormField>
      ) : null}
      <FormField id={ids.title} label={t("actionTitle")}>
        <Input
          id={ids.title}
          value={title}
          maxLength={150}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
      </FormField>
      <FormField id={ids.owner} label={t("owner")}>
        <PersonSelect
          id={ids.owner}
          projectId={projectId}
          value={owner}
          onChange={(userId) => {
            setOwner(userId);
          }}
        />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id={ids.due} label={t("due")}>
          <Input
            id={ids.due}
            type="date"
            min={today}
            value={due}
            onChange={(e) => {
              setDue(e.target.value);
            }}
          />
        </FormField>
        <FormField id={ids.priority} label={t("priority")}>
          <Select
            id={ids.priority}
            value={priority}
            onChange={(e) => {
              setPriority(e.target.value as SafetySeverity);
            }}
          >
            {SAFETY_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {ts(s)}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      {priority === "high" || priority === "critical" ? (
        <p className="text-xs text-muted-foreground">{t("evidenceHint")}</p>
      ) : null}
    </FormDialog>
  );
}

function TextDialog({
  title,
  label,
  min,
  max,
  initial = "",
  submitLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  min: number;
  max: number;
  initial?: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const tc = useTranslations("common");
  const t = useTranslations("safetyEvents.page");
  const id = useId();
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      open
      title={title}
      error={error}
      submitLabel={submitLabel}
      cancelLabel={tc("cancel")}
      onClose={onClose}
      onSubmit={() => {
        if (text.trim().length < min) {
          setError(t("tooShort", { min }));
          return;
        }
        onSubmit(text.trim());
      }}
    >
      <FormField id={id} label={label}>
        <Textarea
          id={id}
          value={text}
          maxLength={max}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
      </FormField>
    </FormDialog>
  );
}

function VoidDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (kind: SafetyVoidKind, reason: string) => void;
}) {
  const t = useTranslations("safetyEvents.page");
  const tc = useTranslations("common");
  const ids = { kind: useId(), reason: useId() };
  const [kind, setKind] = useState<SafetyVoidKind>("reported_in_error");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      open
      title={t("voidTitle")}
      error={error}
      tone="danger"
      submitLabel={t("void")}
      cancelLabel={tc("cancel")}
      onClose={onClose}
      onSubmit={() => {
        if (reason.trim().length < 5) {
          setError(t("tooShort", { min: 5 }));
          return;
        }
        onSubmit(kind, reason.trim());
      }}
    >
      <FormField id={ids.kind} label={t("voidKind")}>
        <Select
          id={ids.kind}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as SafetyVoidKind);
          }}
        >
          {SAFETY_VOID_KINDS.filter((k) => k !== "duplicate").map((k) => (
            <option key={k} value={k}>
              {t(`voidKinds.${k}`)}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField id={ids.reason} label={t("reason")}>
        <Textarea
          id={ids.reason}
          value={reason}
          maxLength={500}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
      </FormField>
    </FormDialog>
  );
}

/** US-042: people injured or involved (sensitive, T-92). */
function PeopleSection({
  dto,
  projectId,
  readOnly,
  onSaved,
  onError,
}: {
  dto: SafetyEventDto;
  projectId: string;
  readOnly: boolean;
  onSaved: () => void;
  onError: (message: string | null) => void;
}) {
  const t = useTranslations("safetyEvents.people");
  const errorMessage = useErrorMessage();
  if (dto.family === "hazard") return null;
  if (dto.people === null) {
    if (dto.peopleCount === 0) return null;
    return (
      <section className="flex items-center gap-2 rounded-xl border border-border p-4 text-sm">
        <Lock aria-hidden className="size-4" />
        {t("restricted", { injured: dto.injuredCount, count: dto.peopleCount })}
      </section>
    );
  }
  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-border p-4"
      aria-labelledby="people"
    >
      <h2 id="people" className="flex items-center gap-2 text-lg font-semibold">
        <Lock aria-hidden className="size-4" />
        {t("titleInvolved")}
      </h2>
      <p className="text-xs text-muted-foreground">{t("privacy")}</p>
      {dto.people.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {dto.people.map((person) => (
          <li
            key={person.id}
            className="rounded-lg border border-border p-3 text-sm"
          >
            <span className="font-medium">{person.name}</span> ·{" "}
            {t(`roles.${person.role}`)}
            {person.role === "injured" ? (
              <span className="text-muted-foreground">
                {" · "}
                {[
                  person.injuryNature
                    ? t(`natures.${person.injuryNature}`)
                    : null,
                  person.bodyPart ? t(`bodyParts.${person.bodyPart}`) : null,
                  person.treatment ? t(`treatments.${person.treatment}`) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {dto.canEditPeople &&
      !readOnly &&
      dto.access.sensitive &&
      dto.family === "incident" ? (
        <label className="inline-flex min-h-10 w-fit cursor-pointer items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted">
          {t("medicalUpload")}
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              safetyEventsService
                .uploadSensitive(projectId, dto.id, file)
                .then(onSaved, (failure: unknown) => {
                  onError(errorMessage(failure));
                });
            }}
          />
        </label>
      ) : null}
    </section>
  );
}

/** US-045: witnesses; contacts and statements only for the investigation team and managers. */
function WitnessSection({
  dto,
  projectId,
  readOnly,
  onChanged,
  onError,
  onStatement,
}: {
  dto: SafetyEventDto;
  projectId: string;
  readOnly: boolean;
  onChanged: () => void;
  onError: (message: string | null) => void;
  onStatement: (witness: SafetyWitnessDto) => void;
}) {
  const t = useTranslations("safetyEvents.witnesses");
  const errorMessage = useErrorMessage();
  const { calendarDate } = useDateFormat();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  if (dto.witnesses.length === 0 && !dto.canAddWitness) return null;
  const editable = dto.canAddWitness && !readOnly;
  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-border p-4"
      aria-labelledby="witnesses"
    >
      <h2 id="witnesses" className="text-lg font-semibold">
        {t("title", { count: dto.witnesses.length })}
      </h2>
      <ul className="flex flex-col gap-2">
        {dto.witnesses.map((w) => (
          <li
            key={w.id}
            className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm"
          >
            <span className="font-medium">
              {w.name}
              {w.company ? ` · ${w.company}` : ""}
            </span>
            {w.restricted ? (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Lock aria-hidden className="size-3.5" />
                {w.hasStatement ? t("statementRecorded") : t("noStatement")}
              </span>
            ) : (
              <>
                {w.contact ? (
                  <bdi dir="ltr" className="text-muted-foreground">
                    {w.contact}
                  </bdi>
                ) : null}
                {w.statement ? (
                  <p className="whitespace-pre-line">
                    {w.statement}
                    <span className="block text-xs text-muted-foreground">
                      {t("takenBy", {
                        name: w.takenBy?.name ?? "",
                        date: w.statementOn ? calendarDate(w.statementOn) : "",
                      })}
                    </span>
                  </p>
                ) : null}
              </>
            )}
            {editable &&
            w.canEditStatement &&
            (dto.access.team || dto.access.manage) ? (
              <Button
                variant="secondary"
                className="w-fit"
                onClick={() => {
                  onStatement(w);
                }}
              >
                {w.statement ? t("editStatement") : t("recordStatement")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {editable && dto.witnesses.length < SAFETY_EVENT_LIMITS.witnessesMax ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Input
            aria-label={t("name")}
            placeholder={t("name")}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <Input
            aria-label={t("company")}
            placeholder={t("company")}
            value={company}
            onChange={(e) => {
              setCompany(e.target.value);
            }}
          />
          <Input
            aria-label={t("contact")}
            placeholder={t("contact")}
            value={contact}
            onChange={(e) => {
              setContact(e.target.value);
            }}
          />
          <Button
            variant="secondary"
            disabled={name.trim().length < 2}
            onClick={() => {
              safetyEventsService
                .addWitness(projectId, dto.id, {
                  name: name.trim(),
                  company: company.trim() || null,
                  contact: contact.trim() || null,
                })
                .then(
                  () => {
                    setName("");
                    setCompany("");
                    setContact("");
                    onChanged();
                  },
                  (failure: unknown) => {
                    onError(errorMessage(failure));
                  },
                );
            }}
          >
            <Plus aria-hidden className="size-4" />
            {t("add")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

interface CauseRow {
  key: string;
  categoryId: string;
  description: string;
  whys: string[];
}

/** US-044: the investigation workspace. */
function InvestigationSection({
  dto,
  projectId,
  readOnly,
  onChanged,
  onError,
}: {
  dto: SafetyEventDto;
  projectId: string;
  readOnly: boolean;
  onChanged: (message: string) => void;
  onError: (message: string | null) => void;
}) {
  const t = useTranslations("safetyEvents.investigation");
  const tp = useTranslations("safetyEvents.page");
  const tc = useTranslations("common");
  const typeName = useTypeName();
  const errorMessage = useErrorMessage();
  const { calendarDate } = useDateFormat();
  const investigation = dto.investigation;
  const ids = {
    sequence: useId(),
    lessons: useId(),
    rec: useId(),
    recKind: useId(),
  };
  const [settings, setSettings] = useState<SafetySettingsDto | null>(null);
  const [sequence, setSequence] = useState(
    investigation?.sequenceOfEvents ?? "",
  );
  const [lessons, setLessons] = useState(investigation?.lessonsLearned ?? "");
  const initialCauses = (kind: CauseKind): CauseRow[] =>
    (investigation?.causes ?? [])
      .filter((c) => c.kind === kind)
      .map((c) => ({
        key: c.id,
        categoryId: c.categoryId ?? "",
        description: c.description,
        whys: c.whys,
      }));
  const [causes, setCauses] = useState<Record<CauseKind, CauseRow[]>>({
    immediate: initialCauses("immediate"),
    root: initialCauses("root"),
    contributing: initialCauses("contributing"),
  });
  const [recText, setRecText] = useState("");
  const [recKind, setRecKind] = useState<
    "corrective" | "preventive" | "improvement"
  >("corrective");
  const editable = dto.canEditInvestigation && !readOnly;

  useEffect(() => {
    if (editable)
      void safetySettingsService.get().then(setSettings, () => undefined);
  }, [editable]);

  if (!investigation) return null;
  const fail = (failure: unknown) => {
    onError(errorMessage(failure));
  };
  const saveTexts = () => {
    safetyEventsService
      .saveInvestigation(projectId, dto.id, {
        sequenceOfEvents: sequence.trim() || null,
        lessonsLearned: lessons.trim() || null,
        baseVersion: investigation.version,
      })
      .then(() => {
        onChanged(tp("saved"));
      }, fail);
  };
  const saveCauses = (kind: CauseKind) => {
    safetyEventsService
      .saveCauses(projectId, dto.id, {
        kind,
        items: causes[kind]
          .filter((c) => c.description.trim().length >= 3)
          .map((c) => ({
            categoryId: kind === "contributing" ? null : c.categoryId || null,
            description: c.description.trim(),
            whys: c.whys.filter((w) => w.trim()),
          })),
        baseVersion: investigation.version,
      })
      .then(() => {
        onChanged(tp("saved"));
      }, fail);
  };

  return (
    <section
      className="flex flex-col gap-4 rounded-xl border border-border p-4"
      aria-labelledby="investigation"
    >
      <h2 id="investigation" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">
        {[
          t("lead", { name: investigation.lead?.name ?? "" }),
          investigation.members.length > 0
            ? t("team", {
                names: investigation.members.map((m) => m.name).join(", "),
              })
            : null,
          t("due", { date: calendarDate(investigation.dueOn) }),
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {investigation.overdueDays > 0 ? (
        <Alert tone="danger">
          {t("overdue", { days: investigation.overdueDays })}
        </Alert>
      ) : null}
      {investigation.instructions ? (
        <p className="text-sm">{investigation.instructions}</p>
      ) : null}
      {investigation.completedAt ? (
        <Alert tone="success">
          {t("completedOn", {
            date: calendarDate(
              new Date(investigation.completedAt).toISOString().slice(0, 10),
            ),
          })}
        </Alert>
      ) : null}

      {editable ? (
        <>
          <FormField id={ids.sequence} label={t("sequence")}>
            <Textarea
              id={ids.sequence}
              value={sequence}
              maxLength={SAFETY_EVENT_LIMITS.investigationTextMax}
              onChange={(e) => {
                setSequence(e.target.value);
              }}
            />
          </FormField>
          <FormField id={ids.lessons} label={t("lessons")}>
            <Textarea
              id={ids.lessons}
              value={lessons}
              maxLength={SAFETY_EVENT_LIMITS.investigationTextMax}
              onChange={(e) => {
                setLessons(e.target.value);
              }}
            />
          </FormField>
          <Button variant="secondary" className="w-fit" onClick={saveTexts}>
            {tc("save")}
          </Button>
        </>
      ) : (
        <dl className="grid gap-3 text-sm">
          {investigation.sequenceOfEvents ? (
            <Detail
              label={t("sequence")}
              value={investigation.sequenceOfEvents}
            />
          ) : null}
          {investigation.lessonsLearned ? (
            <Detail label={t("lessons")} value={investigation.lessonsLearned} />
          ) : null}
        </dl>
      )}

      {(["immediate", "root", "contributing"] as const).map((kind) => {
        const list = kind === "immediate" ? "immediate_cause" : "root_cause";
        const options = (settings?.lists[list] ?? []).filter((c) => c.active);
        return (
          <div key={kind} className="flex flex-col gap-2">
            <h3 className="font-medium">{t(`causes.${kind}`)}</h3>
            {!editable ? (
              <ul className="flex flex-col gap-1 text-sm">
                {investigation.causes
                  .filter((c) => c.kind === kind)
                  .map((c) => (
                    <li key={c.id}>
                      {c.categoryEn || c.categoryAr ? (
                        <span className="font-medium">
                          {typeName({
                            nameEn: c.categoryEn,
                            nameAr: c.categoryAr,
                          })}
                          :{" "}
                        </span>
                      ) : null}
                      {c.description}
                      {c.whys.length > 0 ? (
                        <ol className="ms-6 list-decimal text-muted-foreground">
                          {c.whys.map((why, index) => (
                            <li key={`${c.id}-${String(index)}`}>{why}</li>
                          ))}
                        </ol>
                      ) : null}
                    </li>
                  ))}
              </ul>
            ) : (
              <>
                {causes[kind].map((row, index) => (
                  <div
                    key={row.key}
                    className="flex flex-col gap-2 rounded-lg border border-border p-2"
                  >
                    {kind !== "contributing" ? (
                      <Select
                        aria-label={t("category")}
                        value={row.categoryId}
                        onChange={(e) => {
                          setCauses({
                            ...causes,
                            [kind]: causes[kind].map((r, i) =>
                              i === index
                                ? { ...r, categoryId: e.target.value }
                                : r,
                            ),
                          });
                        }}
                      >
                        <option value="">{t("category")}</option>
                        {options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {typeName(o)}
                          </option>
                        ))}
                      </Select>
                    ) : null}
                    <Textarea
                      aria-label={t("description")}
                      value={row.description}
                      maxLength={SAFETY_EVENT_LIMITS.causeTextMax}
                      onChange={(e) => {
                        setCauses({
                          ...causes,
                          [kind]: causes[kind].map((r, i) =>
                            i === index
                              ? { ...r, description: e.target.value }
                              : r,
                          ),
                        });
                      }}
                    />
                    {kind === "root" ? (
                      <div className="flex flex-col gap-1">
                        {row.whys.map((why, w) => (
                          <Input
                            key={`${row.key}-${String(w)}`}
                            aria-label={t("why", { n: w + 1 })}
                            placeholder={t("why", { n: w + 1 })}
                            value={why}
                            onChange={(e) => {
                              setCauses({
                                ...causes,
                                root: causes.root.map((r, i) =>
                                  i === index
                                    ? {
                                        ...r,
                                        whys: r.whys.map((x, j) =>
                                          j === w ? e.target.value : x,
                                        ),
                                      }
                                    : r,
                                ),
                              });
                            }}
                          />
                        ))}
                        {row.whys.length < SAFETY_EVENT_LIMITS.whysMax ? (
                          <Button
                            variant="secondary"
                            className="w-fit"
                            onClick={() => {
                              setCauses({
                                ...causes,
                                root: causes.root.map((r, i) =>
                                  i === index
                                    ? { ...r, whys: [...r.whys, ""] }
                                    : r,
                                ),
                              });
                            }}
                          >
                            {t("addWhy")}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    <Button
                      variant="secondary"
                      className="w-fit"
                      onClick={() => {
                        setCauses({
                          ...causes,
                          [kind]: causes[kind].filter((_, i) => i !== index),
                        });
                      }}
                    >
                      <Trash2 aria-hidden className="size-4" />
                      {tc("remove")}
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  {causes[kind].length < SAFETY_EVENT_LIMITS.causesMax ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setCauses({
                          ...causes,
                          [kind]: [
                            ...causes[kind],
                            {
                              key: crypto.randomUUID(),
                              categoryId: "",
                              description: "",
                              whys: [],
                            },
                          ],
                        });
                      }}
                    >
                      <Plus aria-hidden className="size-4" />
                      {t("addCause")}
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    onClick={() => {
                      saveCauses(kind);
                    }}
                  >
                    {tc("save")}
                  </Button>
                </div>
              </>
            )}
          </div>
        );
      })}

      {editable ? (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3">
          <h3 className="font-medium">{t("addRecommendation")}</h3>
          <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
            <Select
              id={ids.recKind}
              aria-label={t("recommendationKind")}
              value={recKind}
              onChange={(e) => {
                setRecKind(e.target.value as typeof recKind);
              }}
            >
              {(["corrective", "preventive", "improvement"] as const).map(
                (k) => (
                  <option key={k} value={k}>
                    {tp(`recommendationKind.${k}`)}
                  </option>
                ),
              )}
            </Select>
            <Input
              id={ids.rec}
              aria-label={t("recommendation")}
              placeholder={t("recommendation")}
              value={recText}
              onChange={(e) => {
                setRecText(e.target.value);
              }}
            />
            <Button
              variant="secondary"
              disabled={recText.trim().length < 5}
              onClick={() => {
                safetyEventsService
                  .addRecommendation(projectId, dto.id, {
                    kind: recKind,
                    description: recText.trim(),
                  })
                  .then(() => {
                    setRecText("");
                    onChanged(tp("saved"));
                  }, fail);
              }}
            >
              <Plus aria-hidden className="size-4" />
              {tc("add")}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function History({ projectId, id }: { projectId: string; id: string }) {
  const t = useTranslations("safetyEvents.page");
  const sentence = useActivitySentence();
  const { dateTime } = useDateFormat();
  const [page, setPage] = useState<TimelinePageDto | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    safetyEventsService.history(projectId, id).then(setPage, () => undefined);
  }, [open, projectId, id]);
  return (
    <details
      className="rounded-xl border border-border p-4"
      onToggle={(e) => {
        setOpen((e.target as HTMLDetailsElement).open);
      }}
    >
      <summary className="cursor-pointer font-medium">{t("history")}</summary>
      {page ? (
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {page.items.map((entry) => (
            <li key={entry.id}>
              <span>{sentence(entry)}</span>{" "}
              <span className="text-muted-foreground">
                {dateTime(entry.occurredAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}
