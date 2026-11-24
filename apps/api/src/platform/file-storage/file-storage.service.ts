import { generateId } from '@hse/shared';
import { and, eq, inArray, isNotNull, isNull, lte, notInArray, sum } from 'drizzle-orm';

import { sha256Hex } from '../../core/security/secure-token';
import type { Database } from '../../database/client';
import type { Statement } from '../../database/unit-of-work';
import { FILE_CATEGORIES, type FileCategory, QUOTA_EXEMPT_CATEGORIES } from './file-categories';
import { FileEmptyError, FileTooLargeError, FileTypeNotAllowedError } from './file.errors';
import { file, type FileRow } from './file.schema';
import { cleanFileName, detectFileType } from './file-type';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Soft-deleted files keep their bytes this long before housekeeping removes them (PLT-07 FR-1). */
export const DELETED_FILE_RETENTION_MS = 30 * DAY_MS;

export interface StoreFileInput {
  companyId: string | null;
  category: FileCategory;
  uploadedBy: string;
  file: File;
  /**
   * Runs after the size and type checks and before anything is written, e.g. the plan's
   * storage quota (PLT-12 FR-5). Throw to refuse the upload.
   */
  beforeWrite?: (sizeBytes: number) => Promise<void>;
}

export interface StoredFile {
  row: FileRow;
  /** Add to the caller's UnitOfWork: the metadata exists only if the business change succeeds. */
  statement: Statement;
}

export interface OpenedFile {
  row: FileRow;
  body: ReadableStream;
  etag: string;
}

/**
 * The one upload service (Master Rules §5, PLT-07, T-18). Checks size and the real type,
 * writes the bytes to R2 under a generated key and returns the metadata insert for the
 * caller to commit. Files are never public in R2; they are served through the API.
 */
export class FileStorageService {
  constructor(
    private readonly db: Database,
    private readonly bucket: R2Bucket,
    private readonly clock: () => number = Date.now,
  ) {}

  async store(input: StoreFileInput): Promise<StoredFile> {
    const rules = FILE_CATEGORIES[input.category];
    if (input.file.size === 0) throw new FileEmptyError();
    if (input.file.size > rules.maxBytes) throw new FileTooLargeError(rules.maxBytes);

    const bytes = new Uint8Array(await input.file.arrayBuffer());
    if (bytes.byteLength === 0) throw new FileEmptyError();
    if (bytes.byteLength > rules.maxBytes) throw new FileTooLargeError(rules.maxBytes);

    const contentType = detectFileType(bytes.subarray(0, 16));
    if (!contentType || !(rules.contentTypes as readonly string[]).includes(contentType)) {
      throw new FileTypeNotAllowedError(rules.contentTypes);
    }

    await input.beforeWrite?.(bytes.byteLength);

    const id = generateId();
    const owner = input.companyId ? `companies/${input.companyId}` : 'platform';
    const storageKey = `${owner}/${input.category}/${id}`;
    const checksum = await sha256Hex(bytes);
    const now = new Date(this.clock());

    await this.bucket.put(storageKey, bytes, {
      httpMetadata: { contentType },
      sha256: checksum,
    });

    const row: FileRow = {
      id,
      companyId: input.companyId,
      category: input.category,
      storageKey,
      fileName: cleanFileName(input.file.name, contentType),
      contentType,
      sizeBytes: bytes.byteLength,
      checksum,
      createdAt: now,
      createdBy: input.uploadedBy,
      updatedAt: now,
      updatedBy: input.uploadedBy,
      deletedAt: null,
      deletedBy: null,
    };
    return { row, statement: this.db.insert(file).values(row) };
  }

  /**
   * Opens a file of the given company (FR-7: the tenant is checked before anything else).
   * Returns null for unknown, deleted or foreign files, so callers answer 404.
   */
  async open(fileId: string, companyId: string | null): Promise<OpenedFile | null> {
    const row = await this.find(fileId, companyId);
    if (!row) return null;
    const object = await this.bucket.get(row.storageKey);
    if (!object) return null;
    return { row, body: object.body, etag: `"${row.checksum}"` };
  }

  async find(fileId: string, companyId: string | null): Promise<FileRow | undefined> {
    return this.db
      .select()
      .from(file)
      .where(
        and(
          eq(file.id, fileId),
          companyId === null ? isNull(file.companyId) : eq(file.companyId, companyId),
          isNull(file.deletedAt),
        ),
      )
      .get();
  }

  /** Soft delete; the bytes are removed by `purgeDeletedFiles` after the retention period. */
  remove(fileId: string, actorId: string | null): Statement {
    const now = new Date(this.clock());
    return this.db
      .update(file)
      .set({ deletedAt: now, deletedBy: actorId, updatedAt: now, updatedBy: actorId })
      .where(and(eq(file.id, fileId), isNull(file.deletedAt)));
  }

  /**
   * Bytes stored by a company against its plan (T-19, PLT-12): deleted files and receipts
   * (PLT-13 FR-3) excluded.
   */
  async usedBytes(companyId: string): Promise<number> {
    const row = await this.db
      .select({ total: sum(file.sizeBytes) })
      .from(file)
      .where(
        and(
          eq(file.companyId, companyId),
          isNull(file.deletedAt),
          notInArray(file.category, [...QUOTA_EXEMPT_CATEGORIES]),
        ),
      )
      .get();
    return Number(row?.total ?? 0);
  }

  /**
   * Removes the bytes and the metadata of files deleted longer ago than the retention period.
   * The audit log keeps the record that the file existed.
   */
  async purgeDeletedFiles(): Promise<number> {
    const cutoff = new Date(this.clock() - DELETED_FILE_RETENTION_MS);
    const rows = await this.db
      .select({ id: file.id, storageKey: file.storageKey })
      .from(file)
      .where(and(isNotNull(file.deletedAt), lte(file.deletedAt, cutoff)))
      .limit(500)
      .all();
    if (rows.length === 0) return 0;
    await this.bucket.delete(rows.map((row) => row.storageKey));
    await this.db
      .delete(file)
      .where(
        inArray(
          file.id,
          rows.map((row) => row.id),
        ),
      )
      .run();
    return rows.length;
  }
}
