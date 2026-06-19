// Tests for Goal C-a — verifyAndAwaitDecision() approval-resume polling.
// Pure client logic: fetch is mocked, no gateway/DB needed.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Palveron, type ApprovalStatusResponse } from './index';

// ─── fetch mock helpers ─────────────────────────────────────

interface MockResponse {
  ok: boolean;
  status: number;
  headers: { get: (k: string) => string | null };
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function mockResponse(status: number, body: unknown): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const VERIFY_PENDING = mockResponse(202, { decision: 'PENDING_APPROVAL', trace_id: 'tr_1' });

function status(eff: ApprovalStatusResponse['effective_status'], extra: Partial<ApprovalStatusResponse> = {}) {
  return mockResponse(200, {
    trace_id: 'tr_1',
    approval_id: 'ap_1',
    status: eff === 'APPROVED' ? 'APPROVED' : eff === 'PENDING' ? 'PENDING' : 'DENIED',
    effective_status: eff,
    decided_by: null,
    decided_at: null,
    decision_trace_id: null,
    anchor_status: null,
    expires_at: null,
    expired_derived: false,
    auto_expired: false,
    ...extra,
  });
}

/**
 * Install a fetch mock: a fixed verify POST response + a queue of status GET
 * responses (the last one repeats once the queue drains, for cap tests).
 */
function installFetch(verifyRes: MockResponse, statusQueue: MockResponse[]): ReturnType<typeof vi.fn> {
  let i = 0;
  const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'POST' && url.includes('/api/v1/verify')) return verifyRes;
    if (url.includes('/api/v1/approvals/status')) {
      const r = statusQueue[Math.min(i, statusQueue.length - 1)];
      i += 1;
      return r;
    }
    return mockResponse(500, { error: 'unexpected url ' + url });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function client(over: Record<string, unknown> = {}) {
  return new Palveron({
    apiKey: 'pv_test_abc',
    approvalPollIntervalMs: 1,
    approvalPollTimeoutMs: 1000,
    ...over,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────

describe('verifyAndAwaitDecision', () => {
  it('does NOT poll when verify is not held (returns verbatim)', async () => {
    const fetchMock = installFetch(mockResponse(200, { decision: 'PASSED', trace_id: 'tr_x' }), [
      status('PENDING'),
    ]);
    const res = await client().verifyAndAwaitDecision({ prompt: 'hi' });
    expect(res.decision).toBe('PASSED');
    // Only the verify POST — no status GET.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('PENDING → APPROVED after N polls → PASSED with decisionTraceId', async () => {
    installFetch(VERIFY_PENDING, [
      status('PENDING'),
      status('PENDING'),
      status('APPROVED', { decided_by: 'alice@acme.com', decision_trace_id: 'dt_9' }),
    ]);
    const res = await client().verifyAndAwaitDecision({ prompt: 'rm -rf /' });
    expect(res.decision).toBe('PASSED');
    expect(res.reason).toContain('alice@acme.com');
    expect(res.decisionTraceId).toBe('dt_9');
    expect(res.traceId).toBe('tr_1'); // original held trace preserved
  });

  it('PENDING → DENIED → BLOCKED', async () => {
    installFetch(VERIFY_PENDING, [
      status('PENDING'),
      status('DENIED', { decided_by: 'bob@acme.com', decision_trace_id: 'dt_d' }),
    ]);
    const res = await client().verifyAndAwaitDecision({ prompt: 'x' });
    expect(res.decision).toBe('BLOCKED');
    expect(res.reason).toContain('bob@acme.com');
    expect(res.decisionTraceId).toBe('dt_d');
  });

  it('PENDING → auto_expired (DENIED+auto) → BLOCKED labelled as expired', async () => {
    installFetch(VERIFY_PENDING, [
      status('DENIED', { auto_expired: true, decided_by: 'system' }),
    ]);
    const res = await client().verifyAndAwaitDecision({ prompt: 'x' });
    expect(res.decision).toBe('BLOCKED');
    expect(res.reason).toMatch(/expired|timed out/i);
  });

  it('PENDING → EXPIRED → BLOCKED', async () => {
    installFetch(VERIFY_PENDING, [status('EXPIRED')]);
    const res = await client().verifyAndAwaitDecision({ prompt: 'x' });
    expect(res.decision).toBe('BLOCKED');
    expect(res.reason).toMatch(/expired/i);
  });

  it('poll cap reached while still PENDING → fail-closed BLOCKED', async () => {
    installFetch(VERIFY_PENDING, [status('PENDING')]); // always pending
    const res = await client({ approvalPollIntervalMs: 10, approvalPollTimeoutMs: 35 })
      .verifyAndAwaitDecision({ prompt: 'x' });
    expect(res.decision).toBe('BLOCKED');
    expect(res.reason).toMatch(/timed out/i);
  });

  it('status endpoint repeatedly errors (404) → keep polling → BLOCKED at cap', async () => {
    installFetch(VERIFY_PENDING, [mockResponse(404, { error: 'Approval not found' })]);
    const res = await client({ approvalPollIntervalMs: 10, approvalPollTimeoutMs: 35 })
      .verifyAndAwaitDecision({ prompt: 'x' });
    expect(res.decision).toBe('BLOCKED');
  });

  it('AbortSignal mid-poll → BLOCKED (aborted), stops waiting', async () => {
    installFetch(VERIFY_PENDING, [status('PENDING')]);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);
    const res = await client({ approvalPollIntervalMs: 40, approvalPollTimeoutMs: 5000 })
      .verifyAndAwaitDecision({ prompt: 'x' }, { signal: controller.signal });
    expect(res.decision).toBe('BLOCKED');
    expect(res.reason).toMatch(/abort/i);
  });
});
