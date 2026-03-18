# email-verification-module

A robust Node.js module for verifying email addresses using **DNS MX lookups**, **raw SMTP protocol** (RCPT TO), and **Levenshtein-based typo detection**. Zero external runtime dependencies — built entirely on Node.js built-ins.

---

## Features

- ✅ Email syntax validation (RFC 5321)
- ✅ DNS MX record resolution (sorted by priority)
- ✅ Raw SMTP handshake (`EHLO → MAIL FROM → RCPT TO → QUIT`) via TCP socket
- ✅ Multi-MX fallback (tries each server in priority order)
- ✅ "Did You Mean?" typo detection using Levenshtein distance (≤ 2 edits)
- ✅ Structured result with result codes, subresults, timestamps, and execution time
- ✅ 53 Jest unit tests — fully offline (mocked `dns` + `net`)

---

## Project Structure

```
email-verification-module/
├── src/
│   ├── index.js          # Public API entry point
│   ├── verifyEmail.js    # Core verification pipeline
│   └── getDidYouMean.js  # Levenshtein typo detection
├── tests/
│   ├── verifyEmail.test.js     # 30 tests (syntax, SMTP codes, integration)
│   └── getDidYouMean.test.js   # 23 tests (algorithm + typo detection)
├── package.json
└── .gitignore
```

---

## Installation

```bash
git clone <repo-url>
cd email-verification-module
npm install
```

> No runtime dependencies. `npm install` only installs Jest (dev dependency).

---

## Usage

```js
const { verifyEmail, getDidYouMean } = require('./src/index');

// Full email verification
const result = await verifyEmail('user@gmail.com');
console.log(result);

// Typo detection only
const suggestion = getDidYouMean('user@gmial.com');
console.log(suggestion); // "user@gmail.com"
```

---

## API

### `verifyEmail(email)` → `Promise<Object>`

Runs the full verification pipeline: syntax → typo check → DNS MX → SMTP.

**Returns:**
```json
{
  "email": "user@example.com",
  "result": "valid",
  "resultcode": 1,
  "subresult": "mailbox_exists",
  "domain": "example.com",
  "mxRecords": ["mx1.example.com", "mx2.example.com"],
  "executiontime": 1.23,
  "didyoumean": null,
  "error": null,
  "timestamp": "2026-03-18T10:30:00.000Z"
}
```

**Result codes:**
| `result`  | `resultcode` | Meaning                        |
|-----------|:---:|---------------------------------|
| `valid`   | `1` | Mailbox confirmed to exist      |
| `unknown` | `3` | Could not confirm (greylisted, timeout, etc.) |
| `invalid` | `6` | Mailbox doesn't exist or syntax/DNS error |

**Subresults:**
| `subresult`               | Trigger                         |
|---------------------------|---------------------------------|
| `mailbox_exists`          | SMTP 2xx response               |
| `mailbox_does_not_exist`  | SMTP 550/553/554                |
| `greylisted`              | SMTP 450/451/452                |
| `connection_error`        | TCP error, timeout, SMTP 421    |
| `dns_error`               | MX lookup failed / no records   |
| `invalid_syntax`          | Regex / format check failed     |
| `typo_detected`           | Domain matched a known typo     |

---

### `getDidYouMean(email)` → `string | null`

Suggests a corrected email if the domain looks like a typo of a well-known provider (edit distance ≤ 2). Returns `null` if no suggestion.

```js
getDidYouMean('user@gmial.com')    // → "user@gmail.com"
getDidYouMean('user@yahooo.com')   // → "user@yahoo.com"
getDidYouMean('user@hotmial.com')  // → "user@hotmail.com"
getDidYouMean('user@outlok.com')   // → "user@outlook.com"
getDidYouMean('user@gmail.com')    // → null (exact match, no suggestion)
getDidYouMean('user@unknown.xyz')  // → null (too different)
```

**Supported domains:** `gmail.com`, `yahoo.com`, `hotmail.com`, `outlook.com`, `icloud.com`, `live.com`, `aol.com`, `protonmail.com`, `me.com`, `msn.com`, `ymail.com`, `googlemail.com`

---

## Running Tests

**Run all tests with coverage:**
```bash
npm test
```

**Run with verbose output (see each test case):**
```bash
npm test -- --verbose
```

**Run a single test file:**
```bash
npx jest tests/getDidYouMean.test.js --verbose
npx jest tests/verifyEmail.test.js --verbose
```

**Filter by test name:**
```bash
npx jest -t "typo"     # only typo-related tests
npx jest -t "550"      # only the SMTP 550 test
```

**Watch mode (re-runs on save):**
```bash
npx jest --watch
```

### Test Results

```
Test Suites: 2 passed, 2 total
Tests:       53 passed, 53 total
Time:        ~0.3 s
```

| Suite | Tests | Coverage |
|---|:---:|---|
| `verifyEmail.test.js` | 30 | Syntax validation, SMTP code interpretation, DNS errors, integration |
| `getDidYouMean.test.js` | 23 | Levenshtein algorithm, all assignment typos, edge cases |

> Coverage report is generated in `coverage/lcov-report/index.html` after running `npm test`.

---

## How It Works

### Verification Pipeline

```
verifyEmail(email)
  │
  ├─ 1. Syntax check  ──── fail ──→ { result: "invalid", subresult: "invalid_syntax" }
  │
  ├─ 2. Typo detection ─── found ─→ { result: "invalid", subresult: "typo_detected", didyoumean: "..." }
  │
  ├─ 3. DNS MX lookup ──── fail ──→ { result: "invalid", subresult: "dns_error" }
  │
  └─ 4. SMTP check (per MX server, in priority order)
         ├─ 2xx  → valid   / mailbox_exists
         ├─ 45x  → unknown / greylisted
         ├─ 55x  → invalid / mailbox_does_not_exist
         └─ err  → unknown / connection_error
```

### Levenshtein Distance

The typo detector uses the standard Wagner–Fischer dynamic programming algorithm. A suggestion is only made when the edit distance between the input domain and a known domain is **≤ 2**.

```js
levenshtein('gmial.com', 'gmail.com')   // → 2  ✅ suggested
levenshtein('outlok.com', 'outlook.com') // → 1  ✅ suggested
levenshtein('xyz123.com', 'gmail.com')  // → 7  ❌ no suggestion
```
