/**
 * verifyEmail.js
 * Core email verification: syntax check, DNS MX lookup, raw SMTP handshake.
 */

'use strict';

const net = require('net');
const dns = require('dns');
const { getDidYouMean } = require('./getDidYouMean');

// Result codes
const RESULT_CODES = {
  valid: 1,
  unknown: 3,
  invalid: 6,
};

// Subresult labels
const SUBRESULTS = {
  MAILBOX_EXISTS: 'mailbox_exists',
  MAILBOX_NOT_EXIST: 'mailbox_does_not_exist',
  GREYLISTED: 'greylisted',
  CONNECTION_ERROR: 'connection_error',
  DNS_ERROR: 'dns_error',
  INVALID_SYNTAX: 'invalid_syntax',
  TYPO_DETECTED: 'typo_detected',
  DISPOSABLE: 'disposable',
  ROLE_ACCOUNT: 'role_account',
};

/**
 * Email syntax regex (RFC 5321 simplified):
 * - local part: alphanumeric + special chars, no leading/trailing dots
 * - exactly one @
 * - domain: labels separated by dots, each label 1-63 chars
 * - TLD: at least 2 chars
 * Max total length: 254 characters
 */
const EMAIL_REGEX = /^(?=[^@]{1,64}@)[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

/**
 * Validates the email syntax.
 *
 * @param {string} email
 * @returns {{ valid: boolean, reason: string|null }}
 */
function validateSyntax(email) {
  if (email === null || email === undefined) {
    return { valid: false, reason: 'Email is null or undefined' };
  }
  if (typeof email !== 'string') {
    return { valid: false, reason: 'Email must be a string' };
  }
  if (email.trim() === '') {
    return { valid: false, reason: 'Email is empty' };
  }
  if (email.length > 254) {
    return { valid: false, reason: 'Email exceeds maximum length of 254 characters' };
  }
  // Check for multiple @ symbols
  const atCount = (email.match(/@/g) || []).length;
  if (atCount > 1) {
    return { valid: false, reason: 'Email contains multiple @ symbols' };
  }
  if (!EMAIL_REGEX.test(email)) {
    return { valid: false, reason: 'Email format is invalid' };
  }
  return { valid: true, reason: null };
}

/**
 * Resolves MX records for a domain, sorted by priority (ascending).
 *
 * @param {string} domain
 * @returns {Promise<string[]>} Array of mail server hostnames
 */
async function getMxRecords(domain) {
  const records = await dns.promises.resolveMx(domain);
  records.sort((a, b) => a.priority - b.priority);
  return records.map((r) => r.exchange);
}

/**
 * Opens a raw TCP socket to the SMTP server and performs:
 *   EHLO → MAIL FROM → RCPT TO → QUIT
 * Parses the 3-digit SMTP reply code for RCPT TO.
 *
 * @param {string} email  - Recipient email to check
 * @param {string} mxHost - SMTP server hostname
 * @param {number} [timeoutMs=10000] - Socket timeout in ms
 * @returns {Promise<{ code: number, message: string }>}
 */
function smtpCheck(email, mxHost, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let stage = 'connect';
    let rcptCode = null;
    let rcptMessage = '';
    let settled = false;
    let buffer = '';

    const done = (err, result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch (_) {}
      if (err) reject(err);
      else resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.on('timeout', () => {
      done(new Error('SMTP_TIMEOUT'));
    });

    socket.on('error', (err) => {
      done(new Error(`SMTP_CONNECTION_ERROR: ${err.message}`));
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString();

      // Process complete lines (ending with \n)
      let lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete last fragment

      for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line) continue;

        // A complete SMTP reply: 3-digit code, then space or dash
        const match = line.match(/^(\d{3})[ -](.*)$/);
        if (!match) continue;

        // If code ends with '-' it is a multi-line continuation; wait for the
        // line with a space separator before reacting.
        if (line[3] === '-') continue;

        const code = parseInt(match[1], 10);
        const msg = match[2];

        if (stage === 'connect') {
          // Server greeting
          if (code === 220) {
            stage = 'ehlo';
            socket.write(`EHLO verify.local\r\n`);
          } else {
            done(new Error(`SMTP_UNEXPECTED_GREETING: ${code} ${msg}`));
          }
        } else if (stage === 'ehlo') {
          if (code === 250) {
            stage = 'mail_from';
            socket.write(`MAIL FROM:<verify@verify.local>\r\n`);
          } else {
            done(new Error(`SMTP_EHLO_FAILED: ${code} ${msg}`));
          }
        } else if (stage === 'mail_from') {
          // Some servers reject MAIL FROM with 550 too, treat as connection error
          if (code === 250 || (code >= 200 && code < 300)) {
            stage = 'rcpt_to';
            socket.write(`RCPT TO:<${email}>\r\n`);
          } else {
            done(new Error(`SMTP_MAIL_FROM_FAILED: ${code} ${msg}`));
          }
        } else if (stage === 'rcpt_to') {
          rcptCode = code;
          rcptMessage = msg;
          stage = 'quit';
          socket.write(`QUIT\r\n`);
        } else if (stage === 'quit') {
          done(null, { code: rcptCode, message: rcptMessage });
        }
      }
    });

    socket.connect(25, mxHost);
  });
}

/**
 * Interprets an SMTP RCPT TO response code into a result / subresult pair.
 *
 * @param {number} code
 * @returns {{ result: string, resultcode: number, subresult: string }}
 */
function interpretSmtpCode(code) {
  if (code >= 200 && code < 300) {
    // 2xx = accepted
    return { result: 'valid', resultcode: RESULT_CODES.valid, subresult: SUBRESULTS.MAILBOX_EXISTS };
  } else if (code === 450 || code === 451 || code === 452) {
    // Temporary failure — often greylisting
    return { result: 'unknown', resultcode: RESULT_CODES.unknown, subresult: SUBRESULTS.GREYLISTED };
  } else if (code === 421) {
    // Server not available
    return { result: 'unknown', resultcode: RESULT_CODES.unknown, subresult: SUBRESULTS.CONNECTION_ERROR };
  } else if (code === 550 || code === 551 || code === 553 || code === 554) {
    // Permanent failure — mailbox doesn't exist
    return { result: 'invalid', resultcode: RESULT_CODES.invalid, subresult: SUBRESULTS.MAILBOX_NOT_EXIST };
  } else if (code >= 400 && code < 500) {
    // Other 4xx = temporary, treat as unknown
    return { result: 'unknown', resultcode: RESULT_CODES.unknown, subresult: SUBRESULTS.CONNECTION_ERROR };
  } else if (code >= 500 && code < 600) {
    // Other 5xx = permanent failure
    return { result: 'invalid', resultcode: RESULT_CODES.invalid, subresult: SUBRESULTS.MAILBOX_NOT_EXIST };
  }
  // Unexpected code
  return { result: 'unknown', resultcode: RESULT_CODES.unknown, subresult: SUBRESULTS.CONNECTION_ERROR };
}

/**
 * Main verifyEmail function.
 * Validates syntax → typo check → DNS MX lookup → SMTP check.
 *
 * @param {string} email
 * @returns {Promise<Object>} Structured verification result
 */
async function verifyEmail(email) {
  const startTime = Date.now();

  const buildResult = (overrides) => ({
    email: email,
    result: 'unknown',
    resultcode: RESULT_CODES.unknown,
    subresult: SUBRESULTS.CONNECTION_ERROR,
    domain: null,
    mxRecords: [],
    executiontime: parseFloat(((Date.now() - startTime) / 1000).toFixed(2)),
    didyoumean: null,
    error: null,
    timestamp: new Date().toISOString(),
    ...overrides,
  });

  // ── Step 1: Syntax validation ──────────────────────────────────────────────
  const syntax = validateSyntax(email);
  if (!syntax.valid) {
    return buildResult({
      result: 'invalid',
      resultcode: RESULT_CODES.invalid,
      subresult: SUBRESULTS.INVALID_SYNTAX,
      error: syntax.reason,
    });
  }

  const domain = email.split('@')[1].toLowerCase();

  // ── Step 2: Typo detection ─────────────────────────────────────────────────
  const suggestion = getDidYouMean(email);
  if (suggestion) {
    return buildResult({
      email,
      result: 'invalid',
      resultcode: RESULT_CODES.invalid,
      subresult: SUBRESULTS.TYPO_DETECTED,
      domain,
      didyoumean: suggestion,
    });
  }

  // ── Step 3: DNS MX lookup ──────────────────────────────────────────────────
  let mxRecords = [];
  try {
    mxRecords = await getMxRecords(domain);
    if (mxRecords.length === 0) {
      return buildResult({
        result: 'invalid',
        resultcode: RESULT_CODES.invalid,
        subresult: SUBRESULTS.DNS_ERROR,
        domain,
        error: 'No MX records found for domain',
      });
    }
  } catch (err) {
    return buildResult({
      result: 'invalid',
      resultcode: RESULT_CODES.invalid,
      subresult: SUBRESULTS.DNS_ERROR,
      domain,
      error: `DNS lookup failed: ${err.message}`,
    });
  }

  // ── Step 4: SMTP verification ──────────────────────────────────────────────
  // Try each MX server in priority order until one responds
  for (const mxHost of mxRecords) {
    try {
      const smtpResult = await smtpCheck(email, mxHost);
      const interpreted = interpretSmtpCode(smtpResult.code);

      return buildResult({
        ...interpreted,
        domain,
        mxRecords,
      });
    } catch (err) {
      // SMTP_TIMEOUT or connection error — if more MX servers, try next
      const isLastServer = mxHost === mxRecords[mxRecords.length - 1];
      if (isLastServer) {
        return buildResult({
          result: 'unknown',
          resultcode: RESULT_CODES.unknown,
          subresult: SUBRESULTS.CONNECTION_ERROR,
          domain,
          mxRecords,
          error: err.message,
        });
      }
      // else: continue to next MX
    }
  }

  // Fallback (should not be reached)
  return buildResult({ domain, mxRecords });
}

module.exports = {
  verifyEmail,
  validateSyntax,
  getMxRecords,
  smtpCheck,
  interpretSmtpCode,
  RESULT_CODES,
  SUBRESULTS,
};
