import {
  expiryState,
  generateId,
  type RecordKind,
  type recordRequestSchemas,
  type WorkforceRecordDto,
  type WorkforceRecordListDto,
  workforceKey,
} from '@hse/shared';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';

import type { Principal } from '../../core/auth/principal';
import type { TenantCompany } from '../../core/context/tenant';
import { NotFoundError, ValidationError } from '../../core/errors/app-error';
import { type Statement, UnitOfWork } from '../../database/unit-of-work';
import { changedFields } from '../../platform/activity';
import type { AuditAction } from '../../platform/audit-log';
import type { FileCategory, OpenedFile } from '../../platform/file-storage';
import { medicalStatus } from './compliance';
import { assertNotArchived } from './member.service';
import {
  assertRead,
  assertWrite,
  mayRead,
  type MemberRight,
  type WorkforceAccess,
} from './workforce-access';
import type { WorkforceContext } from './workforce-context';
import { DocumentNumberTakenError, RecordVoidedError } from './workforce.errors';
import {
  workforceRecord,
  type WorkforceMemberRow,
  type WorkforceRecordRow,
} from './workforce.schema';
import { refOf } from './workforce-views';

export type RecordInput = {
  [K in RecordKind]: z.output<(typeof recordRequestSchemas)[K]>;
}[RecordKind];

interface KindRules {
  /** The read right needed for the list (medical: status for everyone with `view`). */
  read: MemberRight;
  /** The right needed to change records (with `workforce.manage`). */
  write: MemberRight;
  category: FileCategory;
  fileRequired: boolean;
  renewable: boolean;
  /** Openings are audited (US-028 FR-3, US-030 FR-3). */
  auditOpen: boolean;
}

export const KIND_RULES: Readonly<Record<RecordKind, KindRules>> = {
  training: {
    read: 'view',
    write: 'view',
    category: 'workforce_attachment',
    fileRequired: false,
    renewable: true,
    auditOpen: false,
  },
  certificate: {
    read: 'view',
    write: 'view',
    category: 'workforce_attachment',
    fileRequired: false,
    renewable: true,
    auditOpen: false,
  },
  medical: {
    read: 'view',
    write: 'personal',
    category: 'workforce_personal',
    fileRequired: false,
    renewable: false,
    auditOpen: true,
  },
  document: {
    read: 'personal',
    write: 'personal',
    category: 'workforce_personal',
    fileRequired: true,
    renewable: true,
    auditOpen: true,
  },
};

/** The stored columns of a record, from the validated fields of its kind. */
function columnsOf(kind: RecordKind, input: RecordInput) {
  const value = input as Partial<Record<string, unknown>>;
  const text = (key: string) => (typeof value[key] === 'string' ? value[key] : null);
  const number = text('number');
  return {
    type: kind === 'training' ? null : text('type'),
    name: text('name'),
    competencyId: kind === 'training' || kind === 'certificate' ? text('competencyId') : null,
    number,
    numberKey: number ? workforceKey(number) : null,
    issuer: text('issuer'),
    country: kind === 'document' ? text('country') : null,
    issuedOn: text('issuedOn'),
    expiresOn: text('expiresOn'),
    noExpiry: kind === 'certificate' ? value.noExpiry === true : false,
    reference: kind === 'training' ? text('reference') : null,
    restrictionNote: kind === 'medical' ? text('restrictionNote') : null,
    note: text('note'),
  };
}

type Columns = ReturnType<typeof columnsOf>;

function mask(number: string | null): string | null {
  return number ? `•••• ${number.slice(-4)}` : null;
}

/** US-026 – US-028, US-030: dated records with history (T-48). */
export class RecordService {
  constructor(private readonly ctx: WorkforceContext) {}

  async list(
    tenant: TenantCompany,
    access: WorkforceAccess,
    member: WorkforceMemberRow,
    kind: RecordKind,
    includeHistory: boolean,
  ): Promise<WorkforceRecordListDto> {
    assertRead(access, member.id, KIND_RULES[kind].read);
    const today = this.ctx.today(tenant);
    const rows = await this.ctx.repo.records(member.id, kind);
    const visible = rows.filter(
      (row) => includeHistory || (row.voidedAt === null && row.replacedAt === null),
    );
    const [items, replacements, files] = await Promise.all([
      this.ctx.lists.byIds(
        tenant.id,
        visible.map((row) => row.competencyId),
      ),
      this.ctx.repo.replacements(visible.map((row) => row.id)),
      this.fileNames(tenant, visible),
    ]);
    const details = kind !== 'medical' || mayRead(access, member.id, 'personal');
    const result: WorkforceRecordListDto = {
      items: visible.map((row) => {
        const dto = this.toDto(row, today, items, replacements, files);
        if (kind === 'document') return { ...dto, number: mask(row.number) };
        if (!details) {
          return {
            ...dto,
            issuer: null,
            restrictionNote: null,
            note: null,
            hasFile: false,
            fileName: null,
          };
        }
        return dto;
      }),
    };
    if (kind === 'medical') result.status = medicalStatus(rows, today);
    return result;
  }

  /** US-030 FR-1: one document with its full number (audited). */
  async detail(
    tenant: TenantCompany,
    access: WorkforceAccess,
    principal: Principal,
    member: WorkforceMemberRow,
    kind: RecordKind,
    recordId: string,
  ): Promise<WorkforceRecordDto> {
    assertRead(access, member.id, kind === 'medical' ? 'personal' : KIND_RULES[kind].read);
    const row = await this.required(tenant, member, kind, recordId);
    if (KIND_RULES[kind].auditOpen) await this.auditOpen(principal, member, row, 'detail');
    const [items, replacements, files] = await Promise.all([
      this.ctx.lists.byIds(tenant.id, [row.competencyId]),
      this.ctx.repo.replacements([row.id]),
      this.fileNames(tenant, [row]),
    ]);
    return this.toDto(row, this.ctx.today(tenant), items, replacements, files);
  }

  async create(
    tenant: TenantCompany,
    access: WorkforceAccess,
    principal: Principal,
    member: WorkforceMemberRow,
    kind: RecordKind,
    input: RecordInput,
    upload: File | null,
  ): Promise<WorkforceRecordDto> {
    assertWrite(access, member.id, KIND_RULES[kind].write);
    assertNotArchived(member);
    return this.insert(tenant, principal, member, kind, input, upload, null);
  }

  async renew(
    tenant: TenantCompany,
    access: WorkforceAccess,
    principal: Principal,
    member: WorkforceMemberRow,
    kind: RecordKind,
    recordId: string,
    input: RecordInput,
    upload: File | null,
  ): Promise<WorkforceRecordDto> {
    assertWrite(access, member.id, KIND_RULES[kind].write);
    assertNotArchived(member);
    if (!KIND_RULES[kind].renewable) throw new NotFoundError();
    const previous = await this.required(tenant, member, kind, recordId);
    if (previous.voidedAt || previous.replacedAt) throw new RecordVoidedError();
    return this.insert(tenant, principal, member, kind, input, upload, previous);
  }

  /** Edit: the whole form again; the copy is replaced, kept or (not for documents) removed. */
  async update(
    tenant: TenantCompany,
    access: WorkforceAccess,
    principal: Principal,
    member: WorkforceMemberRow,
    kind: RecordKind,
    recordId: string,
    input: RecordInput,
    upload: File | null,
    removeFile: boolean,
  ): Promise<WorkforceRecordDto> {
    assertWrite(access, member.id, KIND_RULES[kind].write);
    assertNotArchived(member);
    const current = await this.required(tenant, member, kind, recordId);
    if (current.voidedAt || current.replacedAt) throw new RecordVoidedError();
    const columns = columnsOf(kind, input);
    await this.check(tenant, kind, columns, [current.id], current);
    if (removeFile && KIND_RULES[kind].fileRequired && !upload) {
      throw new ValidationError([{ path: 'file', message: 'required' }]);
    }
    const work = new UnitOfWork(this.ctx.db);
    let fileId = current.fileId;
    if (upload) {
      const stored = await this.store(tenant, principal, kind, upload);
      work.add(stored.statement);
      if (current.fileId) work.add(this.ctx.files.remove(current.fileId, principal.userId));
      fileId = stored.row.id;
    } else if (removeFile && current.fileId) {
      work.add(this.ctx.files.remove(current.fileId, principal.userId));
      fileId = null;
    }
    const before = { ...pickColumns(current), fileId: current.fileId };
    const after = { ...columns, fileId };
    const changes = changedFields(before, after);
    if (!changes) return this.detailOf(tenant, member, kind, current.id);
    work.add(
      this.ctx.db
        .update(workforceRecord)
        .set({ ...after, updatedAt: new Date(this.ctx.now()), updatedBy: principal.userId })
        .where(eq(workforceRecord.id, current.id)),
      ...this.entries(principal, member, kind, 'updated', current.id, columns, {
        oldValue: before,
        newValue: after,
        changes: sensitiveSafe(kind, changes),
      }),
    );
    await work.commit();
    return this.detailOf(tenant, member, kind, current.id);
  }

  async void(
    tenant: TenantCompany,
    access: WorkforceAccess,
    principal: Principal,
    member: WorkforceMemberRow,
    kind: RecordKind,
    recordId: string,
    reason: string,
  ): Promise<void> {
    assertWrite(access, member.id, KIND_RULES[kind].write);
    assertNotArchived(member);
    const current = await this.required(tenant, member, kind, recordId);
    if (current.voidedAt || current.replacedAt) throw new RecordVoidedError();
    const now = new Date(this.ctx.now());
    await new UnitOfWork(this.ctx.db)
      .add(
        this.ctx.db
          .update(workforceRecord)
          .set({
            voidedAt: now,
            voidedBy: principal.userId,
            voidReason: reason,
            updatedAt: now,
            updatedBy: principal.userId,
          })
          .where(eq(workforceRecord.id, current.id)),
        ...this.entries(principal, member, kind, 'voided', current.id, pickColumns(current), {
          newValue: { reason },
        }),
      )
      .commit();
  }

  /** The stored copy, for readers allowed to see it; personal copies are audited. */
  async openFile(
    tenant: TenantCompany,
    access: WorkforceAccess,
    principal: Principal,
    member: WorkforceMemberRow,
    kind: RecordKind,
    recordId: string,
  ): Promise<OpenedFile | null> {
    const right: MemberRight = kind === 'medical' ? 'personal' : KIND_RULES[kind].read;
    if (!mayRead(access, member.id, right)) return null;
    const row = await this.ctx.repo.findRecord(tenant.id, member.id, kind, recordId);
    if (!row?.fileId) return null;
    const opened = await this.ctx.files.open(row.fileId, tenant.id);
    if (opened && KIND_RULES[kind].auditOpen) await this.auditOpen(principal, member, row, 'file');
    return opened;
  }

  private async insert(
    tenant: TenantCompany,
    principal: Principal,
    member: WorkforceMemberRow,
    kind: RecordKind,
    input: RecordInput,
    upload: File | null,
    previous: WorkforceRecordRow | null,
  ): Promise<WorkforceRecordDto> {
    const columns = columnsOf(kind, input);
    await this.check(tenant, kind, columns, previous ? [previous.id] : [], null);
    if (KIND_RULES[kind].fileRequired && !upload) {
      throw new ValidationError([{ path: 'file', message: 'required' }]);
    }
    const work = new UnitOfWork(this.ctx.db);
    let fileId: string | null = null;
    if (upload) {
      const stored = await this.store(tenant, principal, kind, upload);
      work.add(stored.statement);
      fileId = stored.row.id;
    }
    const id = generateId();
    const now = new Date(this.ctx.now());
    work.add(
      this.ctx.db.insert(workforceRecord).values({
        id,
        companyId: tenant.id,
        workforceMemberId: member.id,
        kind,
        ...columns,
        fileId,
        replacesId: previous?.id ?? null,
        createdAt: now,
        createdBy: principal.userId,
        updatedAt: now,
        updatedBy: principal.userId,
      }),
    );
    if (previous) {
      work.add(
        this.ctx.db
          .update(workforceRecord)
          .set({ replacedAt: now, updatedAt: now, updatedBy: principal.userId })
          .where(eq(workforceRecord.id, previous.id)),
        ...this.entries(principal, member, kind, 'renewed', id, columns, {
          oldValue: { recordId: previous.id },
          newValue: { recordId: id, ...auditColumns(columns) },
        }),
      );
    } else {
      work.add(
        ...this.entries(principal, member, kind, 'created', id, columns, {
          newValue: auditColumns(columns),
        }),
      );
    }
    await work.commit();
    return this.detailOf(tenant, member, kind, id);
  }

  /** Rules that need the database or the company's calendar. */
  private async check(
    tenant: TenantCompany,
    kind: RecordKind,
    columns: Columns,
    exceptIds: string[],
    current: WorkforceRecordRow | null,
  ): Promise<void> {
    const today = this.ctx.today(tenant);
    if (columns.issuedOn && columns.issuedOn > today) {
      throw new ValidationError([{ path: 'issuedOn', message: 'dateInFuture' }]);
    }
    if (columns.competencyId) {
      await this.ctx.lists.requireUsable(
        tenant.id,
        'competency',
        columns.competencyId,
        current?.competencyId ?? null,
      );
    }
    if (kind === 'document' && columns.numberKey && columns.type) {
      const other = await this.ctx.repo.sameDocumentNumber(
        tenant.id,
        columns.type,
        columns.country,
        columns.numberKey,
        exceptIds,
      );
      if (other) {
        const owner = await this.ctx.repo.findMember(tenant.id, other.workforceMemberId);
        throw new DocumentNumberTakenError(owner?.fullName ?? '');
      }
    }
  }

  private store(tenant: TenantCompany, principal: Principal, kind: RecordKind, upload: File) {
    return this.ctx.files.store({
      companyId: tenant.id,
      category: KIND_RULES[kind].category,
      uploadedBy: principal.userId,
      file: upload,
      beforeWrite: this.ctx.storageCheck(tenant.id),
    });
  }

  private async auditOpen(
    principal: Principal,
    member: WorkforceMemberRow,
    row: WorkforceRecordRow,
    what: 'detail' | 'file',
  ): Promise<void> {
    await this.ctx.audit.record({
      action: `workforce.${row.kind}.opened` as AuditAction,
      actorUserId: principal.userId,
      companyId: member.companyId,
      entityType: 'workforce_record',
      entityId: row.id,
      newValue: { memberId: member.id, what, type: row.type },
    });
  }

  private entries(
    principal: Principal,
    member: WorkforceMemberRow,
    kind: RecordKind,
    verb: 'created' | 'updated' | 'renewed' | 'voided',
    recordId: string,
    columns: Pick<Columns, 'type' | 'name'>,
    values: {
      oldValue?: Record<string, unknown>;
      newValue?: Record<string, unknown>;
      changes?: { before: Record<string, unknown>; after: Record<string, unknown> } | null;
    },
  ): Statement[] {
    return this.ctx.record(principal, member, {
      audit: `workforce.${kind}.${verb}` as AuditAction,
      activity: `workforce.record.${verb}`,
      entityType: 'workforce_record',
      entityId: recordId,
      oldValue: values.oldValue ?? null,
      newValue: values.newValue ?? null,
      changes: values.changes ?? null,
      snapshot: { recordKind: kind, recordType: columns.type, recordName: columns.name },
    });
  }

  private async required(
    tenant: TenantCompany,
    member: WorkforceMemberRow,
    kind: RecordKind,
    recordId: string,
  ): Promise<WorkforceRecordRow> {
    const row = await this.ctx.repo.findRecord(tenant.id, member.id, kind, recordId);
    if (!row) throw new NotFoundError();
    return row;
  }

  private async detailOf(
    tenant: TenantCompany,
    member: WorkforceMemberRow,
    kind: RecordKind,
    recordId: string,
  ): Promise<WorkforceRecordDto> {
    const row = await this.required(tenant, member, kind, recordId);
    const [items, replacements, files] = await Promise.all([
      this.ctx.lists.byIds(tenant.id, [row.competencyId]),
      this.ctx.repo.replacements([row.id]),
      this.fileNames(tenant, [row]),
    ]);
    return this.toDto(row, this.ctx.today(tenant), items, replacements, files);
  }

  private async fileNames(
    tenant: TenantCompany,
    rows: readonly WorkforceRecordRow[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const row of rows) {
      if (!row.fileId) continue;
      const file = await this.ctx.files.find(row.fileId, tenant.id);
      if (file) result.set(row.fileId, file.fileName);
    }
    return result;
  }

  private toDto(
    row: WorkforceRecordRow,
    today: string,
    items: Awaited<ReturnType<WorkforceContext['lists']['byIds']>>,
    replacements: Map<string, string>,
    files: Map<string, string>,
  ): WorkforceRecordDto {
    return {
      id: row.id,
      kind: row.kind,
      type: row.type,
      name: row.name,
      competency: refOf(items, row.competencyId),
      number: row.number,
      issuer: row.issuer,
      country: row.country,
      issuedOn: row.issuedOn,
      expiresOn: row.expiresOn,
      noExpiry: row.noExpiry,
      expiryState: expiryState(row.expiresOn, today),
      reference: row.reference,
      restrictionNote: row.restrictionNote,
      note: row.note,
      hasFile: row.fileId !== null,
      fileName: row.fileId ? (files.get(row.fileId) ?? null) : null,
      state: row.voidedAt ? 'voided' : row.replacedAt ? 'replaced' : 'current',
      replacesId: row.replacesId,
      replacedById: replacements.get(row.id) ?? null,
      voidReason: row.voidReason,
      createdAt: row.createdAt.getTime(),
    };
  }
}

function pickColumns(row: WorkforceRecordRow): Columns {
  return {
    type: row.type,
    name: row.name,
    competencyId: row.competencyId,
    number: row.number,
    numberKey: row.numberKey,
    issuer: row.issuer,
    country: row.country,
    issuedOn: row.issuedOn,
    expiresOn: row.expiresOn,
    noExpiry: row.noExpiry,
    reference: row.reference,
    restrictionNote: row.restrictionNote,
    note: row.note,
  };
}

/** Audit values without the derived key. */
function auditColumns(columns: Columns): Record<string, unknown> {
  const { numberKey: _key, ...rest } = columns;
  return rest;
}

/**
 * T-56: timeline changes of personal records never carry the number or the medical note
 * (History is filtered by permission, but the values stay out of it anyway).
 */
function sensitiveSafe(
  kind: RecordKind,
  changes: { before: Record<string, unknown>; after: Record<string, unknown> } | null,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  if (!changes) return null;
  const hidden =
    kind === 'document' || kind === 'medical'
      ? ['number', 'numberKey', 'restrictionNote', 'note', 'fileId']
      : ['numberKey', 'fileId'];
  const strip = (values: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(values).filter(([key]) => !hidden.includes(key)));
  return { before: strip(changes.before), after: strip(changes.after) };
}
