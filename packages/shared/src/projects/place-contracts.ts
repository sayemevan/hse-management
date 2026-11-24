import { z } from 'zod';

/**
 * Areas, Locations and Work Zones (US-019 – US-021, T-38). One `place` table with three fixed
 * levels: an Area has no parent, a Location belongs to an Area, a Work Zone to a Location.
 */
export const PLACE_LEVELS = ['area', 'location', 'work_zone'] as const;
export type PlaceLevel = (typeof PLACE_LEVELS)[number];

/** The level a parent must have, per level (null = no parent). */
export const PLACE_PARENT_LEVEL: Readonly<Record<PlaceLevel, PlaceLevel | null>> = {
  area: null,
  location: 'area',
  work_zone: 'location',
};

/** The level of the children of a level (null = none). */
export const PLACE_CHILD_LEVEL: Readonly<Record<PlaceLevel, PlaceLevel | null>> = {
  area: 'location',
  location: 'work_zone',
  work_zone: null,
};

/** O-60 and US-019 FR-7. */
export const PLACE_LIMITS = {
  nameMin: 2,
  nameMax: 80,
  codeMin: 1,
  codeMax: 12,
  descriptionMax: 500,
  /** Siblings per parent (areas per project, locations per area, zones per location). */
  siblingsMax: 200,
  totalMax: 5000,
} as const;

export const PLACE_CODE_PATTERN = /^[A-Z0-9-]+$/;

/** Names are unique among siblings ignoring case and surrounding spaces (O-60). */
export function placeNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

const placeCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(
    z
      .string()
      .max(PLACE_LIMITS.codeMax)
      .refine((value) => value === '' || PLACE_CODE_PATTERN.test(value), 'invalidPlaceCode'),
  )
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

const placeNameSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, ' '))
  .pipe(z.string().min(PLACE_LIMITS.nameMin).max(PLACE_LIMITS.nameMax));

const placeDescriptionSchema = z
  .string()
  .trim()
  .max(PLACE_LIMITS.descriptionMax)
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

export const createPlaceRequestSchema = z
  .object({
    level: z.enum(PLACE_LEVELS),
    parentId: z.uuid().nullable().optional(),
    name: placeNameSchema,
    code: placeCodeSchema,
    description: placeDescriptionSchema,
  })
  .refine((value) => (value.level === 'area') === !value.parentId, {
    path: ['parentId'],
    message: 'placeParentRequired',
  });
export type CreatePlaceRequest = z.input<typeof createPlaceRequestSchema>;

export const updatePlaceRequestSchema = z.object({
  name: placeNameSchema.optional(),
  code: placeCodeSchema,
  description: placeDescriptionSchema,
});
export type UpdatePlaceRequest = z.input<typeof updatePlaceRequestSchema>;

export const movePlaceRequestSchema = z.object({ direction: z.enum(['up', 'down']) });
export type MovePlaceRequest = z.input<typeof movePlaceRequestSchema>;

export const placeTreeQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

// ---- Responses -------------------------------------------------------------------------

export interface PlaceDto {
  id: string;
  level: PlaceLevel;
  parentId: string | null;
  name: string;
  code: string | null;
  description: string | null;
  position: number;
  active: boolean;
  children: PlaceDto[];
}

export interface PlaceTreeDto {
  areas: PlaceDto[];
}

/** A selection in the place picker (US-021, O-56). Each id is the parent of the next. */
export interface PlaceSelection {
  areaId?: string | null;
  locationId?: string | null;
  workZoneId?: string | null;
}
