# Changelog

All notable changes to `@palveron/sdk` will be documented in this file.

This project follows [Semantic Versioning](https://semver.org/).

## [1.2.0] — 2026-06-23

### Changed
- `PalveronError` now preserves the original underlying error on the standard
  `Error.cause` when a request fails with `NETWORK_ERROR`. Previously a transport
  failure (`TypeError: fetch failed`) was caught and re-thrown as a generic
  `PalveronError('NETWORK_ERROR')` that **discarded** the real reason. The real
  undici reason now remains reachable via `err.cause.cause.code`
  (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `CERT_HAS_EXPIRED`, `ECONNREFUSED`,
  `ENOTFOUND`, …) so consumers and adapters can detect TLS-interception /
  transport root causes instead of seeing an opaque network error.

### Migration
- Purely additive: `code`, `statusCode`, `retryable` and decision flow are
  unchanged. Existing handlers keep working. New: inspect `err.cause` (the
  original `TypeError`) and `err.cause.cause.code` (the low-level reason) for
  richer diagnostics.

## [1.1.0] — 2026-05-19

### Changed
- `verify()` now treats the gateway's Sprint-87 HTTP semantics as governance
  decisions rather than errors. The mapping is:
  - `200 OK` → `decision: 'PASSED' | 'MODIFIED' | 'FLAGGED' | 'POLICY_CHANGE'`
  - `202 Accepted` → `decision: 'PENDING_APPROVAL'`
  - `403 Forbidden` → `decision: 'BLOCKED'`
  - `429 Too Many Requests` → `decision: 'RATE_LIMITED'` (synthesised) with
    `retryAfterMs` parsed from the `Retry-After` header
- Previous behaviour: 403/429 raised `PalveronError` / `PalveronRateLimitError`.
  New behaviour: only transport/auth/server failures (401, 5xx, network,
  timeout) raise. Governance outcomes always flow through `decision`.
- Non-verify endpoints (`listPolicies`, `health`) keep the strict
  error-on-non-2xx behaviour, so 429 on read endpoints still retries with
  exponential backoff.

### Added
- `Decision` type extended to cover all gateway decisions:
  `PASSED`, `ALLOWED`, `BLOCKED`, `MODIFIED`, `FLAGGED`, `PENDING_APPROVAL`,
  `POLICY_CHANGE`, `RATE_LIMITED`, `ERROR`.
- `VerifyResponse.retryAfterMs` — populated when `decision === 'RATE_LIMITED'`.
- `VerifyResponse.httpStatus` — the HTTP status code that produced the
  response, useful for observability.
- RFC-7231-compliant `Retry-After` parsing (handles both delta-seconds and
  HTTP-date formats).

### Migration
- If you previously caught `PalveronError` to handle a block, switch to
  branching on `result.decision === 'BLOCKED'`.
- If you previously caught `PalveronRateLimitError`, switch to checking
  `result.decision === 'RATE_LIMITED'` and honouring `result.retryAfterMs`.
- Existing `try { … } catch (PalveronError)` handlers for auth/validation/
  server errors are unchanged.

## [1.0.0] — 2026-05-17

### Added
- Initial public release of `@palveron/sdk` on npm
- `Palveron` client class with full API coverage
- Policy verification via `verify()` method with multi-modal attachments
  (image, audio, video, document, code)
- `check()` convenience method for text-only verification
- `verifyWithFile()` convenience method (Node.js, auto MIME detection)
- `listPolicies()` and `health()` endpoints
- `diagnostics()` method for runtime introspection
- `RequestContext` for MCP / agentic context
  (`mcpServer`, `toolName`, `chainDepth`, `sourceSystem`, `sessionId`)
- Typed error hierarchy: `PalveronError`, `PalveronAuthenticationError`,
  `PalveronRateLimitError`, `PalveronValidationError`, `PalveronTimeoutError`,
  `PalveronCircuitOpenError`
- `retryAfterMs` on rate limit errors
- Retry with exponential backoff + jitter
- Circuit breaker with configurable threshold and cooldown
- Custom headers support for proxy / auth scenarios
- Custom `baseUrl` for on-premise / self-hosted gateways
- TypeScript type definitions for every API surface
- Dual ESM + CommonJS output, source maps, declaration maps
- Zero runtime dependencies; works in Node.js 18+, Deno, Bun, Cloudflare
  Workers, Vercel Edge
