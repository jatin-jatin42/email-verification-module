/**
 * tests/verifyEmail.test.js
 * Comprehensive unit tests for verifyEmail() and its helpers.
 * Uses Jest mocking to avoid real network I/O.
 */

'use strict';

// ── Mock dns and net BEFORE requiring the module under test ──────────────────
jest.mock('dns');
jest.mock('net');

const dns = require('dns');
const net = require('net');
const { EventEmitter } = require('events');

const {
  verifyEmail,
  validateSyntax,
  interpretSmtpCode,
  RESULT_CODES,
  SUBRESULTS,
} = require('../src/verifyEmail');

// ────────────────────────────────────────────────────────────────────────────
// Helper: build a fake net.Socket that emits data in a scripted sequence
// ────────────────────────────────────────────────────────────────────────────
function buildMockSocket(sequence) {
  const emitter = new EventEmitter();
  emitter.setTimeout = jest.fn();
  emitter.write = jest.fn((data) => {
    // After each write(), emit the next server response line (if any)
    const next = sequence.shift();
    if (next === 'TIMEOUT') {
      process.nextTick(() => emitter.emit('timeout'));
    } else if (next) {
      process.nextTick(() => emitter.emit('data', Buffer.from(next)));
    }
  });
  emitter.connect = jest.fn((port, host) => {
    // Emit the initial server greeting
    const greeting = sequence.shift();
    process.nextTick(() => emitter.emit('data', Buffer.from(greeting)));
  });
  emitter.destroy = jest.fn();
  return emitter;
}

// ════════════════════════════════════════════════════════════════════════════
//  1. SYNTAX VALIDATION TESTS
// ════════════════════════════════════════════════════════════════════════════
describe('validateSyntax()', () => {
  test('✅ Valid: standard email address', () => {
    expect(validateSyntax('user@example.com').valid).toBe(true);
  });

  test('✅ Valid: email with plus tag', () => {
    expect(validateSyntax('user+tag@sub.domain.com').valid).toBe(true);
  });

  test('✅ Valid: email with dots in local part', () => {
    expect(validateSyntax('first.last@example.org').valid).toBe(true);
  });

  test('❌ Invalid: missing @ symbol', () => {
    const r = validateSyntax('notanemail');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/invalid/i);
  });

  test('❌ Invalid: missing local part (@nodomain.com)', () => {
    expect(validateSyntax('@nodomain.com').valid).toBe(false);
  });

  test('❌ Invalid: missing domain (user@)', () => {
    expect(validateSyntax('user@').valid).toBe(false);
  });

  test('❌ Invalid: multiple @ symbols', () => {
    const r = validateSyntax('user@@double.com');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/multiple/i);
  });

  test('❌ Invalid: empty string', () => {
    const r = validateSyntax('');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/empty/i);
  });

  test('❌ Invalid: null input', () => {
    const r = validateSyntax(null);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/null|undefined/i);
  });

  test('❌ Invalid: undefined input', () => {
    const r = validateSyntax(undefined);
    expect(r.valid).toBe(false);
  });

  test('❌ Invalid: email exceeding 254 characters', () => {
    const longLocal = 'a'.repeat(245);
    const r = validateSyntax(`${longLocal}@example.com`);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/length/i);
  });

  test('❌ Invalid: double dots in local part', () => {
    expect(validateSyntax('..double@dot.com').valid).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  2. interpretSmtpCode() TESTS
// ════════════════════════════════════════════════════════════════════════════
describe('interpretSmtpCode()', () => {
  test('250 → valid / mailbox_exists', () => {
    const r = interpretSmtpCode(250);
    expect(r.result).toBe('valid');
    expect(r.resultcode).toBe(RESULT_CODES.valid);
    expect(r.subresult).toBe(SUBRESULTS.MAILBOX_EXISTS);
  });

  test('550 → invalid / mailbox_does_not_exist', () => {
    const r = interpretSmtpCode(550);
    expect(r.result).toBe('invalid');
    expect(r.resultcode).toBe(RESULT_CODES.invalid);
    expect(r.subresult).toBe(SUBRESULTS.MAILBOX_NOT_EXIST);
  });

  test('553 → invalid / mailbox_does_not_exist', () => {
    expect(interpretSmtpCode(553).result).toBe('invalid');
  });

  test('450 → unknown / greylisted', () => {
    const r = interpretSmtpCode(450);
    expect(r.result).toBe('unknown');
    expect(r.resultcode).toBe(RESULT_CODES.unknown);
    expect(r.subresult).toBe(SUBRESULTS.GREYLISTED);
  });

  test('421 → unknown / connection_error', () => {
    const r = interpretSmtpCode(421);
    expect(r.result).toBe('unknown');
    expect(r.subresult).toBe(SUBRESULTS.CONNECTION_ERROR);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  3. verifyEmail() INTEGRATION TESTS (mocked dns + net)
// ════════════════════════════════════════════════════════════════════════════
describe('verifyEmail()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Syntax failures ────────────────────────────────────────────────────────
  test('Returns invalid for empty string', async () => {
    const result = await verifyEmail('');
    expect(result.result).toBe('invalid');
    expect(result.subresult).toBe(SUBRESULTS.INVALID_SYNTAX);
  });

  test('Returns invalid for null', async () => {
    const result = await verifyEmail(null);
    expect(result.result).toBe('invalid');
    expect(result.subresult).toBe(SUBRESULTS.INVALID_SYNTAX);
  });

  test('Returns invalid for undefined', async () => {
    const result = await verifyEmail(undefined);
    expect(result.result).toBe('invalid');
    expect(result.subresult).toBe(SUBRESULTS.INVALID_SYNTAX);
  });

  test('Returns invalid for very long email', async () => {
    const longEmail = 'a'.repeat(245) + '@example.com';
    const result = await verifyEmail(longEmail);
    expect(result.result).toBe('invalid');
  });

  test('Returns invalid for multiple @ symbols', async () => {
    const result = await verifyEmail('a@@example.com');
    expect(result.result).toBe('invalid');
  });

  // ── Typo detection ─────────────────────────────────────────────────────────
  test('Detects typo gmial.com → returns typo_detected and didyoumean', async () => {
    const result = await verifyEmail('user@gmial.com');
    expect(result.result).toBe('invalid');
    expect(result.subresult).toBe(SUBRESULTS.TYPO_DETECTED);
    expect(result.didyoumean).toBe('user@gmail.com');
  });

  // ── DNS failure ────────────────────────────────────────────────────────────
  test('Returns invalid/dns_error when MX lookup fails', async () => {
    dns.promises = {
      resolveMx: jest.fn().mockRejectedValue(new Error('ENOTFOUND')),
    };

    const result = await verifyEmail('user@nonexistent-domain-xyz.com');
    expect(result.result).toBe('invalid');
    expect(result.subresult).toBe(SUBRESULTS.DNS_ERROR);
    expect(result.error).toMatch(/DNS lookup failed/);
  });

  // ── SMTP: 550 → invalid ───────────────────────────────────────────────────
  test('550 SMTP response → invalid / mailbox_does_not_exist', async () => {
    dns.promises = {
      resolveMx: jest.fn().mockResolvedValue([{ exchange: 'mx.example.com', priority: 10 }]),
    };

    net.Socket = jest.fn().mockImplementation(() =>
      buildMockSocket([
        '220 mx.example.com ESMTP\r\n',
        '250 OK\r\n',
        '250 OK\r\n',
        '550 5.1.1 User does not exist\r\n',
        '221 Bye\r\n',
      ])
    );

    const result = await verifyEmail('ghost@example.com');
    expect(result.result).toBe('invalid');
    expect(result.subresult).toBe(SUBRESULTS.MAILBOX_NOT_EXIST);
    expect(result.mxRecords).toContain('mx.example.com');
  });

  // ── SMTP: 450 → unknown ───────────────────────────────────────────────────
  test('450 SMTP response → unknown / greylisted', async () => {
    dns.promises = {
      resolveMx: jest.fn().mockResolvedValue([{ exchange: 'mx.example.com', priority: 10 }]),
    };

    net.Socket = jest.fn().mockImplementation(() =>
      buildMockSocket([
        '220 mx.example.com ESMTP\r\n',
        '250 OK\r\n',
        '250 OK\r\n',
        '450 4.2.0 Try again later\r\n',
        '221 Bye\r\n',
      ])
    );

    const result = await verifyEmail('user@example.com');
    expect(result.result).toBe('unknown');
    expect(result.subresult).toBe(SUBRESULTS.GREYLISTED);
  });

  // ── SMTP: connection timeout / error → unknown ────────────────────────────
  test('Connection timeout → unknown / connection_error', async () => {
    dns.promises = {
      resolveMx: jest.fn().mockResolvedValue([{ exchange: 'mx.example.com', priority: 10 }]),
    };

    // Simulate a connection-refused / network error on connect()
    net.Socket = jest.fn().mockImplementation(() => {
      const emitter = new EventEmitter();
      emitter.setTimeout = jest.fn();
      emitter.write = jest.fn();
      emitter.destroy = jest.fn();
      emitter.connect = jest.fn(() => {
        // Emit an error synchronously on the next tick to simulate timeout/refusal
        process.nextTick(() => emitter.emit('error', new Error('ECONNREFUSED')));
      });
      return emitter;
    });

    const result = await verifyEmail('user@example.com');
    expect(result.result).toBe('unknown');
    expect(result.subresult).toBe(SUBRESULTS.CONNECTION_ERROR);
  }, 10000);

  // ── SMTP: 250 → valid ─────────────────────────────────────────────────────
  test('250 SMTP response → valid / mailbox_exists', async () => {
    dns.promises = {
      resolveMx: jest.fn().mockResolvedValue([{ exchange: 'mx.example.com', priority: 10 }]),
    };

    net.Socket = jest.fn().mockImplementation(() =>
      buildMockSocket([
        '220 mx.example.com ESMTP\r\n',
        '250 OK\r\n',
        '250 OK\r\n',
        '250 2.1.5 OK\r\n',
        '221 Bye\r\n',
      ])
    );

    const result = await verifyEmail('real@example.com');
    expect(result.result).toBe('valid');
    expect(result.subresult).toBe(SUBRESULTS.MAILBOX_EXISTS);
    expect(result.resultcode).toBe(1);
  });

  // ── Result structure ──────────────────────────────────────────────────────
  test('Result contains all required fields', async () => {
    const result = await verifyEmail('');  // syntax error for fast completion
    expect(result).toHaveProperty('email');
    expect(result).toHaveProperty('result');
    expect(result).toHaveProperty('resultcode');
    expect(result).toHaveProperty('subresult');
    expect(result).toHaveProperty('domain');
    expect(result).toHaveProperty('mxRecords');
    expect(result).toHaveProperty('executiontime');
    expect(result).toHaveProperty('didyoumean');
    expect(result).toHaveProperty('error');
    expect(result).toHaveProperty('timestamp');
  });

  test('timestamp is a valid ISO 8601 string', async () => {
    const result = await verifyEmail('');
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  test('executiontime is a non-negative number', async () => {
    const result = await verifyEmail('');
    expect(typeof result.executiontime).toBe('number');
    expect(result.executiontime).toBeGreaterThanOrEqual(0);
  });
});
