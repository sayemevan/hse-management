import {
  allowedSafetyEventTransitions,
  defaultRiskMatrix,
  investigationRequired,
  occurredAtIssue,
  parseSafetyEventNumber,
  rateRisk,
  reportedLate,
  riskScores,
  safetyEventReference,
  severityAtLeast,
  validateRiskMatrix,
} from "@hse/shared";
import { describe, expect, it } from "vitest";

import { displayLabel } from "../src/modules/offline/registry";
import { outboxLabel } from "../src/modules/safety-events/safety-event-offline";

const HOUR_MS = 60 * 60 * 1000;

describe("PLT-34 rateRisk and the default matrices (O-160)", () => {
  it("rates every cell of the 5×5 into the O-160 bands", () => {
    const matrix = defaultRiskMatrix(5);
    expect(validateRiskMatrix(matrix)).toEqual([]);
    const band = (l: number, c: number) => rateRisk(matrix, l, c)?.band.key;
    expect(band(1, 4)).toBe("low");
    expect(band(1, 5)).toBe("medium");
    expect(band(3, 3)).toBe("medium");
    expect(band(2, 5)).toBe("high");
    expect(band(4, 4)).toBe("high");
    expect(band(4, 5)).toBe("critical");
    expect(rateRisk(matrix, 5, 5)?.score).toBe(25);
    for (let l = 1; l <= 5; l += 1)
      for (let c = 1; c <= 5; c += 1)
        expect(rateRisk(matrix, l, c)).not.toBeNull();
  });

  it("rates the 4×4 and refuses levels outside the matrix", () => {
    const matrix = defaultRiskMatrix(4);
    expect(validateRiskMatrix(matrix)).toEqual([]);
    expect(rateRisk(matrix, 3, 3)?.band.key).toBe("high");
    expect(rateRisk(matrix, 4, 4)?.band.key).toBe("critical");
    expect(rateRisk(matrix, 5, 1)).toBeNull();
    expect(rateRisk(matrix, 0, 1)).toBeNull();
  });

  it("finds gaps and overlaps but allows ranges that skip non-products", () => {
    expect(riskScores(5)).not.toContain(17);
    const gap = defaultRiskMatrix(5);
    gap.bands[2] = { ...gap.bands[2]!, min: 13 };
    expect(
      validateRiskMatrix(gap).some((issue) => issue.message === "gap:10"),
    ).toBe(true);
    const overlap = defaultRiskMatrix(5);
    overlap.bands[1] = { ...overlap.bands[1]!, max: 12 };
    expect(validateRiskMatrix(overlap).length).toBeGreaterThan(0);
  });
});

describe("O-159 mandatory investigation and the workflow (T-86)", () => {
  it("requires an investigation by type, or by High and Critical severity", () => {
    expect(investigationRequired("required", "low")).toBe(true);
    expect(investigationRequired("by_severity", "medium")).toBe(false);
    expect(investigationRequired("by_severity", "high")).toBe(true);
    expect(investigationRequired("by_severity", "critical")).toBe(true);
    expect(investigationRequired("optional", "critical")).toBe(false);
    expect(severityAtLeast("medium", "high")).toBe(false);
    expect(severityAtLeast("critical", "high")).toBe(true);
  });

  it("offers act and close from review only when no investigation is required", () => {
    const facts = {
      manage: true,
      close: true,
      lead: false,
      investigationRequired: false,
      investigated: false,
      voided: false,
    };
    expect(allowedSafetyEventTransitions("reported", facts)).toEqual([
      "assign",
      "act",
      "close",
      "void",
    ]);
    expect(
      allowedSafetyEventTransitions("reported", {
        ...facts,
        investigationRequired: true,
      }),
    ).toEqual(["assign", "void"]);
    expect(
      allowedSafetyEventTransitions("verification", {
        ...facts,
        investigated: true,
      }),
    ).toEqual(["close", "return"]);
    expect(
      allowedSafetyEventTransitions("verification", {
        ...facts,
        investigated: true,
        lead: true,
      }),
    ).toEqual(["close"]);
    expect(
      allowedSafetyEventTransitions("under_investigation", {
        ...facts,
        manage: false,
        lead: true,
      }),
    ).toEqual(["complete_investigation"]);
    expect(
      allowedSafetyEventTransitions("reported", { ...facts, voided: true }),
    ).toEqual([]);
  });
});

describe("O-177 time rules, T-91 numbers, T-90 labels", () => {
  it("flags future and old events and late reports", () => {
    const now = Date.now();
    expect(occurredAtIssue(now + 2 * HOUR_MS, now)).toBe("future");
    expect(occurredAtIssue(now + 60_000, now)).toBeNull();
    expect(occurredAtIssue(now - 400 * 24 * HOUR_MS, now)).toBe("tooOld");
    expect(reportedLate(now - 25 * HOUR_MS, now)).toBe(true);
    expect(reportedLate(now - 2 * HOUR_MS, now)).toBe(false);
  });

  it("formats and parses event numbers", () => {
    expect(safetyEventReference("RMX-02", 14)).toBe("RMX-02-EVT-0014");
    expect(safetyEventReference("RMX-02", null)).toBeNull();
    expect(parseSafetyEventNumber("RMX-02-EVT-0014")).toBe(14);
    expect(parseSafetyEventNumber("14")).toBe(14);
    expect(parseSafetyEventNumber("scaffold")).toBeNull();
  });

  it("renders the outbox label in the reader language", () => {
    const label = outboxLabel({
      typeNameEn: "Hazard",
      typeNameAr: "خطر",
      reference: null,
      title: "Open trench",
    });
    expect(displayLabel(label, "en")).toBe("Hazard · Open trench");
    expect(displayLabel(label, "ar-SA")).toBe("خطر · Open trench");
    const numbered = outboxLabel({
      typeNameEn: "Hazard",
      typeNameAr: null,
      reference: "RMX-02-EVT-0001",
      title: "Open trench",
    });
    expect(displayLabel(numbered, "ar")).toBe(
      "RMX-02-EVT-0001 · Hazard · Open trench",
    );
  });
});
