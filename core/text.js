'use strict';
/* One folding rule for identity, search and duplicate keys.
 *
 * "Björk" and "Bjork" are the same artist, "Ácido" and "acido" the same word. Stripping
 * non-ASCII characters instead of folding them turned them into "bj rk" and "cido", which
 * never matched what people type. This module is the single place that decides.
 */
function fold(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function foldLower(value) {
  return fold(value).toLowerCase();
}

module.exports = { fold, foldLower };
