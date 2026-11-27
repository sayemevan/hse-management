import {
  acceptedCaptureTime,
  CAPTURED_AT_HEADER,
  DEVICE_ID_HEADER,
  IDEMPOTENCY_KEY_HEADER,
} from '@hse/shared';
import type { Context } from 'hono';

import type { AppEnv } from '../../core/context/app-context';

/** O-129, O-130: what the sync engine says about an offline change. */
export interface OfflineMeta {
  offline: true;
  capturedAt: number;
  receivedAt: number;
  /** The device sent a capture time more than a day ahead; the receive time is used. */
  clockAdjusted: boolean;
  deviceId: string | null;
  idempotencyKey: string | null;
}

const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * The offline facts of a request, or `null` for an ordinary online request. A request is
 * offline when it carries `X-Captured-At` (the sync engine always sends it).
 */
export function offlineMetaOf(c: Context<AppEnv>, receivedAt: number): OfflineMeta | null {
  const header = c.req.header(CAPTURED_AT_HEADER);
  if (header === undefined) return null;
  const parsed = Date.parse(header);
  const sent = Number.isNaN(parsed) ? null : parsed;
  const capturedAt = acceptedCaptureTime(sent, receivedAt);
  const device = c.req.header(DEVICE_ID_HEADER);
  return {
    offline: true,
    capturedAt,
    receivedAt,
    clockAdjusted: sent !== null && capturedAt !== sent,
    deviceId: device && DEVICE_ID.test(device) ? device : null,
    idempotencyKey: c.req.header(IDEMPOTENCY_KEY_HEADER) ?? null,
  };
}

/** For audit `newValue`: `{ offline: { … } }` or nothing (O-130). */
export function offlineAudit(meta: OfflineMeta | null): Record<string, unknown> {
  if (!meta) return {};
  return {
    offline: {
      capturedAt: meta.capturedAt,
      deviceId: meta.deviceId,
      idempotencyKey: meta.idempotencyKey,
      ...(meta.clockAdjusted ? { clockAdjusted: true } : {}),
    },
  };
}
