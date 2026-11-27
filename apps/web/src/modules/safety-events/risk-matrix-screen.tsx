"use client";

import {
  type RiskMatrix,
  type RiskMatrixDto,
  type RiskMatrixVersionListItemDto,
  validateRiskMatrix,
} from "@hse/shared";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useDateFormat } from "@/modules/i18n/use-date-format";
import { useErrorMessage } from "@/modules/i18n/use-error-message";

import { RiskGrid, useRiskText } from "./safety-event-ui";
import { riskMatrixService } from "./safety-events.service";

/** PLT-34: the company risk matrix — labels, bands, preview grid, versions. */
export function RiskMatrixScreen() {
  const t = useTranslations("safetyEvents.matrix");
  const tc = useTranslations("common");
  const errorMessage = useErrorMessage();
  const text = useRiskText();
  const { dateTime } = useDateFormat();
  const [current, setCurrent] = useState<RiskMatrixDto | null>(null);
  const [draft, setDraft] = useState<RiskMatrix | null>(null);
  const [versions, setVersions] = useState<RiskMatrixVersionListItemDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    riskMatrixService.current().then(
      (matrix) => {
        setCurrent(matrix);
        setDraft({
          size: matrix.size,
          likelihood: matrix.likelihood,
          consequence: matrix.consequence,
          bands: matrix.bands,
        });
      },
      (failure: unknown) => {
        setError(errorMessage(failure));
      },
    );
    riskMatrixService.versions().then(setVersions, () => undefined);
  }, [errorMessage]);
  useEffect(load, [load]);

  if (!current || !draft) {
    return error ? (
      <Alert tone="danger">{error}</Alert>
    ) : (
      <div className="flex items-center gap-3" role="status">
        <Spinner />
        {tc("loading")}
      </div>
    );
  }
  const issues = validateRiskMatrix(draft);
  const editable = current.canManage;
  const save = (work: Promise<RiskMatrixDto>) => {
    setError(null);
    work.then(
      (saved) => {
        setNotice(t("saved", { version: saved.versionNo }));
        load();
      },
      (failure: unknown) => {
        setError(errorMessage(failure));
      },
    );
  };
  const setLevel = (
    axis: "likelihood" | "consequence",
    index: number,
    lang: "en" | "ar",
    value: string,
  ) => {
    setDraft({
      ...draft,
      [axis]: draft[axis].map((level, i) =>
        i === index
          ? { ...level, label: { ...level.label, [lang]: value } }
          : level,
      ),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("version", {
            version: current.versionNo,
            size: `${String(current.size)}×${String(current.size)}`,
          })}
        </p>
      </div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <RiskGrid matrix={draft} />

      {editable ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                save(riskMatrixService.reset(5));
              }}
            >
              {t("reset5")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                save(riskMatrixService.reset(4));
              }}
            >
              {t("reset4")}
            </Button>
          </div>
          {(["likelihood", "consequence"] as const).map((axis) => (
            <section
              key={axis}
              className="flex flex-col gap-2"
              aria-labelledby={`axis-${axis}`}
            >
              <h2 id={`axis-${axis}`} className="text-lg font-semibold">
                {t(axis)}
              </h2>
              {draft[axis].map((level, index) => (
                <div
                  key={level.value}
                  className="grid items-center gap-2 sm:grid-cols-[2rem_1fr_1fr]"
                >
                  <bdi dir="ltr" className="font-semibold">
                    {String(level.value)}
                  </bdi>
                  <Input
                    aria-label={t("labelEn", { n: level.value })}
                    value={level.label.en}
                    maxLength={40}
                    onChange={(e) => {
                      setLevel(axis, index, "en", e.target.value);
                    }}
                  />
                  <Input
                    aria-label={t("labelAr", { n: level.value })}
                    dir="rtl"
                    value={level.label.ar ?? ""}
                    maxLength={40}
                    onChange={(e) => {
                      setLevel(axis, index, "ar", e.target.value);
                    }}
                  />
                </div>
              ))}
            </section>
          ))}
          <section className="flex flex-col gap-2" aria-labelledby="bands">
            <h2 id="bands" className="text-lg font-semibold">
              {t("bands")}
            </h2>
            {draft.bands.map((band, index) => (
              <div
                key={band.key}
                className="grid items-center gap-2 sm:grid-cols-[8rem_5rem_5rem_1fr]"
              >
                <span className="font-medium">{text(band.label)}</span>
                <Input
                  aria-label={t("from", { band: text(band.label) })}
                  type="number"
                  min={1}
                  max={25}
                  value={band.min}
                  onChange={(e) => {
                    setDraft({
                      ...draft,
                      bands: draft.bands.map((b, i) =>
                        i === index ? { ...b, min: Number(e.target.value) } : b,
                      ),
                    });
                  }}
                />
                <Input
                  aria-label={t("to", { band: text(band.label) })}
                  type="number"
                  min={1}
                  max={25}
                  value={band.max}
                  onChange={(e) => {
                    setDraft({
                      ...draft,
                      bands: draft.bands.map((b, i) =>
                        i === index ? { ...b, max: Number(e.target.value) } : b,
                      ),
                    });
                  }}
                />
                <Input
                  aria-label={t("response", { band: text(band.label) })}
                  value={band.response.en}
                  maxLength={300}
                  onChange={(e) => {
                    setDraft({
                      ...draft,
                      bands: draft.bands.map((b, i) =>
                        i === index
                          ? {
                              ...b,
                              response: { ...b.response, en: e.target.value },
                            }
                          : b,
                      ),
                    });
                  }}
                />
              </div>
            ))}
          </section>
          {issues.length > 0 ? (
            <Alert tone="warning">
              {t("invalid", { count: issues.length })}
            </Alert>
          ) : null}
          <Button
            disabled={issues.length > 0}
            onClick={() => {
              save(riskMatrixService.save(draft));
            }}
          >
            {t("save")}
          </Button>
        </>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {current.bands.map((band) => (
            <li key={band.key}>
              <span className="font-medium">{text(band.label)}</span>{" "}
              <bdi dir="ltr">{`${String(band.min)}–${String(band.max)}`}</bdi> ·{" "}
              {text(band.response)}
            </li>
          ))}
        </ul>
      )}

      <section className="flex flex-col gap-2" aria-labelledby="versions">
        <h2 id="versions" className="text-lg font-semibold">
          {t("versions")}
        </h2>
        <ul className="flex flex-col gap-1 text-sm">
          {versions.map((v) => (
            <li key={v.versionNo}>
              {t("versionLine", {
                version: v.versionNo,
                size: `${String(v.size)}×${String(v.size)}`,
                date: dateTime(v.createdAt),
                name: v.createdByName ?? t("system"),
              })}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
