import { z } from "zod";

/**
 * The company risk matrix (Sprint 11: PLT-34; T-87, O-160 answering Q-22). One current matrix
 * per company, every save a new immutable version. `rateRisk` is the one rating function used by
 * the device and the server; consumers store a `RiskRatingSnapshot`.
 */
export const RISK_MATRIX_SIZES = [4, 5] as const;
export type RiskMatrixSize = (typeof RISK_MATRIX_SIZES)[number];

export const RISK_BAND_KEYS = ["low", "medium", "high", "critical"] as const;
export type RiskBandKey = (typeof RISK_BAND_KEYS)[number];

export interface RiskText {
  en: string;
  ar?: string | null;
}

export interface RiskLevel {
  /** 1 … size. */
  value: number;
  label: RiskText;
  description?: RiskText | null;
}

export interface RiskBand {
  key: RiskBandKey;
  /** Inclusive score range. */
  min: number;
  max: number;
  label: RiskText;
  response: RiskText;
}

export interface RiskMatrix {
  size: RiskMatrixSize;
  likelihood: RiskLevel[];
  consequence: RiskLevel[];
  bands: RiskBand[];
}

export const RISK_LIMITS = {
  labelMax: 40,
  descriptionMax: 200,
  responseMax: 300,
  bandsMin: 2,
  bandsMax: 4,
} as const;

const BAND_LABELS: Record<RiskBandKey, RiskText> = {
  low: { en: "Low", ar: "منخفض" },
  medium: { en: "Medium", ar: "متوسط" },
  high: { en: "High", ar: "مرتفع" },
  critical: { en: "Critical", ar: "حرج" },
};

const BAND_RESPONSES: Record<RiskBandKey, RiskText> = {
  low: {
    en: "Manage by routine procedures.",
    ar: "تُدار بالإجراءات الاعتيادية.",
  },
  medium: {
    en: "Reduce the risk; supervisor attention and controls within the agreed time.",
    ar: "يجب تقليل الخطر؛ متابعة المشرف وتطبيق الضوابط في الوقت المتفق عليه.",
  },
  high: {
    en: "Senior attention; controls before work continues.",
    ar: "متابعة الإدارة العليا؛ تطبيق الضوابط قبل استئناف العمل.",
  },
  critical: {
    en: "Stop work; immediate action; do not resume until the risk is reduced.",
    ar: "أوقف العمل؛ إجراء فوري؛ لا يُستأنف العمل حتى يتم تقليل الخطر.",
  },
};

const LIKELIHOOD_5: RiskText[] = [
  { en: "Rare", ar: "نادر" },
  { en: "Unlikely", ar: "غير محتمل" },
  { en: "Possible", ar: "ممكن" },
  { en: "Likely", ar: "محتمل" },
  { en: "Almost certain", ar: "شبه مؤكد" },
];
const CONSEQUENCE_5: RiskText[] = [
  { en: "Insignificant", ar: "ضئيل" },
  { en: "Minor", ar: "طفيف" },
  { en: "Moderate", ar: "متوسط" },
  { en: "Major", ar: "كبير" },
  { en: "Catastrophic", ar: "كارثي" },
];

const levels = (labels: readonly RiskText[]): RiskLevel[] =>
  labels.map((label, index) => ({ value: index + 1, label: { ...label } }));

const band = (key: RiskBandKey, min: number, max: number): RiskBand => ({
  key,
  min,
  max,
  label: { ...BAND_LABELS[key] },
  response: { ...BAND_RESPONSES[key] },
});

/** O-160: the default matrix of each size. */
export function defaultRiskMatrix(size: RiskMatrixSize = 5): RiskMatrix {
  if (size === 4) {
    return {
      size: 4,
      likelihood: levels(LIKELIHOOD_5.slice(1)),
      consequence: levels(CONSEQUENCE_5.slice(1)),
      bands: [
        band("low", 1, 3),
        band("medium", 4, 6),
        band("high", 8, 9),
        band("critical", 12, 16),
      ],
    };
  }
  return {
    size: 5,
    likelihood: levels(LIKELIHOOD_5),
    consequence: levels(CONSEQUENCE_5),
    bands: [
      band("low", 1, 4),
      band("medium", 5, 9),
      band("high", 10, 16),
      band("critical", 20, 25),
    ],
  };
}

/** Every score a likelihood × consequence can give on a matrix of this size. */
export function riskScores(size: number): number[] {
  const scores = new Set<number>();
  for (let l = 1; l <= size; l += 1)
    for (let c = 1; c <= size; c += 1) scores.add(l * c);
  return [...scores].sort((a, b) => a - b);
}

export interface RiskMatrixIssue {
  path: string;
  message: string;
}

/** PLT-34 FR-2. */
export function validateRiskMatrix(matrix: RiskMatrix): RiskMatrixIssue[] {
  const issues: RiskMatrixIssue[] = [];
  const { size } = matrix;
  for (const axis of ["likelihood", "consequence"] as const) {
    const list = matrix[axis];
    if (list.length !== size)
      issues.push({ path: axis, message: "levelCount" });
    list.forEach((level, index) => {
      if (level.value !== index + 1)
        issues.push({
          path: `${axis}.${String(index)}.value`,
          message: "order",
        });
      if (!level.label.en.trim())
        issues.push({
          path: `${axis}.${String(index)}.label.en`,
          message: "required",
        });
    });
  }
  const { bands } = matrix;
  if (
    bands.length < RISK_LIMITS.bandsMin ||
    bands.length > RISK_LIMITS.bandsMax
  ) {
    issues.push({ path: "bands", message: "bandCount" });
  }
  const keys = new Set<string>();
  bands.forEach((entry, index) => {
    if (keys.has(entry.key))
      issues.push({ path: `bands.${String(index)}.key`, message: "duplicate" });
    keys.add(entry.key);
    if (entry.min > entry.max)
      issues.push({ path: `bands.${String(index)}`, message: "range" });
    if (!entry.label.en.trim())
      issues.push({
        path: `bands.${String(index)}.label.en`,
        message: "required",
      });
    const previous = bands[index - 1];
    if (previous && entry.min <= previous.max)
      issues.push({ path: `bands.${String(index)}`, message: "overlap" });
    if (
      previous &&
      RISK_BAND_KEYS.indexOf(entry.key) <= RISK_BAND_KEYS.indexOf(previous.key)
    ) {
      issues.push({ path: `bands.${String(index)}.key`, message: "order" });
    }
  });
  for (const score of riskScores(size)) {
    const matches = bands.filter(
      (entry) => score >= entry.min && score <= entry.max,
    ).length;
    if (matches !== 1) {
      issues.push({
        path: "bands",
        message:
          matches === 0 ? `gap:${String(score)}` : `overlap:${String(score)}`,
      });
    }
  }
  return issues;
}

export interface RiskRating {
  score: number;
  band: RiskBand;
}

/** T-87: the one rating function (device and server). */
export function rateRisk(
  matrix: RiskMatrix,
  likelihood: number,
  consequence: number,
): RiskRating | null {
  if (!Number.isInteger(likelihood) || !Number.isInteger(consequence))
    return null;
  if (
    likelihood < 1 ||
    consequence < 1 ||
    likelihood > matrix.size ||
    consequence > matrix.size
  )
    return null;
  const score = likelihood * consequence;
  const found = matrix.bands.find(
    (entry) => score >= entry.min && score <= entry.max,
  );
  return found ? { score, band: found } : null;
}

/** What a consumer stores with its record (T-87): never changes when the matrix does. */
export interface RiskRatingSnapshot {
  matrixVersion: number;
  likelihood: number;
  consequence: number;
  score: number;
  bandKey: RiskBandKey;
  bandLabel: RiskText;
}

// ---- Requests and responses --------------------------------------------------------------

const text = (max: number) =>
  z.object({
    en: z.string().trim().min(1, "required").max(max, "tooLong"),
    ar: z
      .string()
      .trim()
      .max(max, "tooLong")
      .transform((value) => (value === "" ? null : value))
      .nullable()
      .optional(),
  });

const levelSchema = z.object({
  value: z.number().int().min(1).max(5),
  label: text(RISK_LIMITS.labelMax),
  description: text(RISK_LIMITS.descriptionMax).nullable().optional(),
});

export const riskMatrixRequestSchema = z.object({
  size: z.union([z.literal(4), z.literal(5)]),
  likelihood: z.array(levelSchema).min(4).max(5),
  consequence: z.array(levelSchema).min(4).max(5),
  bands: z
    .array(
      z.object({
        key: z.enum(RISK_BAND_KEYS),
        min: z.number().int().min(1).max(25),
        max: z.number().int().min(1).max(25),
        label: text(RISK_LIMITS.labelMax),
        response: text(RISK_LIMITS.responseMax),
      }),
    )
    .min(RISK_LIMITS.bandsMin)
    .max(RISK_LIMITS.bandsMax),
});
export type RiskMatrixRequest = z.input<typeof riskMatrixRequestSchema>;

export const riskMatrixResetRequestSchema = z.object({
  size: z.union([z.literal(4), z.literal(5)]).default(5),
});

export interface RiskMatrixDto extends RiskMatrix {
  versionNo: number;
  createdAt: number;
  createdByName: string | null;
  canManage: boolean;
}

export interface RiskMatrixVersionListItemDto {
  versionNo: number;
  size: RiskMatrixSize;
  createdAt: number;
  createdByName: string | null;
}
