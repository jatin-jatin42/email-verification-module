/**
 * index.js — Public API entry point for email-verification-module
 */

'use strict';

const { verifyEmail, validateSyntax, RESULT_CODES, SUBRESULTS } = require('./verifyEmail');
const { getDidYouMean, levenshtein } = require('./getDidYouMean');

module.exports = {
  verifyEmail,
  getDidYouMean,
  // Expose helpers for advanced usage / testing
  validateSyntax,
  levenshtein,
  RESULT_CODES,
  SUBRESULTS,
};
