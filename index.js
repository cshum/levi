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
  var counts = {}
  ctx.tokens.forEach(function (token) {
    counts[token] = (counts[token] || 0) + 1
  })
  done(null, {
    tokens: ctx.tokens,
    counts: counts
  })
})

// todo pipeline plugins:
// tokenizer
// stemmer
// stopwords filtering

function pre (ctx) {
  ctx.options = xtend(this.options, ctx.options)
  ctx.tx = transaction(this.store)
  ctx.on('end', function () {
    ctx.tx.rollback()
  })
}

function clean (ctx, next) {
  var self = this
  ctx.tx.get(ctx.key, function (err, value) {
    if (err && !err.notFound) return next(err)
    if (!value) return next()
    ctx.value = value
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
  if (typeof ctx.value === 'string') {
    // string value pipeline no fields
    this.pipeline(ctx.value, function (err, result) {
      if (err) return next(err)
      var total = result.tokens.length
      var counts = result.counts
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
      self.pipeline(field.value, function (err, result) {
        if (err) return cb(err)
        var total = result.tokens.length
        var counts = result.counts
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

function commit (ctx, done) {
  ctx.tx.commit(done)
}

Levi.fn.define('del', params('key', 'options'), pre, clean, commit)
Levi.fn.define('put', params('key', 'value', 'options'), pre, clean, index, commit)
Levi.fn.define('index', params('key', 'options'), pre, clean, index, commit)

Levi.fn.define('rebuildIndex', function (ctx, done) {
  // todo stream through store and .index(key)
})

Levi.fn.createSearchStream =
Levi.fn.searchStream = function (q, opts) {
  opts = xtend(this.options, opts)
  var self = this
  var limit = Number(opts.limit) > 0 ? opts.limit : Infinity
  var values = !!opts.values
  H([].concat(q))
  .map(H.wrapCallback(function (q, cb) {
    // tokenize query
    self.pipeline(q, function (err, result) {
      if (err) return cb(err)
      cb(null, result.tokens)
    })
  }))
  .series()
  .flatten()
  .map(function (token) {
    H(self.tf.createReadStream({
      gt: token + '!',
      lt: token + '!' + END
    }))
    .map()
    // todo: union and idf stuff
  })
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
