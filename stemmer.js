var ginga = require('ginga')
var H = require('highland')
var stemmer = require('porter-stemmer').stemmer

ginga(module.exports).use('pipeline', function (ctx) {
  // porter-stemmer
  ctx.tokens = H(ctx.tokens).map(stemmer)
})
