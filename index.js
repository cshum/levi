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

// ginga params middleware
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

  // meta: size -> N
  // store: key -> value
  // tokens: key -> tokens
  // tfidf: token! -> nt
  // tfidf: token!key -> tf
  // To calculate: idf = log(1 + N/nt)

  this.store = db
  this.meta = db.sublevel('meta')
  this.tokens = db.sublevel('tokens')
  this.tfidf = db.sublevel('tfidf')

  EventEmitter.call(this)
  this.setMaxListeners(Infinity)
}

// todo: calculate idf

// Pipeline plugins
Levi.tokenizer = require('./tokenizer')
Levi.stemmer = require('./stemmer')
Levi.stopword = require('./stopword')

inherits(Levi, EventEmitter)
Levi.fn = ginga(Levi.prototype)

Levi.fn.define('get', params('key'), function (ctx, done) {
  this.store.get(ctx.key, done)
})

Levi.fn.define('pipeline', params('value'), function (ctx, done) {
  if (!ctx.tokens) {
    return done(new Error('Missing tokenization pipeline.'))
  }
  H(ctx.tokens).collect().pull(done)
})

// prepare transaction and checks
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

// clean up old index
function del (ctx, next) {
  var self = this
  ctx.tx.get(ctx.key, function (err, value) {
    if (err && !err.notFound) return next(err)
    // skip if not exists
    if (!value) return next()
    // keep value if reindexing
    if (!ctx.value) ctx.value = value
    // del store item
    ctx.tx.del(ctx.key)
    // decrement size
    ctx.tx.get('size', { prefix: self.meta }, function (err, size) {
      // size must be gt 0 here
      ctx.tx.put('size', size - 1, { prefix: self.meta })
    })
    // delete all tfs that contains key
    ctx.tx.get(ctx.key, { prefix: self.tokens }, function (err, tokens) {
      if (err) return next(err)
      tokens.forEach(function (token) {
        // decrement nt
        ctx.tx.get(token + '!', { prefix: self.tfidf }, function (err, nt) {
          ctx.tx.put(token + '!', nt - 1, { prefix: self.tfidf })
        })
        // del tf
        ctx.tx.del(token + '!' + ctx.key, { prefix: self.tfidf })
      })
      next()
    })
  })
}

// put new index
function put (ctx, next) {
  var self = this
  if (!ctx.value) return next(new Error('Value required.'))

  // increment size
  ctx.tx.get('size', { prefix: self.meta }, function (err, size) {
    ctx.tx.put('size', (size || 0) + 1, { prefix: self.meta })
  })
  // put store item
  ctx.tx.put(ctx.key, ctx.value)

  if (typeof ctx.value === 'string') {
    // string value pipeline no fields
    this.pipeline(ctx.value, function (err, tokens) {
      if (err) return next(err)
      var total = tokens.length
      var counts = countTokens(tokens)
      var uniqs = Object.keys(counts)
      uniqs.forEach(function (token) {
        // increment nt
        ctx.tx.get(token + '!', { prefix: self.tfidf }, function (err, nt) {
          ctx.tx.put(token + '!', (nt || 0) + 1, { prefix: self.tfidf })
        })
        // put tf
        ctx.tx.put(token + '!' + ctx.key, counts[token] / total, { prefix: self.tfidf })
      })
      // put tokens
      ctx.tx.put(ctx.key, uniqs, { prefix: self.tokens })
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
        var counts = countTokens(tokens)
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
      var uniqs = Object.keys(tfs)
      uniqs.forEach(function (token) {
        // increment nt
        ctx.tx.get(token + '!', { prefix: self.tfidf }, function (err, nt) {
          ctx.tx.put(token + '!', (nt || 0) + 1, { prefix: self.tfidf })
        })
        // put tf
        ctx.tx.put(token + '!' + ctx.key, tfs[token], { prefix: self.tfidf })
      })
      // put tokens
      ctx.tx.put(ctx.key, uniqs, { prefix: self.tokens })
      next()
    })
  }
}

// commit index write 
function write (ctx, done) {
  ctx.tx.commit(done)
}

Levi.fn.define('del', params('key', 'options'), pre, del, write)
Levi.fn.define('put', params('key', 'value', 'options'), pre, del, put, write)
Levi.fn.define('index', params('key', 'options'), pre, del, put, write)

Levi.fn.define('rebuildIndex', function (ctx, done) {
  // todo stream through store and .index(key)
})

Levi.fn.createSearchStream =
Levi.fn.searchStream = function (q, opts) {
  opts = xtend(this.options, opts)
  var self = this
  var offset = Number(opts.offset) > 0 ? opts.offset : 0
  var limit = Number(opts.limit) > 0 ? opts.limit : Infinity
  var values = opts.values !== false

  H(function (push, next) {
    // pipeline query
    self.pipeline(q, function (err, tokens) {
      if (err) return push(err)
      next(H(tokens))
    })
  })
  .map(function (token) {
    return H(self.tfidf.createReadStream({
      gte: token + '!',
      lt: token + '!' + END
    }))
  })
  .reduce1() // todo union and idf
  .series()
  .sortBy(function (a, b) {
    return b.score - a.score
  })
  .drop(offset)
  .take(limit)
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
}

Levi.fn.createLiveStream =
Levi.fn.liveStream = function (q, opts) {
  opts = xtend(this.options, opts)
}

module.exports = Levi
