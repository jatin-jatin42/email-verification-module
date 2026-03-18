/**
 * getDidYouMean.js
 * Typo detection for email domains using Levenshtein distance.
 */

'use strict';

/**
 * List of common, well-known email domains to match against.
 */
const KNOWN_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'live.com',
  'aol.com',
  'protonmail.com',
  'me.com',
  'msn.com',
  'ymail.com',
  'googlemail.com',
];

/**
 * Computes the Levenshtein edit distance between two strings.
 * Uses standard dynamic programming (Wagner–Fischer algorithm).
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
function levenshtein(a, b) {
  const la = a.length;
  const lb = b.length;

  // Edge cases
  if (la === 0) return lb;
  if (lb === 0) return la;

  // Create a 2D matrix of size (la+1) x (lb+1)
  const matrix = Array.from({ length: la + 1 }, (_, i) =>
    Array.from({ length: lb + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[la][lb];
}

/**
 * Suggests a corrected email address if the domain looks like a common typo.
 *
 * @param {string} email - The email address to check
 * @returns {string|null} The corrected email (e.g. "user@gmail.com") or null if no suggestion
 */
function getDidYouMean(email) {
  if (!email || typeof email !== 'string') return null;

  const atIdx = email.lastIndexOf('@');
  if (atIdx === -1) return null;

  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1).toLowerCase();

  if (!local || !domain) return null;

  // If domain already matches a known domain exactly, no suggestion needed
  if (KNOWN_DOMAINS.includes(domain)) return null;

  let bestMatch = null;
  let bestDistance = Infinity;

  for (const known of KNOWN_DOMAINS) {
    const dist = levenshtein(domain, known);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestMatch = known;
    }
  }

  // Only suggest if edit distance is ≤ 2 (i.e., minor typo)
  if (bestDistance <= 2 && bestMatch !== null) {
    return `${local}@${bestMatch}`;
  }

  return null;
}

module.exports = { getDidYouMean, levenshtein, KNOWN_DOMAINS };
