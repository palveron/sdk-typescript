// ============================================================
// @palveron/sdk — Official TypeScript SDK for Palveron AI Governance
// ============================================================
// Zero dependencies. Works in Node.js 18+, Deno, Bun, Edge Runtimes.
// ============================================================

// ─── Types ──────────────────────────────────────────────────

/**
 * Governance decision returned by `/api/v1/verify`.
 *
 * The gateway emits `PASSED` (Sprint 73+); `ALLOWED` is preserved as an
 * alias for older deployments. `RATE_LIMITED` is synthesised client-side
 * when the gateway returns 429 — it lets callers branch on `decision`
 * uniformly instead of catching an exception just for rate limits.
 *
 * HTTP status code mapping (Sprint 87):
 *   PASSED / ALLOWED / MODIFIED / FLAGGED / POLICY_CHANGE → 200 OK
 *   PENDING_APPROVAL                                      → 202 Accepted
 *   BLOCKED                                               → 403 Forbidden
 *   RATE_LIMITED                                          → 429 Too Many Requests
 *   ERROR                                                 → transport/internal failure
 */
export type Decision =
  | 'PASSED'
  | 'ALLOWED'
  | 'BLOCKED'
  | 'MODIFIED'
  | 'FLAGGED'
  | 'PENDING_APPROVAL'
  | 'POLICY_CHANGE'
  | 'RATE_LIMITED'
  | 'ERROR';
export type RiskLevel = 'minimal' | 'limited' | 'high' | 'unacceptable';
export type Sensitivity = 'low' | 'medium' | 'high';

export interface PalveronConfig {
  /** API key (starts with pv_live_) */
  apiKey: string;
  /** Gateway base URL (default: https://gateway.palveron.com) */
  baseUrl?: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** Max retry attempts on transient failures (default: 3) */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms (default: 500) */
  retryBaseDelay?: number;
  /** Custom logger (default: console) */
  logger?: PalveronLogger;
  /** Custom headers added to every request */
  headers?: Record<string, string>;
  /** Circuit breaker: max consecutive failures before opening (default: 5) */
  circuitBreakerThreshold?: number;
  /** Circuit breaker: cooldown in ms before half-open retry (default: 30000) */
  circuitBreakerCooldown?: number;
  /**
   * `verifyAndAwaitDecision()` only — interval between approval-status polls,
   * in ms (default: 3000). Ignored by `verify()`.
   */
  approvalPollIntervalMs?: number;
  /**
   * `verifyAndAwaitDecision()` only — client-side cap on how long to wait for a
   * held approval to be decided, in ms (default: 300000 = 5 min). This is
   * DELIBERATELY shorter than the server-side hold timeout (`defaultTimeout`,
   * 1440 min): a headless caller does not block for 24h. When the cap elapses
   * the method returns fail-closed `BLOCKED`; the hold itself lives on
   * server-side and is still decidable by a human or the expiry worker — the
   * client has merely stopped waiting. Ignored by `verify()`.
   */
  approvalPollTimeoutMs?: number;
}

export interface PalveronLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface Attachment {
  /** MIME type (e.g. "image/png", "audio/wav", "application/pdf") */
  contentType: string;
  /** Base64-encoded data */
  data: string;
  /** Optional filename */
  filename?: string;
  /** Optional per-attachment metadata (GPS, resolution, etc.) */
  metadata?: Record<string, unknown>;
}

export interface RequestContext {
  /** MCP server URL if applicable */
  mcpServer?: string;
  /** MCP tool name */
  toolName?: string;
  /** Agent chain depth for recursive calls */
  chainDepth?: number;
  /** Source system identifier ("ros2", "unity", "cursor-ide", etc.) */
  sourceSystem?: string;
  /** Session ID for conversation tracking */
  sessionId?: string;
}

export interface VerifyRequest {
  /** The prompt or input text to verify */
  prompt: string;
  /** Pre-extracted text from attachments (optional, server extracts if absent) */
  extractedText?: string;
  /** Arbitrary metadata passed through to the trace */
  metadata?: Record<string, unknown>;
  /** Multi-modal attachments (images, audio, documents, code) */
  attachments?: Attachment[];
  /** Agentic context (MCP, tool chains, source systems) */
  context?: RequestContext;
}

export interface Finding {
  risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category: string;
  description: string;
  confidence: number;
}

export interface VerifyResponse {
  /** Governance decision */
  decision: Decision;
  /** Modified/sanitized output (present when decision is MODIFIED) */
  output: string;
  /** Human-readable reason for the decision */
  reason: string;
  /** Unique trace ID for audit trail */
  traceId: string;
  /** SHA-256 integrity hash of the governance decision */
  integrityHash: string;
  /** Whether this trace will be anchored to Flare blockchain */
  shouldAnchor: boolean;
  /** Flare blockchain status */
  flareStatus: string;
  /** Flare transaction hash (populated after anchoring) */
  flareTxHash: string | null;
  /** Detected content type */
  contentType: string;
  /** Security findings (secrets, PII, policy violations) */
  findings: Finding[];
  /** Server-side latency in milliseconds */
  latencyMs: number;
  /**
   * Retry hint when `decision === 'RATE_LIMITED'`. The SDK reads this
   * from the gateway's `Retry-After` header (in seconds) and converts
   * it to milliseconds. Honour it before issuing the next request.
   */
  retryAfterMs?: number;
  /** HTTP status code that produced this response (200, 202, 403, 429). */
  httpStatus?: number;
  /**
   * Decision-trace id of the approval *decision* (Goal B2/C-b), populated ONLY
   * by `verifyAndAwaitDecision()` once a held call resolves (APPROVED/DENIED).
   * Distinct from `traceId` (the original held request). `undefined` for a plain
   * `verify()` and while still PENDING.
   */
  decisionTraceId?: string;
}

/**
 * Approval status for a held (`PENDING_APPROVAL`) trace, as returned by
 * `GET /api/v1/approvals/status` (Goal C-c). Field names mirror the gateway
 * JSON exactly (snake_case) — see `handlers/agents.rs::get_approval_status`.
 */
export interface ApprovalStatusResponse {
  /** Original held request's trace id. */
  trace_id: string | null;
  /** Approval (ApprovalChain) row id. */
  approval_id: string | null;
  /** Raw ApprovalChain.status (PENDING/APPROVED/DENIED). */
  status: string;
  /** Client-facing effective status — the field the resume loop branches on. */
  effective_status: 'APPROVED' | 'DENIED' | 'EXPIRED' | 'PENDING';
  /** Decider: email, the literal "system" marker, or null while pending. */
  decided_by: string | null;
  decided_by_name?: string | null;
  /** ISO timestamp of the decision, or null while pending. */
  decided_at: string | null;
  /** Decision-trace id (B2), or null. */
  decision_trace_id: string | null;
  /** On-chain anchor status of the decision trace (ANCHORED/PENDING/FAILED/null). */
  anchor_status: string | null;
  /** Derived expiry instant (createdAt + defaultTimeout). */
  expires_at: string | null;
  /** True when EXPIRED is a read-time derivation (worker hasn't flipped yet). */
  expired_derived: boolean;
  /** True when the hold was auto-denied by the expiry worker (Goal C-b). */
  auto_expired?: boolean;
}

/** Options for `verifyAndAwaitDecision()`. */
export interface AwaitDecisionOptions {
  /** Override `PalveronConfig.approvalPollIntervalMs` for this call. */
  pollIntervalMs?: number;
  /** Override `PalveronConfig.approvalPollTimeoutMs` (client cap) for this call. */
  pollTimeoutMs?: number;
  /**
   * Abort the polling wait early. Checked between polls — a plain `verify()` is
   * already in flight by then, so this cancels the *waiting*, returning
   * fail-closed `BLOCKED`. The server-side hold is unaffected.
   */
  signal?: AbortSignal;
}

export interface PolicyListResponse {
  policies: Array<{
    id: string;
    name: string;
    prompt: string;
    environment: string;
    contentTypes: string[];
    createdAt: string;
    updatedAt: string;
  }>;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  checks: Record<string, { status: string; latencyMs: number }>;
}

// ─── Errors ─────────────────────────────────────────────────

export class PalveronError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly requestId: string | null;
  public readonly retryable: boolean;

  constructor(message: string, opts: {
    code: string;
    statusCode: number;
    requestId?: string | null;
    retryable?: boolean;
    /**
     * The original underlying error (e.g. the `TypeError: fetch failed` whose
     * own `.cause` carries the real undici reason: ENOTFOUND, ECONNREFUSED,
     * UNABLE_TO_VERIFY_LEAF_SIGNATURE, …). Preserved on the standard
     * `Error.cause` so callers/adapters can diagnose transport failures that
     * would otherwise be masked behind a generic NETWORK_ERROR.
     */
    cause?: unknown;
  }) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'PalveronError';
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.requestId = opts.requestId ?? null;
    this.retryable = opts.retryable ?? false;
  }
}

export class PalveronAuthenticationError extends PalveronError {
  constructor(message: string, requestId?: string | null) {
    super(message, { code: 'AUTHENTICATION_FAILED', statusCode: 401, requestId, retryable: false });
    this.name = 'PalveronAuthenticationError';
  }
}

export class PalveronRateLimitError extends PalveronError {
  public readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number, requestId?: string | null) {
    super(message, { code: 'RATE_LIMITED', statusCode: 429, requestId, retryable: true });
    this.name = 'PalveronRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class PalveronValidationError extends PalveronError {
  public readonly field: string | null;

  constructor(message: string, field?: string, requestId?: string | null) {
    super(message, { code: 'VALIDATION_ERROR', statusCode: 400, requestId, retryable: false });
    this.name = 'PalveronValidationError';
    this.field = field ?? null;
  }
}

export class PalveronCircuitOpenError extends PalveronError {
  constructor() {
    super('Circuit breaker is open — too many consecutive failures. Retry later.', {
      code: 'CIRCUIT_OPEN', statusCode: 503, retryable: false,
    });
    this.name = 'PalveronCircuitOpenError';
  }
}

export class PalveronTimeoutError extends PalveronError {
  constructor(timeoutMs: number, requestId?: string | null) {
    super(`Request timed out after ${timeoutMs}ms`, {
      code: 'TIMEOUT', statusCode: 408, requestId, retryable: true,
    });
    this.name = 'PalveronTimeoutError';
  }
}

// ─── Circuit Breaker ────────────────────────────────────────

class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private threshold: number,
    private cooldownMs: number,
  ) {}

  canRequest(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure >= this.cooldownMs) {
        this.state = 'half-open';
        return true;
      }
      return false;
    }
    return true; // half-open: allow one request
  }

  onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }

  getState(): string {
    return this.state;
  }
}

// ─── Client ─────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'https://gateway.palveron.com';
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY = 500;
const DEFAULT_APPROVAL_POLL_INTERVAL = 3_000;
const DEFAULT_APPROVAL_POLL_TIMEOUT = 300_000; // 5 min client cap (≠ hold timeout)
const SDK_VERSION = '1.1.0';

export class Palveron {
  private readonly config: Required<Pick<PalveronConfig,
    'apiKey' | 'baseUrl' | 'timeout' | 'maxRetries' | 'retryBaseDelay'
    | 'approvalPollIntervalMs' | 'approvalPollTimeoutMs'
  >> & Pick<PalveronConfig, 'logger' | 'headers'>;

  private readonly circuit: CircuitBreaker;

  constructor(config: PalveronConfig) {
    if (!config.apiKey) throw new PalveronValidationError('apiKey is required');

    this.config = {
      apiKey: config.apiKey,
      baseUrl: (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryBaseDelay: config.retryBaseDelay ?? DEFAULT_RETRY_BASE_DELAY,
      approvalPollIntervalMs: config.approvalPollIntervalMs ?? DEFAULT_APPROVAL_POLL_INTERVAL,
      approvalPollTimeoutMs: config.approvalPollTimeoutMs ?? DEFAULT_APPROVAL_POLL_TIMEOUT,
      logger: config.logger,
      headers: config.headers,
    };

    this.circuit = new CircuitBreaker(
      config.circuitBreakerThreshold ?? 5,
      config.circuitBreakerCooldown ?? 30_000,
    );
  }

  // ── Core: Verify ────────────────────────────────────────

  /**
   * Send a governance verification request.
   * This is the primary method — every LLM call should go through this.
   *
   * @example
   * ```typescript
   * const result = await palveron.verify({ prompt: 'User input here' });
   * if (result.decision === 'BLOCKED') {
   *   throw new Error(result.reason);
   * }
   * ```
   */
  async verify(request: VerifyRequest): Promise<VerifyResponse> {
    const body = {
      prompt: request.prompt,
      extracted_text: request.extractedText,
      metadata: request.metadata,
      attachments: request.attachments?.map(a => ({
        content_type: a.contentType,
        data: a.data,
        filename: a.filename,
        metadata: a.metadata,
      })),
      context: request.context ? {
        mcp_server: request.context.mcpServer,
        tool_name: request.context.toolName,
        chain_depth: request.context.chainDepth,
        source_system: request.context.sourceSystem,
        session_id: request.context.sessionId,
      } : undefined,
    };

    const start = Date.now();
    // expectGovernanceDecision: 202 / 403 / 429 surface as VerifyResponse,
    // not as exceptions. This matches the gateway's Sprint 87 HTTP
    // semantics — see /docs/api/verify for the full status-code table.
    const { body: raw, status, retryAfterMs } = await this.request<Record<string, unknown>>(
      'POST',
      '/api/v1/verify',
      body,
      { expectGovernanceDecision: true },
    );
    const latency = Date.now() - start;

    const decision = this.coerceDecision(raw.decision, status);

    return {
      decision,
      output: (raw.output as string) ?? '',
      reason: (raw.reason as string) ?? (typeof raw.error === 'string' ? raw.error : ''),
      traceId: (raw.trace_id as string) ?? '',
      integrityHash: (raw.integrity_hash as string) ?? '',
      shouldAnchor: (raw.should_anchor as boolean) ?? false,
      flareStatus: (raw.flare_status as string) ?? '',
      flareTxHash: (raw.flare_tx_hash as string | null) ?? null,
      contentType: (raw.content_type as string) ?? 'text',
      findings: (raw.findings as Finding[]) ?? [],
      latencyMs: latency,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      httpStatus: status,
    };
  }

  /**
   * Resolve the canonical Decision string from a raw response body and
   * its HTTP status. Used by verify() to map 429 (no `decision` in body)
   * onto a synthesised `RATE_LIMITED` decision without ever throwing.
   */
  private coerceDecision(raw: unknown, status: number): Decision {
    if (typeof raw === 'string' && raw.length > 0) {
      return raw as Decision;
    }
    // Body had no `decision` field — synthesise from HTTP status.
    if (status === 429) return 'RATE_LIMITED';
    if (status === 403) return 'BLOCKED';
    if (status === 202) return 'PENDING_APPROVAL';
    if (status >= 200 && status < 300) return 'PASSED';
    return 'ERROR';
  }

  // ── Approval resume (Goal C-a) ──────────────────────────

  /**
   * Fetch the live approval status for a held trace (Goal C-c endpoint).
   * Useful on its own for building a custom wait loop; `verifyAndAwaitDecision`
   * is the batteries-included path. Throws `PalveronError` on transport/HTTP
   * errors (e.g. a 404 right after the 202, before the hold row is queryable).
   */
  async getApprovalStatus(traceId: string): Promise<ApprovalStatusResponse> {
    const { body } = await this.request<ApprovalStatusResponse>(
      'GET',
      `/api/v1/approvals/status?trace_id=${encodeURIComponent(traceId)}`,
    );
    return body;
  }

  /**
   * Verify, and if the result is held for human approval
   * (`PENDING_APPROVAL`), poll the approval-status endpoint until the hold is
   * decided — then resume with a resolved decision. Opt-in: `verify()` is
   * unchanged, and any non-held result returns immediately without polling.
   *
   * **Fail-closed contract** — ONLY an explicit `APPROVED` resumes:
   *
   * | effective_status / outcome        | returned `decision` |
   * |-----------------------------------|---------------------|
   * | `APPROVED`                        | `'PASSED'`          |
   * | `DENIED`                          | `'BLOCKED'`         |
   * | `EXPIRED` / `auto_expired`        | `'BLOCKED'`         |
   * | poll cap reached (still pending)  | `'BLOCKED'`         |
   * | status error / 404 / network      | (keep polling → `'BLOCKED'` at cap) |
   *
   * `'PASSED'` is the canonical allow value a fresh `verify()` returns, so a
   * resumed call is indistinguishable from a normal pass to the caller.
   *
   * The client cap (`approvalPollTimeoutMs`, default 5 min) is intentionally
   * shorter than the server-side hold timeout (24h): hitting it returns
   * `BLOCKED` while the hold lives on server-side, decidable later by a human
   * or the expiry worker. DENIED/EXPIRED are valid governance outcomes, NOT
   * errors — this never throws for them.
   *
   * @example
   * ```typescript
   * const res = await palveron.verifyAndAwaitDecision({ prompt: 'rm -rf /' });
   * if (res.decision === 'PASSED') runTool();      // approved
   * else console.warn('held call not allowed:', res.reason);
   * ```
   */
  async verifyAndAwaitDecision(
    request: VerifyRequest,
    opts?: AwaitDecisionOptions,
  ): Promise<VerifyResponse> {
    const res = await this.verify(request);

    // Not held → return verbatim, no polling (PASSED/BLOCKED/MODIFIED/…).
    if (res.decision !== 'PENDING_APPROVAL') return res;

    const intervalMs = opts?.pollIntervalMs ?? this.config.approvalPollIntervalMs;
    const timeoutMs = opts?.pollTimeoutMs ?? this.config.approvalPollTimeoutMs;
    const { signal } = opts ?? {};

    // No traceId → nothing to poll. Fail-closed.
    if (!res.traceId) {
      return { ...res, decision: 'BLOCKED', reason: 'No traceId available to poll approval status' };
    }

    const blocked = (reason: string, decisionTraceId?: string | null): VerifyResponse => ({
      ...res,
      decision: 'BLOCKED',
      reason,
      ...(decisionTraceId ? { decisionTraceId } : {}),
    });

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (signal?.aborted) return blocked('Approval polling aborted by caller');

      // Wait one interval before (re)checking — the hold was just created; this
      // also bounds the loop to one status call per interval (no busy-loop).
      await this.sleep(intervalMs);

      if (signal?.aborted) return blocked('Approval polling aborted by caller');

      let status: ApprovalStatusResponse;
      try {
        status = await this.getApprovalStatus(res.traceId);
      } catch (err) {
        // 404 right after the 202 (row not yet queryable), transient network,
        // or an open circuit — none are terminal. Keep polling until the cap.
        this.config.logger?.debug('Approval status poll failed — retrying until cap', {
          traceId: res.traceId,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      switch (status.effective_status) {
        case 'APPROVED':
          return {
            ...res,
            decision: 'PASSED',
            reason: status.decided_by ? `Approval granted by ${status.decided_by}` : 'Approval granted',
            ...(status.decision_trace_id ? { decisionTraceId: status.decision_trace_id } : {}),
          };
        case 'DENIED':
          // Auto-expiry (Goal C-b) surfaces as DENIED + auto_expired; label it honestly.
          return blocked(
            status.auto_expired
              ? 'Approval auto-expired (timed out)'
              : status.decided_by ? `Approval denied by ${status.decided_by}` : 'Approval denied',
            status.decision_trace_id,
          );
        case 'EXPIRED':
          return blocked('Approval expired (timed out)', status.decision_trace_id);
        default:
          // PENDING (or any unexpected value) → keep waiting, fail-closed at cap.
          break;
      }
    }

    return blocked(
      `Approval poll timed out after ${timeoutMs}ms — the hold remains pending server-side and may still be decided`,
    );
  }

  // ── Convenience: Quick verify (string-only) ─────────────

  /**
   * Quick verification for text-only prompts.
   *
   * @example
   * ```typescript
   * const result = await palveron.check('Is this prompt safe?');
   * console.log(result.decision); // 'ALLOWED'
   * ```
   */
  async check(prompt: string): Promise<VerifyResponse> {
    return this.verify({ prompt });
  }

  // ── Convenience: Verify with file ───────────────────────

  /**
   * Verify a prompt with a file attachment.
   * Reads the file, Base64-encodes it, and sends it with the correct MIME type.
   * Node.js only — use verify() with pre-encoded data in browsers.
   *
   * @example
   * ```typescript
   * const result = await palveron.verifyWithFile(
   *   'Analyze this document',
   *   '/path/to/report.pdf'
   * );
   * ```
   */
  async verifyWithFile(prompt: string, filePath: string): Promise<VerifyResponse> {
    // Dynamic import to keep SDK isomorphic
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');

    const buffer = await readFile(filePath);
    const base64 = buffer.toString('base64');
    const filename = basename(filePath);
    const contentType = this.inferMimeType(filename);

    return this.verify({
      prompt,
      attachments: [{ contentType, data: base64, filename }],
    });
  }

  // ── Policies ────────────────────────────────────────────

  /**
   * List all active policies for the project.
   */
  async listPolicies(env: string = 'prod'): Promise<PolicyListResponse> {
    const { body } = await this.request<PolicyListResponse>('GET', `/api/v1/policies?env=${env}`);
    return body;
  }

  // ── Health ──────────────────────────────────────────────

  /**
   * Check gateway health status.
   */
  async health(): Promise<HealthResponse> {
    const { body } = await this.request<HealthResponse>('GET', '/health');
    return body;
  }

  // ── Diagnostics ─────────────────────────────────────────

  /**
   * Get SDK and connection diagnostics.
   */
  diagnostics(): {
    sdkVersion: string;
    baseUrl: string;
    timeout: number;
    maxRetries: number;
    circuitState: string;
  } {
    return {
      sdkVersion: SDK_VERSION,
      baseUrl: this.config.baseUrl,
      timeout: this.config.timeout,
      maxRetries: this.config.maxRetries,
      circuitState: this.circuit.getState(),
    };
  }

  // ─── Internal: HTTP with retry + circuit breaker ────────

  /**
   * Issue an HTTP request with retry + circuit-breaker + timeout.
   *
   * Returns `{ body, status, retryAfterMs? }` so the caller can branch
   * on the HTTP status itself when needed (verify uses this to surface
   * 202 / 403 / 429 as governance decisions instead of exceptions).
   *
   * When `opts.expectGovernanceDecision` is set:
   *   • 202 (PENDING_APPROVAL), 403 (BLOCKED) → the parsed body is
   *     returned without retry; the caller maps `body.decision`.
   *   • 429 (RATE_LIMITED) → the parsed body is returned **without
   *     retry**; the caller surfaces `decision: 'RATE_LIMITED'` with
   *     `retryAfterMs`. (Versus the default behaviour, which retries
   *     transient 429s on idempotent reads like listPolicies/health.)
   *   • Everything else: identical to default behaviour.
   *
   * Auth (401), validation (400), and 5xx remain exceptions because
   * they are not governance decisions — they are transport/config
   * failures and should surface as such.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { expectGovernanceDecision?: boolean },
  ): Promise<{ body: T; status: number; retryAfterMs?: number }> {
    if (!this.circuit.canRequest()) {
      throw new PalveronCircuitOpenError();
    }

    const governed = opts?.expectGovernanceDecision === true;
    let lastError: Error | null = null;
    const maxAttempts = this.config.maxRetries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        const delay = this.backoffDelay(attempt);
        this.config.logger?.debug(`Retry attempt ${attempt}/${this.config.maxRetries}`, { delay, path });
        await this.sleep(delay);
      }

      const requestId = this.generateRequestId();

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.timeout);

        const headers: Record<string, string> = {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': `palveron-sdk-typescript/${SDK_VERSION}`,
          'X-Request-ID': requestId,
          ...this.config.headers,
        };

        const response = await fetch(`${this.config.baseUrl}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timer);

        const responseRequestId = response.headers.get('x-request-id') ?? requestId;

        if (response.ok) {
          this.circuit.onSuccess();
          return {
            body: await response.json() as T,
            status: response.status,
          };
        }

        // ── Governance decisions returned as non-2xx (Sprint 87) ──
        // 202 PENDING_APPROVAL, 403 BLOCKED, 429 RATE_LIMITED all
        // carry meaningful bodies on the verify endpoint. When the
        // caller opts into governance semantics, surface them as
        // results rather than exceptions.
        if (governed && (response.status === 202 || response.status === 403 || response.status === 429)) {
          this.circuit.onSuccess(); // governance decisions are not failures
          const parsed = await response.json().catch(() => ({})) as T;
          const retryAfterMs = response.status === 429
            ? parseRetryAfter(response.headers.get('retry-after'))
            : undefined;
          return {
            body: parsed,
            status: response.status,
            ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
          };
        }

        // Handle specific error codes
        if (response.status === 401) {
          this.circuit.onSuccess(); // auth errors are not circuit failures
          throw new PalveronAuthenticationError(
            'Invalid API key or expired token',
            responseRequestId,
          );
        }

        if (response.status === 429) {
          const retryAfter = parseRetryAfter(response.headers.get('retry-after')) ?? 5_000;
          throw new PalveronRateLimitError(
            'Rate limit exceeded',
            retryAfter,
            responseRequestId,
          );
        }

        if (response.status === 400) {
          const errorBody = await response.json().catch(() => ({})) as Record<string, string>;
          throw new PalveronValidationError(
            errorBody.error ?? 'Invalid request',
            errorBody.field,
            responseRequestId,
          );
        }

        // Retryable server errors (500, 502, 503)
        if (response.status >= 500) {
          this.circuit.onFailure();
          const errorBody = await response.text().catch(() => '');
          lastError = new PalveronError(
            `Server error: ${response.status} ${response.statusText}`,
            { code: 'SERVER_ERROR', statusCode: response.status, requestId: responseRequestId, retryable: true },
          );
          this.config.logger?.warn(`Server error on attempt ${attempt + 1}`, {
            status: response.status,
            requestId: responseRequestId,
            body: errorBody.slice(0, 200),
          });
          continue; // retry
        }

        // Non-retryable client errors
        const errorBody = await response.json().catch(() => ({})) as Record<string, string>;
        throw new PalveronError(
          errorBody.error ?? `HTTP ${response.status}`,
          { code: 'CLIENT_ERROR', statusCode: response.status, requestId: responseRequestId, retryable: false },
        );

      } catch (error) {
        if (error instanceof PalveronError && !error.retryable) throw error;

        if (error instanceof DOMException && error.name === 'AbortError') {
          this.circuit.onFailure();
          lastError = new PalveronTimeoutError(this.config.timeout, requestId);
          continue;
        }

        if (error instanceof TypeError && error.message.includes('fetch')) {
          this.circuit.onFailure();
          lastError = new PalveronError('Network error — could not reach gateway', {
            // Preserve the original `TypeError: fetch failed` (and via its own
            // `.cause` the real undici reason) so adapters can distinguish DNS /
            // connect / TLS-trust / egress failures instead of seeing a generic
            // NETWORK_ERROR. Behaviour (code/retryable/decision) is unchanged.
            code: 'NETWORK_ERROR', statusCode: 0, requestId, retryable: true, cause: error,
          });
          continue;
        }

        if (error instanceof PalveronError) {
          lastError = error;
          continue;
        }

        throw error;
      }
    }

    throw lastError ?? new PalveronError('Max retries exceeded', {
      code: 'MAX_RETRIES', statusCode: 0, retryable: false,
    });
  }

  // ─── Helpers ────────────────────────────────────────────

  private backoffDelay(attempt: number): number {
    const base = this.config.retryBaseDelay * Math.pow(2, attempt - 1);
    const jitter = base * 0.2 * Math.random();
    return Math.min(base + jitter, 30_000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private generateRequestId(): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `pv_${ts}_${rand}`;
  }

  private inferMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const map: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
      wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', mp4: 'video/mp4',
      py: 'text/x-python', js: 'text/javascript', ts: 'text/typescript',
      rs: 'text/x-rust', go: 'text/x-go', java: 'text/x-java',
      c: 'text/x-c', cpp: 'text/x-c++', txt: 'text/plain',
      json: 'application/json', csv: 'text/csv', xml: 'application/xml',
    };
    return map[ext ?? ''] ?? 'application/octet-stream';
  }
}

// ─── Helpers ────────────────────────────────────────────

/**
 * Parse a `Retry-After` HTTP header into milliseconds.
 *
 * Per RFC 7231 the value can be either delta-seconds (an integer) or
 * an HTTP-date. We support both. Returns undefined for missing /
 * unparseable headers so the caller can decide on a default.
 */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  // delta-seconds
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  // HTTP-date — Date.parse returns NaN on failure
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }

  return undefined;
}

// ─── Factory ──────────────────────────────────────────────

/**
 * Create a Palveron client instance.
 *
 * @example
 * ```typescript
 * import { createClient } from '@palveron/sdk';
 *
 * const palveron = createClient({
 *   apiKey: process.env.PALVERON_API_KEY!,
 *   baseUrl: 'https://gateway.acme.corp:8080', // on-prem
 * });
 *
 * const result = await palveron.verify({ prompt: userInput });
 * ```
 */
export function createClient(config: PalveronConfig): Palveron {
  return new Palveron(config);
}

// ─── Re-exports ─────────────────────────────────────────

export default Palveron;
