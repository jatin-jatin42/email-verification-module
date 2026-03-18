/**
 * tests/getDidYouMean.test.js
 * Unit tests for getDidYouMean() and levenshtein().
 */

'use strict';

const { getDidYouMean, levenshtein, KNOWN_DOMAINS } = require('../src/getDidYouMean');

// ════════════════════════════════════════════════════════════════════════════
//  1. levenshtein() — core algorithm correctness
// ════════════════════════════════════════════════════════════════════════════
describe('levenshtein()', () => {
  test('Distance between identical strings is 0', () => {
    expect(levenshtein('gmail.com', 'gmail.com')).toBe(0);
  });

  test('Distance between empty string and non-empty is the length of non-empty', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  test('Single character substitution gives distance 1', () => {
    expect(levenshtein('gmial.com', 'gmail.com')).toBe(2); // transposition = 2 ops
  });

  test('Single character insertion gives distance 1', () => {
    expect(levenshtein('yahooo.com', 'yahoo.com')).toBe(1);
  });

  test('Two character differences give distance 2', () => {
    expect(levenshtein('hotmial.com', 'hotmail.com')).toBe(2);
  });

  test('Completely different strings give large distance', () => {
    expect(levenshtein('xyz123.com', 'gmail.com')).toBeGreaterThan(2);
  });

  test('outlok.com → outlook.com has distance 1', () => {
    expect(levenshtein('outlok.com', 'outlook.com')).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  2. getDidYouMean() — typo detection
// ════════════════════════════════════════════════════════════════════════════
describe('getDidYouMean()', () => {
  // Required typos from assignment spec
  test('gmial.com → gmail.com', () => {
    expect(getDidYouMean('user@gmial.com')).toBe('user@gmail.com');
  });

  test('yahooo.com → yahoo.com', () => {
    expect(getDidYouMean('user@yahooo.com')).toBe('user@yahoo.com');
  });

  test('hotmial.com → hotmail.com', () => {
    expect(getDidYouMean('user@hotmial.com')).toBe('user@hotmail.com');
  });

  test('outlok.com → outlook.com', () => {
    expect(getDidYouMean('user@outlok.com')).toBe('user@outlook.com');
  });

  // No suggestion for exact matches
  test('Exact match gmail.com → returns null (no suggestion needed)', () => {
    expect(getDidYouMean('user@gmail.com')).toBeNull();
  });

  test('Exact match yahoo.com → returns null', () => {
    expect(getDidYouMean('user@yahoo.com')).toBeNull();
  });

  // Preserves local part
  test('Preserves the local part of the email in suggestion', () => {
    const result = getDidYouMean('john.doe+tag@gmial.com');
    expect(result).toBe('john.doe+tag@gmail.com');
  });

  // Distance > 2 → no suggestion  
  test('Completely different domain → returns null', () => {
    expect(getDidYouMean('user@completelyunknown.org')).toBeNull();
  });

  // Edge cases
  test('Null input → returns null', () => {
    expect(getDidYouMean(null)).toBeNull();
  });

  test('Undefined input → returns null', () => {
    expect(getDidYouMean(undefined)).toBeNull();
  });

  test('Email with no @ sign → returns null', () => {
    expect(getDidYouMean('notanemail')).toBeNull();
  });

  test('Empty string → returns null', () => {
    expect(getDidYouMean('')).toBeNull();
  });

  // Domain case insensitivity
  test('Domain comparison is case-insensitive (GMIAL.COM)', () => {
    expect(getDidYouMean('user@GMIAL.COM')).toBe('user@gmail.com');
  });

  // icloud typo
  test('iclod.com → icloud.com', () => {
    expect(getDidYouMean('user@iclod.com')).toBe('user@icloud.com');
  });

  // protonmail typo
  test('protonmai.com → protonmail.com', () => {
    expect(getDidYouMean('user@protonmai.com')).toBe('user@protonmail.com');
  });
});
