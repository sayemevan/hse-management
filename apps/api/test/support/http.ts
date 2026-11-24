import type { ApiFailure, LoginResponseDto, ResponseMeta } from '@hse/shared';

import { createApp } from '../../src/app';
import type { Bindings } from '../../src/core/context/app-context';

/** Either envelope, flattened so tests can assert on success and failure fields alike. */
export interface TestBody<TData> {
  success: boolean;
  message: string;
  data: TData;
  meta?: ResponseMeta;
  error: ApiFailure['error'];
}

export interface ApiResult<TData = unknown> {
  status: number;
  body: TestBody<TData>;
  headers: Headers;
  setCookie: string | null;
}

interface CallOptions {
  body?: unknown;
  token?: string | null;
  /** Send an Origin header matching the host (browsers always do for POST). */
  origin?: string | false;
  userAgent?: string;
  ip?: string;
}

/**
 * A browser-like client for one host: it keeps the refresh cookie between calls and sends
 * the host via x-forwarded-host (trusted in the test configuration).
 */
export class TestClient {
  private readonly app = createApp();
  cookie: string | null = null;
  accessToken: string | null = null;

  constructor(
    private readonly env: Bindings,
    readonly host: string,
  ) {}

  async call<TData = unknown>(
    method: string,
    path: string,
    options: CallOptions = {},
  ): Promise<ApiResult<TData>> {
    const headers = new Headers({ 'x-forwarded-host': this.host });
    if (options.origin !== false) headers.set('origin', options.origin ?? `http://${this.host}`);
    if (this.cookie) headers.set('cookie', this.cookie);
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    const token = options.token === undefined ? this.accessToken : options.token;
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (options.userAgent) headers.set('user-agent', options.userAgent);
    if (options.ip) headers.set('cf-connecting-ip', options.ip);

    const response = await this.app.request(
      `/api/v1${path}`,
      {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      },
      this.env,
    );

    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const pair = setCookie.split(';')[0] ?? '';
      this.cookie = /max-age=0/i.test(setCookie) || pair.endsWith('=') ? null : pair;
    }
    return {
      status: response.status,
      body: (response.status === 204 ? {} : await response.json()) as TestBody<TData>,
      headers: response.headers,
      setCookie,
    };
  }

  /** Raw request (multipart uploads, binary downloads). Sends the token and host like `call`. */
  async raw(
    method: string,
    path: string,
    init: { body?: BodyInit; headers?: Record<string, string>; token?: string | null } = {},
  ): Promise<Response> {
    const headers = new Headers({ 'x-forwarded-host': this.host, origin: `http://${this.host}` });
    for (const [name, value] of Object.entries(init.headers ?? {})) headers.set(name, value);
    const token = init.token === undefined ? this.accessToken : init.token;
    if (token) headers.set('authorization', `Bearer ${token}`);
    return this.app.request(
      `/api/v1${path}`,
      { method, headers, ...(init.body === undefined ? {} : { body: init.body }) },
      this.env,
    );
  }

  async login(
    email: string,
    password: string,
    options: CallOptions = {},
  ): Promise<ApiResult<LoginResponseDto>> {
    const result = await this.call<LoginResponseDto>('POST', '/auth/login', {
      ...options,
      body: { email, password },
      token: null,
    });
    if (result.status === 200) this.accessToken = result.body.data.accessToken;
    return result;
  }
}
