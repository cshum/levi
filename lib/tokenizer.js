var ginga = require('ginga')
var H = require('highland')

var SEP = /[\|' \.,\-|(\n)]+/

module.exports = function tokenizer (sep) {
  sep = sep || SEP

  return ginga().use('pipeline', function (ctx) {
    // tokenizer
    if (Array.isArray(ctx.value)) {
      ctx.tokens = H(ctx.value.slice)
    } else if (
      ctx.value === null || ctx.value === undefined
    ) {
      ctx.tokens = H([])
    } else {
      ctx.tokens = H(String(ctx.value).trim().split(SEP))
    }

    ctx.tokens = ctx.tokens.map(function (token) {
      return String(token).toLowerCase()
    })
  })
}
