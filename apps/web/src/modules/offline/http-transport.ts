import {
  CAPTURED_AT_HEADER,
  DEVICE_ID_HEADER,
  ErrorCode,
  IDEMPOTENCY_KEY_HEADER,
  isApiFailure,
} from '@hse/shared';

import { publicEnv } from '@/config/public-env';
import { refreshAccessToken, syncAccessToken } from '@/modules/auth/auth-session';

import type { BlobRow, OutboxItem } from './device-store';
import type { SendOutcome, SyncTransport } from './sync-engine';

/**
 * The sync engine's HTTP side (PLT-28 FR-4): the item's request with its fixed
 * `Idempotency-Key`, the capture time and the device id; one token refresh on `401`.
 */
export function httpTransport(deviceId: string): SyncTransport {
  return {
    async send(item: OutboxItem, blob: BlobRow | undefined): Promise<SendOutcome> {
      let token: string | null;
      try {
        token = await syncAccessToken();
      } catch {
        return { kind: 'network' };
      }
      if (!token) return { kind: 'http', status: 401, code: ErrorCode.UNAUTHENTICATED };

      let response: Response;
      try {
        response = await request(item, blob, token, deviceId);
        if (response.status === 401) {
          if (!(await refreshAccessToken())) {
            return { kind: 'http', status: 401, code: ErrorCode.SESSION_EXPIRED };
          }
          const fresh = await syncAccessToken();
          if (!fresh) return { kind: 'http', status: 401, code: ErrorCode.SESSION_EXPIRED };
          response = await request(item, blob, fresh, deviceId);
        }
      } catch {
        return { kind: 'network' };
      }

      const payload: unknown = await response.json().catch(() => null);
      if (response.ok) {
        const data = (payload as { data?: unknown } | null)?.data ?? null;
        return { kind: 'ok', status: response.status, data };
      }
      if (isApiFailure(payload)) {
        return {
          kind: 'http',
          status: response.status,
          code: payload.error.code,
          ...(payload.error.params ? { params: payload.error.params } : {}),
        };
      }
      return { kind: 'http', status: response.status, code: ErrorCode.INTERNAL_ERROR };
    },
  };
}

function request(
  item: OutboxItem,
  blob: BlobRow | undefined,
  token: string,
  deviceId: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
    [IDEMPOTENCY_KEY_HEADER]: item.idempotencyKey,
    [CAPTURED_AT_HEADER]: new Date(item.capturedAt).toISOString(),
    [DEVICE_ID_HEADER]: deviceId,
  };
  let body: BodyInit | null = null;
  if (item.kind === 'upload') {
    const form = new FormData();
    for (const [name, value] of Object.entries(item.request.body ?? {})) form.append(name, String(value));
    if (blob) {
      form.append(
        item.request.fileField ?? 'file',
        new File([blob.bytes], blob.name, { type: blob.type }),
      );
    }
    body = form;
  } else {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(item.request.body ?? {});
  }
  return fetch(`${publicEnv.apiBaseUrl}${item.request.path}`, {
    method: item.request.method,
    headers,
    credentials: 'same-origin',
    body,
  });
}
