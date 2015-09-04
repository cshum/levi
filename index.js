var levelup = require('levelup')
var sublevel = require('sublevelup')
var transaction = require('level-transactions')
var ginga = require('ginga')
var xtend = require('xtend')
var H = require('highland')
// var iterate = require('./iterate')
// var through = require('through2')
var inherits = require('util').inherits
var EventEmitter = require('events').EventEmitter

var END = '\uffff'

var defaults = {
  db: process.browser ? require('leveldown') : require('level-js'),
  fields: { '*': true }
}
var override = {
  keyEncoding: 'utf8',
  valueEncoding: 'json'
}

// simpler ginga params middleware
function params () {
  var names = Array.prototype.slice.call(arguments)
  var len = names.length
  return function (ctx) {
    var l = Math.min(ctx.args.length, len)
    for (var i = 0; i < l; i++) ctx[names[i]] = ctx.args[i]
  }
}

function countTokens (tokens) {
  var counts = {}
  tokens.forEach(function (token) {
    counts[token] = (counts[token] || 0) + 1
  })
  return counts
}

function Levi (dir, opts) {
  if (!(this instanceof Levi)) return new Levi(dir, opts)
  opts = xtend(defaults, opts, override)

  var db = typeof dir === 'string' ?
    sublevel(levelup(dir, opts)) :
    sublevel(dir, opts)

  this.options = db.options
  this.store = db
  this.tokens = db.sublevel('tokens')
  this.tf = db.sublevel('tf')

  EventEmitter.call(this)
  this.setMaxListeners(Infinity)

  // store: key -> value
  // tokens: key -> tokens
  // inverse index: token!key -> tf
}

inherits(Levi, EventEmitter)

Levi.fn = ginga(Levi.prototype)

Levi.fn.define('get', params('key'), function (ctx, done) {
  this.store.get(ctx.key, done)
})

Levi.fn.define('pipeline', params('value'), function (ctx) {
  ctx.tokens = []
}, function (ctx, done) {
  done(null, ctx.tokens)
})

// todo pipeline plugins:
// tokenizer
// stemmer
// stopwords filtering

function pre (ctx, next) {
  ctx.options = xtend(this.options, ctx.options)
  ctx.tx = transaction(this.store)
  ctx.on('end', function (err) {
    if (err) ctx.tx.rollback(err)
  })

  if (
    ctx.key === '' ||
    ctx.key === null ||
    ctx.key === undefined
  ) return next(new Error('Key required.'))
  ctx.key = String(ctx.key)
  next()
}

function clean (ctx, next) {
  var self = this
  ctx.tx.get(ctx.key, function (err, value) {
    if (err && !err.notFound) return next(err)
    if (!value) return next()
    if (!ctx.value) ctx.value = value
    ctx.tx.del(ctx.key)
    // delete all tfs that contains key
    ctx.tx.get(ctx.key, { prefix: self.tokens }, function (err, tokens) {
      if (err) return next(err)
      tokens.forEach(function (token) {
        ctx.tx.del(token + '!' + ctx.key, { prefix: self.tf })
      })
      next()
    })
  })
}

function index (ctx, next) {
  var self = this
  if (!ctx.value) return next(new Error('Value required.'))
  if (typeof ctx.value === 'string') {
    // string value pipeline no fields
    this.pipeline(ctx.value, function (err, tokens) {
      if (err) return next(err)
      var total = tokens.length
      var counts = countTokens(counts)
      for (var token in counts) {
        ctx.tx.put(
          token + '!' + ctx.key,
          counts[token] / total,
          { prefix: self.tf }
        )
      }
      ctx.tx.put(
        ctx.key,
        Object.keys(counts),
        { prefix: self.tokens }
      )
      next()
    })
  } else {
    // field based pipeline
    var fields = ctx.options.fields
    var tfs = {}
    H(Object.keys(ctx.value))
    .map(function (field) {
      return {
        name: field,
        value: ctx.value[field],
        boost: Number(fields[field] || fields['*'])
      }
    })
    .filter(function (field) {
      return field.boost
    })
    .map(H.wrapCallback(function (field, cb) {
      self.pipeline(field.value, function (err, tokens) {
        if (err) return cb(err)
        var total = tokens.length
        var counts = countTokens(counts)
        var boost = field.boost
        for (var token in counts) {
          tfs[token] = (tfs[token] || 0) + (counts[token] / total * boost)
        }
        cb(null, field.name)
      })
    }))
    .series()
    .collect()
    .pull(function (err, fields) {
      if (err) return next(err)
      for (var token in tfs) {
        ctx.tx.put(token + '!' + ctx.key, tfs[token], { prefix: self.tf })
      }
      ctx.tx.put(ctx.key, Object.keys(tfs), { prefix: self.tokens })
      next()
    })
  }
}

function write (ctx, done) {
  ctx.tx.commit(done)
}

Levi.fn.define('del', params('key', 'options'), pre, clean, write)
Levi.fn.define('put', params('key', 'value', 'options'), pre, clean, index, write)
Levi.fn.define('index', params('key', 'options'), pre, clean, index, write)

Levi.fn.define('rebuildIndex', function (ctx, done) {
  // todo stream through store and .index(key)
})

Levi.fn.createSearchStream =
Levi.fn.searchStream = function (q, opts) {
  opts = xtend(this.options, opts)
  var self = this
  var limit = Number(opts.limit) > 0 ? opts.limit : Infinity
  var values = opts.values !== false
  H([].concat(q))
  .map(H.wrapCallback(function (q, cb) {
    // tokenize query
    self.pipeline(q, function (err, tokens) {
      if (err) return cb(err)
      cb(null, tokens)
    })
  }))
  .series()
  .flatten()
  .map(function (token) {
    return H(self.tf.createReadStream({
      gt: token + '!',
      lt: token + '!' + END
    }))
  })
  .reduce1() // todo union and idf
  .series()
  .sortBy(function (a, b) {
    return b.score - a.score
  })
  .map(H.wrapCallback(function (doc, cb) {
    if (values) {
      self.get(doc.key, function (err, val) {
        if (err) return cb(err)
        doc.value = val
        cb(null, doc)
      })
    } else {
      cb(null, doc)
    }
  }))
  .take(limit)
}

Levi.fn.createLiveStream =
Levi.fn.liveStream = function (q, opts) {
  opts = xtend(this.options, opts)
}

module.exports = Levi
