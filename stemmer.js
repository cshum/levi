var ginga = require('ginga')
var H = require('highland')
var porterStemmer = require('porter-stemmer').stemmer

module.exports = function stemmer (fn) {
  fn = fn || porterStemmer

  return ginga().use('pipeline', function (ctx) {
    // porter-stemmer
    ctx.tokens = H(ctx.tokens).map(fn)
  })
}
