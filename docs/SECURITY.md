# Cortex Security Guide

This document describes the security measures implemented in Cortex and how to maintain them.

## Security Architecture

### 1. Input Validation (`core/validation.cjs`)

All tool inputs are validated before processing:

| Tool | Validated Fields | Max Lengths |
|------|------------------|-------------|
| `cortex__query` | query, sources, limit | query: 10,000 chars |
| `cortex__recall` | context, type | context: 5,000 chars |
| `cortex__reflect` | topic, depth | topic: 1,000 chars |
| `cortex__infer` | concepts, includeMemories | concept: 1,000 chars each |
| `cortex__learn` | insight, context, type, tags | insight: 50,000 chars |
| `cortex__consolidate` | scope, type, dryRun | - |

**Protection Against:**
- Command injection
- Path traversal
- Buffer overflow
- Invalid type coercion

### 2. Rate Limiting (`core/rate-limiter.cjs`)

Prevents runaway API costs with tiered limits:

| Tool Type | Per Minute | Per Hour | Per Day |
|-----------|------------|----------|---------|
| Haiku (query, recall) | 30 | 300 | 1,000 |
| Sonnet (reflect, infer, learn) | 10-15 | 60-100 | 200-300 |
| Sonnet (consolidate) | 5 | 20 | 50 |

**Features:**
- Sliding window algorithm
- 1.5x burst allowance
- 60-second cooldown on limit breach
- Environment variable override: `CORTEX_RATE_LIMIT=false`

### 3. Audit Logging (`core/audit-logger.cjs`)

All operations are logged to JSONL files:

**Log Location:** `~/.claude/memory/logs/cortex-YYYY-MM-DD.jsonl`

**Logged Events:**
- `tool_call_start` / `tool_call_end` / `tool_call_error`
- `rate_limit_hit`
- `validation_failure`
- `resource_access`
- `prompt_access`
- `session_start` / `session_end`

**Features:**
- Automatic log rotation (10MB max)
- Keeps last 5 rotated files
- Sensitive field redaction
- Correlation IDs for request tracing

**Environment Variables:**
- `CORTEX_AUDIT=false` - Disable logging
- `CORTEX_LOG_LEVEL=DEBUG|INFO|WARN|ERROR` - Set log level
- `CORTEX_AUDIT_CONSOLE=true` - Echo to stderr

### 4. Encryption (`core/encryption.cjs`)

Optional encryption for sensitive memory data:

**Algorithm:** AES-256-GCM (authenticated encryption)
**Key Derivation:** PBKDF2 with SHA-512, 100,000 iterations

**Setup:**
```bash
# Generate a secret
node -e "console.log(require('./core/encryption.cjs').generateSecret())"

# Set the secret
export CORTEX_ENCRYPTION_SECRET="your-base64-secret"
```

**Usage:**
```javascript
const { encrypt, decrypt } = require('./core/encryption.cjs');

const encrypted = encrypt('sensitive data');
const decrypted = decrypt(encrypted);
```

## Security Scanning

### Recommended Tools

1. **npm audit** - Check for known vulnerabilities
   ```bash
   cd ~/.claude/memory
   npm audit
   ```

2. **snyk** - Deep dependency scanning
   ```bash
   npm install -g snyk
   snyk test
   ```

3. **eslint-plugin-security** - Static code analysis
   ```bash
   npm install --save-dev eslint-plugin-security
   # Add to .eslintrc: plugins: ['security']
   ```

4. **retire.js** - Detect outdated libraries
   ```bash
   npm install -g retire
   retire --path .
   ```

### Manual Security Checklist

Run periodically (recommended: weekly):

- [ ] **Dependencies**: Run `npm audit` and update vulnerable packages
- [ ] **API Key**: Verify `ANTHROPIC_API_KEY` is not hardcoded
- [ ] **Log Files**: Check logs don't contain sensitive data
- [ ] **Permissions**: Verify file permissions on `~/.claude/memory/`
- [ ] **Rate Limits**: Review rate limit stats for anomalies
- [ ] **Encryption**: Verify encryption secret is not committed

### Security Boundaries

**Trusted:**
- Claude Code client
- Local file system
- Environment variables

**Untrusted:**
- Tool input arguments (always validated)
- Resource URIs (resolved and checked)
- Prompt arguments (sanitized)

## Error Codes (Security-Related)

| Code | Category | Description |
|------|----------|-------------|
| CORTEX_E200 | tool | Invalid tool arguments |
| CORTEX_E310 | rate-limit | Rate limit exceeded |
| CORTEX_E311 | rate-limit | Hourly limit exceeded |
| CORTEX_E312 | rate-limit | Daily limit exceeded |
| CORTEX_E313 | rate-limit | Tool in cooldown |
| CORTEX_E500 | encryption | Encryption operation failed |
| CORTEX_E501 | encryption | Decryption failed |
| CORTEX_E502 | encryption | Encryption not configured |

## Incident Response

If you suspect a security issue:

1. **Disable the server**: Remove from `~/.claude.json`
2. **Review logs**: Check `~/.claude/memory/logs/`
3. **Rotate API key**: Generate new key in Anthropic console
4. **Rotate encryption secret**: Generate new secret, re-encrypt data
5. **Report**: File issue at repository (do not include sensitive data)

## Configuration Reference

| Environment Variable | Purpose | Default |
|---------------------|---------|---------|
| `ANTHROPIC_API_KEY` | API authentication | Required |
| `CORTEX_RATE_LIMIT` | Enable rate limiting | `true` |
| `CORTEX_AUDIT` | Enable audit logging | `true` |
| `CORTEX_LOG_LEVEL` | Minimum log level | `INFO` |
| `CORTEX_AUDIT_CONSOLE` | Echo logs to stderr | `false` |
| `CORTEX_ENCRYPTION_SECRET` | Encryption key (base64) | Not set |

## Version History

- **v1.0.0**: Initial security implementation
  - Input validation for all 6 tools
  - Rate limiting with sliding window
  - JSONL audit logging with rotation
  - Optional AES-256-GCM encryption
