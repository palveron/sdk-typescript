# Changelog

All notable changes to `@palveron/sdk` will be documented in this file.

This project follows [Semantic Versioning](https://semver.org/).

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
