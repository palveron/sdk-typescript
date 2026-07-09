// Tests for Goal B1d — tolerance of BOTH gateway error-body shapes.
//
// The gateway error contract moved from a flat `{ error: "<msg>" }` string to a
// structured `{ error: { code, message, request_id } }` object (B1a+). The SDK
// must surface a real message either way — never `[object Object]`, never empty.
// Pure client logic: fetch is mocked, no gateway/DB needed.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Palveron, PalveronError, PalveronValidationError } from './index';

interface MockResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get: (k: string) => string | null };
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function mockResponse(status: number, body: unknown, requestId = 'req-xyz'): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `Status ${status}`,
    headers: { get: (k: string) => (k.toLowerCase() === 'x-request-id' ? requestId : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function stubFetchOnce(res: MockResponse) {
  vi.stubGlobal('fetch', vi.fn(async () => res));
}

function client() {
  return new Palveron({ apiKey: 'pv_live_abc', maxRetries: 0 });
}

afterEach(() => vi.unstubAllGlobals());

describe('B1d — error-body shape tolerance', () => {
  it('400 NEW object-shape → PalveronValidationError with a String message (not [object Object])', async () => {
    stubFetchOnce(
      mockResponse(400, { error: { code: 'validation_error', message: 'Prompt is required', request_id: 'req-1' } }),
    );
    const err = await client().verify({ prompt: 'hi' }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(PalveronValidationError);
    expect(typeof err.message).toBe('string');
    expect(err.message).not.toBe('[object Object]');
    expect(err.message).toBe('Prompt is required');
  });

  it('400 LEGACY flat-string error → message preserved (backward compatible)', async () => {
    stubFetchOnce(mockResponse(400, { error: 'Old flat message' }));
    const err = await client().verify({ prompt: 'hi' }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(PalveronValidationError);
    expect(err.message).toBe('Old flat message');
  });

  it('4xx NEW object-shape → PalveronError.message is a String + serverCode carries the taxonomy code', async () => {
    stubFetchOnce(
      mockResponse(409, { error: { code: 'conflict', message: 'Already exists', request_id: 'req-2' } }),
    );
    const err = await client().verify({ prompt: 'hi' }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(PalveronError);
    expect(typeof err.message).toBe('string');
    expect(err.message).toBe('Already exists');
    expect(err.serverCode).toBe('conflict');
  });

  it('4xx with an unparseable / empty body → SDK default (never [object Object])', async () => {
    const res: MockResponse = {
      ok: false,
      status: 409,
      statusText: 'Conflict',
      headers: { get: () => null },
      json: async () => {
        throw new Error('not json');
      },
      text: async () => '',
    };
    stubFetchOnce(res);
    const err = await client().verify({ prompt: 'hi' }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(PalveronError);
    expect(err.message).toBe('HTTP 409');
    expect(err.serverCode).toBeNull();
  });

  it('400 malformed object (no usable message) → SDK default, never an object', async () => {
    stubFetchOnce(mockResponse(400, { error: { code: 123 } }));
    const err = await client().verify({ prompt: 'hi' }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(PalveronValidationError);
    expect(err.message).toBe('Invalid request');
  });
});
