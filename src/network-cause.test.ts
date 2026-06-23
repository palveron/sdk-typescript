// Tests for the NETWORK_ERROR cause-preservation fix.
// A transport failure surfaces as a generic PalveronError(NETWORK_ERROR), but
// the ORIGINAL error (whose own `.cause` carries the real undici reason —
// UNABLE_TO_VERIFY_LEAF_SIGNATURE, ECONNREFUSED, …) must remain reachable via
// the standard `Error.cause` so adapters can diagnose the true failure.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Palveron, PalveronError } from './index';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A `TypeError: fetch failed` whose own `.cause` is the real low-level reason. */
function fetchFailure(causeCode: string): TypeError {
  const undiciCause = Object.assign(new Error(`tls: ${causeCode}`), { code: causeCode });
  return new TypeError('fetch failed', { cause: undiciCause });
}

function client() {
  return new Palveron({ apiKey: 'pv_live_abc', maxRetries: 0 });
}

describe('NETWORK_ERROR preserves the original error cause', () => {
  it('exposes the TLS-trust reason via PalveronError.cause.cause', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw fetchFailure('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
    }));

    let caught: unknown;
    try {
      await client().health();
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(PalveronError);
    const err = caught as PalveronError;
    expect(err.code).toBe('NETWORK_ERROR');
    // The surface masks the reason; the original TypeError is the cause …
    expect(err.cause).toBeInstanceOf(TypeError);
    // … and the REAL undici reason hangs off the TypeError's own cause.
    const root = (err.cause as { cause?: { code?: string } }).cause;
    expect(root?.code).toBe('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
  });

  it('preserves a generic connect failure cause too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw fetchFailure('ECONNREFUSED');
    }));

    let caught: unknown;
    try {
      await client().health();
    } catch (e) {
      caught = e;
    }
    const err = caught as PalveronError;
    expect(err.code).toBe('NETWORK_ERROR');
    const root = (err.cause as { cause?: { code?: string } }).cause;
    expect(root?.code).toBe('ECONNREFUSED');
  });
});
