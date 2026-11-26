import type { PlaceLevel, PlaceSelection, ValidationIssue } from '@hse/shared';

import type { Database } from '../../database/client';
import { PlaceRepository } from './place.repository';
import type { PlaceRow } from './place.schema';

export interface ResolvedPlace {
  areaId: string | null;
  locationId: string | null;
  workZoneId: string | null;
  /** Names from the area down, e.g. ["Block A", "Floor 01", "Scaffold Zone"]. */
  names: string[];
  active: boolean;
}

/**
 * What other modules may know about places (US-019 FR-10, US-021 FR-4). Records store the three
 * ids (T-38); this fills and checks them consistently.
 */
export class PlaceDirectory {
  private readonly places: PlaceRepository;

  constructor(db: Database) {
    this.places = new PlaceRepository(db);
  }

  /** The chain from the area down to `placeId`, or undefined for a place of another project. */
  async resolve(
    companyId: string,
    projectId: string,
    placeId: string,
  ): Promise<ResolvedPlace | undefined> {
    const rows = new Map(
      (await this.places.listForProject(companyId, projectId)).map((row) => [row.id, row]),
    );
    const chain: PlaceRow[] = [];
    let current = rows.get(placeId);
    while (current) {
      chain.unshift(current);
      current = current.parentId ? rows.get(current.parentId) : undefined;
    }
    if (chain.length === 0) return undefined;
    const idOf = (level: PlaceLevel) => chain.find((row) => row.level === level)?.id ?? null;
    return {
      areaId: idOf('area'),
      locationId: idOf('location'),
      workZoneId: idOf('work_zone'),
      names: chain.map((row) => row.name),
      active: chain.every((row) => row.active),
    };
  }

  /** Several places of one project at once (lists of records), by the deepest place id. */
  async resolveMany(
    companyId: string,
    projectId: string,
    placeIds: readonly string[],
  ): Promise<Map<string, ResolvedPlace>> {
    const result = new Map<string, ResolvedPlace>();
    if (placeIds.length === 0) return result;
    const rows = new Map(
      (await this.places.listForProject(companyId, projectId)).map((row) => [row.id, row]),
    );
    for (const placeId of new Set(placeIds)) {
      const chain: PlaceRow[] = [];
      let current = rows.get(placeId);
      while (current) {
        chain.unshift(current);
        current = current.parentId ? rows.get(current.parentId) : undefined;
      }
      if (chain.length === 0) continue;
      const idOf = (level: PlaceLevel) => chain.find((row) => row.level === level)?.id ?? null;
      result.set(placeId, {
        areaId: idOf('area'),
        locationId: idOf('location'),
        workZoneId: idOf('work_zone'),
        names: chain.map((row) => row.name),
        active: chain.every((row) => row.active),
      });
    }
    return result;
  }

  /**
   * O-56: an optional selection that stops at any level, never a level without its parent,
   * active places only (unless already on the record being edited). Returns field issues for
   * the caller to raise as `422 VALIDATION_FAILED`.
   */
  async validateSelection(
    companyId: string,
    projectId: string,
    selection: PlaceSelection,
    options: { required?: PlaceLevel; allowInactiveIds?: readonly string[] } = {},
  ): Promise<ValidationIssue[]> {
    const rows = new Map(
      (await this.places.listForProject(companyId, projectId)).map((row) => [row.id, row]),
    );
    const steps: { field: keyof PlaceSelection; level: PlaceLevel; parent: string | null }[] = [
      { field: 'areaId', level: 'area', parent: null },
      { field: 'locationId', level: 'location', parent: selection.areaId ?? null },
      { field: 'workZoneId', level: 'work_zone', parent: selection.locationId ?? null },
    ];
    const issues: ValidationIssue[] = [];
    let previousChosen = true;
    for (const step of steps) {
      const id = selection[step.field] ?? null;
      if (!id) {
        if (options.required === step.level) {
          issues.push({ path: step.field, message: 'placeRequired' });
        }
        previousChosen = false;
        continue;
      }
      const row = rows.get(id);
      if (!previousChosen || row?.level !== step.level || row.parentId !== step.parent) {
        issues.push({ path: step.field, message: 'placeInvalid' });
        break;
      }
      if (!row.active && !options.allowInactiveIds?.includes(row.id)) {
        issues.push({ path: step.field, message: 'placeInactive' });
      }
    }
    const order: PlaceLevel[] = ['area', 'location', 'work_zone'];
    if (options.required && issues.length === 0) {
      const needed = order.slice(0, order.indexOf(options.required) + 1);
      const fields = { area: 'areaId', location: 'locationId', work_zone: 'workZoneId' } as const;
      for (const level of needed) {
        if (!selection[fields[level]]) {
          issues.push({ path: fields[level], message: 'placeRequired' });
          break;
        }
      }
    }
    return issues;
  }

  /** Active place counts per level (PLT-19 FR-6). */
  activeCounts(projectId: string): Promise<Record<PlaceLevel, number>> {
    return this.places.activeCounts(projectId);
  }
}
