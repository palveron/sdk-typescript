<p align="center">
  <h1 align="center">@palveron/sdk</h1>
  <p align="center">Official TypeScript / JavaScript SDK for the Palveron AI Governance Gateway</p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@palveron/sdk"><img src="https://img.shields.io/npm/v/@palveron/sdk.svg?style=flat-square&color=cb3837" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@palveron/sdk"><img src="https://img.shields.io/npm/dm/@palveron/sdk.svg?style=flat-square" alt="npm downloads"></a>
  <a href="https://github.com/palveron/sdk-typescript/actions"><img src="https://img.shields.io/github/actions/workflow/status/palveron/sdk-typescript/ci.yml?style=flat-square" alt="CI"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-green.svg?style=flat-square" alt="License: MIT"></a>
  <a href="https://docs.palveron.com"><img src="https://img.shields.io/badge/docs-palveron.com-5A67D8?style=flat-square" alt="Documentation"></a>
</p>

---

Every AI interaction your application makes — governed, audited, and optionally anchored to the blockchain. In one line of code.

- **Zero dependencies** — uses native `fetch`; works in Node.js 18+, Deno, Bun, Cloudflare Workers, Vercel Edge
- **Multi-modal** — text, images, audio, documents, code
- **Enterprise-grade** — retry with exponential backoff, circuit breaker, typed errors
- **On-prem ready** — point to any Palveron Gateway endpoint

## Installation

```bash
npm install @palveron/sdk
# or
pnpm add @palveron/sdk
# or
yarn add @palveron/sdk
```

## Quick Start

```typescript
import { Palveron } from '@palveron/sdk';

const palveron = new Palveron({ apiKey: process.env.PALVERON_API_KEY! });

// Verify any prompt before sending it to an LLM
const result = await palveron.verify({ prompt: userInput });

if (result.decision === 'BLOCKED') {
  console.error(`Blocked: ${result.reason}`);
  return;
}

// result.decision is 'ALLOWED' or 'MODIFIED'
// result.output contains the (possibly sanitized) text
// result.traceId links to the immutable audit trail
```

## Features

- **Policy Enforcement** — every prompt routed through your active guardrails before it reaches an LLM
- **Trace Verification** — every decision logged with an integrity hash for tamper detection
- **Agent Registration & Governance** — list and audit the agents covered by your account
- **Blockchain Attestation** — high-severity traces anchored to Flare for cryptographic audit trails
- **EU AI Act / DORA / GDPR** — compliance-ready audit fields out of the box

## Configuration

```typescript
const palveron = new Palveron({
  apiKey: 'pv_live_xxx',                  // Required — project or agent API key
  baseUrl: 'https://gateway.palveron.com', // Custom endpoint for on-prem
  timeout: 30_000,                         // Request timeout in ms
  maxRetries: 3,                           // Retry attempts on transient failures
  retryBaseDelay: 500,                     // Base delay for exponential backoff (ms)
  headers: { 'X-Tenant': 'acme' },         // Custom headers on every request
  circuitBreakerThreshold: 5,              // Failures before circuit opens
  circuitBreakerCooldown: 30_000,          // Cooldown before half-open retry (ms)
});
```

## API Reference

Full reference at **[docs.palveron.com/sdks](https://docs.palveron.com/sdks)**. Quick summary:

### `verify(request)` — Core governance check

```typescript
const result = await palveron.verify({
  prompt: 'Transfer $50,000 to account DE89370400440532013000',
  metadata: { userId: 'u_123', department: 'finance' },
  attachments: [{
    contentType: 'application/pdf',
    data: base64EncodedPdf,
    filename: 'contract.pdf',
  }],
  context: {
    mcpServer: 'https://mcp.internal.corp',
    toolName: 'bank_transfer',
    chainDepth: 2,
    sourceSystem: 'crewai',
    sessionId: 'sess_abc',
  },
});
```

**Returns `VerifyResponse`:**

| Field | Type | Description |
|-------|------|-------------|
| `decision` | `'ALLOWED' \| 'BLOCKED' \| 'MODIFIED' \| 'ERROR'` | Governance decision |
| `output` | `string` | Sanitized output (PII redacted if MODIFIED) |
| `reason` | `string` | Human-readable explanation |
| `traceId` | `string` | Unique audit trail ID |
| `integrityHash` | `string` | SHA-256 hash for tamper detection |
| `shouldAnchor` | `boolean` | Whether trace will be anchored to Flare blockchain |
| `flareStatus` | `string` | `LOCAL_ONLY`, `PENDING`, `ANCHORED`, `SKIPPED`, `FAILED` |
| `flareTxHash` | `string \| null` | Blockchain transaction hash (after anchoring) |
| `contentType` | `string` | Detected content type |
| `findings` | `Finding[]` | Security findings (PII, secrets, policy violations) |
| `latencyMs` | `number` | Round-trip latency in milliseconds |

### `check(prompt)` — Quick text-only verification

```typescript
const { decision } = await palveron.check('Is this prompt safe?');
```

### `verifyWithFile(prompt, filePath)` — File attachment (Node.js only)

```typescript
const result = await palveron.verifyWithFile(
  'Analyze this document for compliance',
  './report.pdf'
);
```

### `listPolicies(env?)` — List active policies

```typescript
const { policies } = await palveron.listPolicies('prod');
```

### `health()` — Gateway health check

```typescript
const health = await palveron.health();
console.log(health.status); // 'healthy'
```

### `diagnostics()` — SDK diagnostics

```typescript
const diag = palveron.diagnostics();
// { sdkVersion, baseUrl, timeout, maxRetries, circuitState }
```

## Examples

### LLM gateway with governance

```typescript
import { Palveron } from '@palveron/sdk';
import OpenAI from 'openai';

const palveron = new Palveron({ apiKey: process.env.PALVERON_API_KEY! });
const openai = new OpenAI();

async function askWithGovernance(userPrompt: string) {
  const gate = await palveron.verify({ prompt: userPrompt });
  if (gate.decision === 'BLOCKED') {
    throw new Error(`Blocked by policy: ${gate.reason}`);
  }
  // `gate.output` is the (possibly sanitized) prompt — always use it
  // instead of the raw input so downstream LLMs never see PII / secrets.
  return openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: gate.output }],
  });
}
```

### Agentic / MCP audit context

```typescript
const result = await palveron.verify({
  prompt: 'Execute bank transfer',
  context: {
    mcpServer: 'https://banking-mcp.corp.internal',
    toolName: 'transfer_funds',
    chainDepth: 3,
    sourceSystem: 'crewai',
    sessionId: 'agent_session_42',
  },
});
```

### On-premise / self-hosted gateway

```typescript
const palveron = new Palveron({
  apiKey: process.env.PALVERON_API_KEY!,
  baseUrl: 'https://gateway.internal.acme.corp:8080',
  timeout: 10_000,
  maxRetries: 5,
});
```

## Error Handling

All errors extend `PalveronError` with structured metadata:

```typescript
import { PalveronError, PalveronRateLimitError } from '@palveron/sdk';

try {
  await palveron.verify({ prompt: input });
} catch (err) {
  if (err instanceof PalveronRateLimitError) {
    // err.retryAfterMs — wait this long before retrying
    await sleep(err.retryAfterMs);
    return retry();
  }
  if (err instanceof PalveronError) {
    console.error(err.code, err.statusCode, err.requestId);
  }
}
```

| Error Class | Code | Retryable | When |
|-------------|------|:---------:|------|
| `PalveronAuthenticationError` | `AUTHENTICATION_FAILED` | No | Invalid or expired API key |
| `PalveronRateLimitError` | `RATE_LIMITED` | Yes | Quota exceeded (includes `retryAfterMs`) |
| `PalveronValidationError` | `VALIDATION_ERROR` | No | Malformed request (includes `field`) |
| `PalveronTimeoutError` | `TIMEOUT` | Yes | Gateway didn't respond in time |
| `PalveronCircuitOpenError` | `CIRCUIT_OPEN` | No | Too many consecutive failures |

## Requirements

- Node.js **18 or newer** (uses native `fetch`)
- TypeScript **5.0 or newer** (recommended; SDK works in plain JavaScript too)
- Also runs in Deno, Bun, Cloudflare Workers, Vercel Edge

## Links

- **Documentation** — [docs.palveron.com](https://docs.palveron.com)
- **SDK reference** — [docs.palveron.com/sdks](https://docs.palveron.com/sdks)
- **Dashboard** — [palveron.com](https://palveron.com)
- **Support** — [hello@palveron.com](mailto:hello@palveron.com)
- **GitHub** — [palveron/sdk-typescript](https://github.com/palveron/sdk-typescript)
- **Changelog** — [CHANGELOG.md](https://github.com/palveron/sdk-typescript/blob/main/CHANGELOG.md)

## License

[MIT](./LICENSE) — Copyright © 2026 Palveron.
