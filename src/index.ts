// ============================================================
// @palveron/sdk — Official TypeScript SDK for Palveron AI Governance
// ============================================================
// Zero dependencies. Works in Node.js 18+, Deno, Bun, Edge Runtimes.
// ============================================================

// ─── Types ──────────────────────────────────────────────────

export type Decision = 'ALLOWED' | 'BLOCKED' | 'MODIFIED' | 'ERROR';
export type RiskLevel = 'minimal' | 'limited' | 'high' | 'unacceptable';
export type Sensitivity = 'low' | 'medium' | 'high';

export interface PalveronConfig {
  /** API key (starts with pv_live_ or pv_test_) */
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
  }) {
    super(message);
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
const SDK_VERSION = '1.0.0';

export class Palveron {
  private readonly config: Required<Pick<PalveronConfig,
    'apiKey' | 'baseUrl' | 'timeout' | 'maxRetries' | 'retryBaseDelay'
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
    const raw = await this.request<Record<string, unknown>>('POST', '/api/v1/verify', body);
    const latency = Date.now() - start;

    return {
      decision: (raw.decision as Decision) ?? 'ERROR',
      output: (raw.output as string) ?? '',
      reason: (raw.reason as string) ?? '',
      traceId: (raw.trace_id as string) ?? '',
      integrityHash: (raw.integrity_hash as string) ?? '',
      shouldAnchor: (raw.should_anchor as boolean) ?? false,
      flareStatus: (raw.flare_status as string) ?? '',
      flareTxHash: (raw.flare_tx_hash as string | null) ?? null,
      contentType: (raw.content_type as string) ?? 'text',
      findings: (raw.findings as Finding[]) ?? [],
      latencyMs: latency,
    };
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
    return this.request<PolicyListResponse>('GET', `/api/v1/policies?env=${env}`);
  }

  // ── Health ──────────────────────────────────────────────

  /**
   * Check gateway health status.
   */
  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/health');
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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.circuit.canRequest()) {
      throw new PalveronCircuitOpenError();
    }

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
          return await response.json() as T;
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
          const retryAfter = parseInt(response.headers.get('retry-after') ?? '5', 10) * 1000;
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
            code: 'NETWORK_ERROR', statusCode: 0, requestId, retryable: true,
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
