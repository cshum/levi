var levelup = require('levelup')
var sublevel = require('sublevelup')
var transaction = require('level-transactions')
var ginga = require('ginga')
var xtend = require('xtend')
var H = require('highland')
var inherits = require('util').inherits
var EventEmitter = require('events').EventEmitter
var extract = require('./util/extract')
var sort = require('./util/sort')
var group = require('./util/group')
var similarity = require('./util/similarity')

var END = '\uffff'

var defaults = {
  db: process.browser ? require('level-js') : require('leveldown'),
  fields: { '*': true }
}
var override = {
  keyEncoding: 'utf8',
  valueEncoding: 'json'
}

function Levi (dir, opts) {
  if (!(this instanceof Levi)) return new Levi(dir, opts)
  opts = xtend(defaults, opts, override)

  var db = typeof dir === 'string'
    ? sublevel(levelup(dir, opts))
    : sublevel(dir, opts)

  this.options = db.options

  // meta: size -> N
  // store: key -> value
  // tokens: key -> tokens
  // weight: token! -> nt
  // weight: token!key -> tf

  this.store = db
  this.meta = db.sublevel('mt')
  this.tokens = db.sublevel('tk')
  this.weight = db.sublevel('wt')

  EventEmitter.call(this)
  this.setMaxListeners(Infinity)
}

// Pipeline plugins
Levi.tokenizer = require('./tokenizer')
Levi.stemmer = require('./stemmer')
Levi.stopword = require('./stopword')

function countTokens (tokens) {
  var counts = {}
  for (var i = 0, l = tokens.length; i < l; i++) {
    var token = tokens[i]
    counts[token] = (counts[token] || 0) + 1
  }
  return counts
}
// ginga params middleware factory
function params () {
  var names = Array.prototype.slice.call(arguments)
  var len = names.length
  return function (ctx) {
    var l = Math.min(ctx.args.length, len)
    for (var i = 0; i < l; i++) ctx[names[i]] = ctx.args[i]
  }
}

inherits(Levi, EventEmitter)
Levi.fn = ginga(Levi.prototype)

Levi.fn.define('get', params('key', 'options'), function (ctx, done) {
  this.store.get(ctx.key, xtend(this.options, ctx.options), done)
})

Levi.fn.define('pipeline', params('value'), function (ctx) {
  // init with highland stream
  ctx.tokens = H(extract(ctx.value))
  delete ctx.value
}, function (ctx, done) {
  // finalize with trimming and padding
  H(ctx.tokens)
  .reject(function (token) {
    return (
      typeof token !== 'string' ||
      token.trim() === ''
    )
  })
  .map(function (token) {
    // prevent conflict with js reserved words
    return '@' + token
  })
  .collect()
  .pull(done)
})

function pre (ctx, next) {
  ctx.options = xtend(this.options, ctx.options)

  // prepare transaction
  ctx.tx = transaction(this.store)
  // tx increment
  ctx.tx.incr = function (key, options, cb) {
    this.get(key, options, function (err, val) {
      if (err && !err.notFound) return next(err)
      val = (val || 0) + 1
      if (cb) cb(null, val)
      this.put(key, val, options)
    })
  }
  // tx decrement
  ctx.tx.decr = function (key, options, cb) {
    this.get(key, options, function (err, val) {
      if (err && !err.notFound) return next(err)
      val = (val || 0) - 1
      if (cb) cb(null, val)
      if (val === 0) this.del(key, options)
      else this.put(key, val, options)
    })
  }
  ctx.on('end', function (err) {
    if (err) ctx.tx.rollback(err)
  })

  // key check
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
  if (!ctx.value) {
    ctx.on('end', function (err) {
      if (err) return
      self.emit('del', { key: ctx.key })
    })
  }
  ctx.tx.get(ctx.key, function (err, value) {
    if (err && !err.notFound) return next(err)
    // skip if not exists
    if (!value) return next()
    // keep value if reindexing
    if (!ctx.value) ctx.value = value
    // del store item
    ctx.tx.del(ctx.key)
    // decrement size
    ctx.tx.decr('size', { prefix: self.meta })
    // delete all tfs that contains key
    ctx.tx.get(ctx.key, { prefix: self.tokens }, function (err, tokens) {
      if (err) return next(err)
      tokens.forEach(function (token) {
        // decrement nt
        ctx.tx.decr(token + '!', { prefix: self.weight })
        // del tf
        ctx.tx.del(token + '!' + ctx.key, { prefix: self.weight })
      })
      // delete tokens
      ctx.tx.del(ctx.key, { prefix: self.tokens })
      next()
    })
  })
}

// put new index
function put (ctx, next) {
  var self = this

  if (!ctx.value) return next(new Error('Value required.'))
  if (Buffer.isBuffer(ctx.value)) {
    ctx.value = ctx.value.toString('binary')
  }

  // result for emitter
  var result = {
    key: ctx.key,
    value: ctx.value,
    nts: {}
  }
  ctx.on('end', function (err) {
    if (err) return
    self.emit('put', { key: ctx.key, value: ctx.value })
    self.emit('_write', result)
  })

  // increment size
  ctx.tx.incr('size', { prefix: self.meta }, function (err, val) {
    if (err) return next(err)
    result.size = val
  })
  // put store item
  ctx.tx.put(ctx.key, ctx.value)

  var value
  if (typeof ctx.value === 'string') {
    // string means no field boost
    value = { '*': ctx.value }
  } else {
    value = ctx.value
  }

  var tfs = {}

  // init tf all fields zero
  var tfInit = {}
  for (var field in value) tfInit[field] = 0

  H(Object.keys(value))
  .map(H.wrapCallback(function (field, cb) {
    self.pipeline(value[field], function (err, tokens) {
      if (err) return cb(err)
      var total = tokens.length
      var counts = countTokens(tokens)
      for (var token in counts) {
        tfs[token] = tfs[token] || xtend(tfInit)
        tfs[token][field] = counts[token] / total
      }
      cb(null, field)
    })
  }))
  .series()
  .collect()
  .pull(function (err, fields) {
    if (err) return next(err)
    var uniqs = Object.keys(tfs)
    uniqs.forEach(function (token) {
      // increment nt
      ctx.tx.incr(token + '!', { prefix: self.weight }, function (err, val) {
        if (err) return next(err)
        result.nts[token] = val
      })
      // put tf object
      ctx.tx.put(token + '!' + ctx.key, tfs[token], { prefix: self.weight })
    })
    result.tfs = tfs
    // put tokens
    ctx.tx.put(ctx.key, uniqs, { prefix: self.tokens })

    next()
  })
}

// commit index write
function write (ctx, done) {
  ctx.tx.commit(done)
}

Levi.fn.define('del', params('key', 'options'), pre, del, write)
Levi.fn.define('put', params('key', 'value', 'options'), pre, del, put, write)
Levi.fn.define('reindex', params('key', 'options'), pre, del, put, write)

Levi.fn.createReadStream =
Levi.fn.readStream = function (opts) {
  return H(this.store.createReadStream(
    xtend(this.options, opts)
  ))
}

Levi.fn.createSearchStream =
Levi.fn.searchStream = function (q, opts) {
  opts = xtend(this.options, opts)
  var self = this
  var values = opts.values !== false
  var fields = opts.fields || { '*': 1 }
  var offset = Number(opts.offset) > 0 ? opts.offset : 0
  var limit = Number(opts.limit) > 0 ? opts.limit : Infinity

  var N
  var query = {}

  return H(function (push, next) {
    // pipeline query
    self.pipeline(q, function (err, tokens) {
      if (err) return push(err)
      var total = tokens.length
      var counts = countTokens(tokens)
      var uniqs = Object.keys(counts)
      uniqs.forEach(function (token) {
        // calculate tf for query
        query[token] = counts[token] / total
      })
      // get N
      self.meta.get('size', function (err, size) {
        if (err && !err.notFound) return push(err)
        if (!size) return next(H([]))
        N = size
        next(H(uniqs))
      })
    })
  })
  .map(function (token) {
    var idf
    var len = token.length + 1 // token! length

    return H(self.weight.createReadStream({
      gte: token + '!',
      lt: token + '!' + END
    }))
    .map(function (data) {
      if (idf === undefined) {
        // retrieve nt, tfidf for query
        var nt = data.value
        // idf smooth
        idf = Math.log(1 + N / nt)

        // tfidf for query
        query[token] *= idf
      } else {
        // retrieve tf, tfidf with field boost for result
        // tfidf group by fields
        var tfidf = {}
        for (var field in data.value) {
          var tf = data.value[field]
          tfidf[field] = tf * idf
        }
        return {
          token: token,
          key: data.key.slice(len),
          tfidf: tfidf
        }
      }
    })
    .filter(function (data) {
      return !!data
    })
  })
  .reduce1(sort) // merge sort since weight sorted by key
  .series()
  .through(group) // group by key
  .map(function (data) {
    // tfidf group by fields, tokens
    // tfidf[field] becomes term vector
    var tfidf = {}
    data.forEach(function (item) {
      for (var field in item.tfidf) {
        tfidf[field] = tfidf[field] || {}
        tfidf[field][item.token] = item.tfidf[field]
      }
    })
    var boostTotal = 0
    var score = 0
    for (var field in tfidf) {
      var boost = Number(fields[field] || fields['*']) || 0
      score += similarity(query, tfidf[field]) * boost
      boostTotal += boost
    }
    if (boostTotal > 0) {
      score /= boostTotal // normalize
    }
    return {
      key: data[0].key,
      score: score
    }
  })
  .filter(function (data) {
    return data.score > 0
  })
  .sortBy(function (a, b) {
    // sort by score desc
    // todo optimize this
    return b.score - a.score
  })
  .drop(offset)
  .take(limit)
  .map(H.wrapCallback(function (doc, cb) {
    if (values) {
      // fetch value if values true
      self.get(doc.key, function (err, val) {
        if (err) return cb(err)
        doc.value = val
        cb(null, doc)
      })
    } else {
      cb(null, doc)
    }
  }))
  .series()
}

Levi.fn.createLiveStream =
Levi.fn.liveStream = function (q, opts) {
  opts = xtend(this.options, opts)
  var self = this
  var values = opts.values !== false
  var fields = opts.fields || { '*': 1 }

  var live = H('_write', this)
  var query = {}
  var nts = {}

  return H(function (push, next) {
    // pipeline query
    self.pipeline(q, function (err, tokens) {
      if (err) return push(err)
      var total = tokens.length
      var counts = countTokens(tokens)
      var uniqs = Object.keys(counts)
      uniqs.forEach(function (token) {
        // calculate tf for query
        query[token] = counts[token] / total
      })
      // cache initial nt for query
      H(uniqs)
      .map(H.wrapCallback(function (token, cb) {
        self.weight.get(token + '!', function (err, nt) {
          if (err) return push(err)
          nts[token] = nt
          cb()
        })
      }))
      .series()
      .done(function () {
        next(live)
      })
    })
  })
  .map(function (data) {
    // clone query coz idfs are different on every updates
    var xquery = xtend(query)
    var field
    // tfidf group by fields, tokens
    // tfidf[field] becomes term vector
    var tfidf = {}
    for (var token in query) {
      var idf, nt
      var N = data.size
      if (token in data.nts) {
        nt = data.nts[token]
        nts[token] = nt // update cached nt
        idf = Math.log(1 + N / nt)
        for (field in data.tfs[token]) {
          var tf = data.tfs[token][field]
          tfidf[field] = tfidf[field] || {}
          tfidf[field][token] = tf * idf
        }
        xquery[token] *= idf
      } else {
        // use cached nt if not exists
        nt = nts[token]
        idf = Math.log(1 + N / nt)
        xquery[token] *= idf
      }
    }

    var boostTotal = 0
    var score = 0
    for (field in tfidf) {
      var boost = Number(fields[field] || fields['*']) || 0
      score += similarity(xquery, tfidf[field]) * boost
      boostTotal += boost
    }
    if (boostTotal > 0) {
      score /= boostTotal // normalize
    }
    return {
      key: data.key,
      score: score,
      value: values ? data.value : undefined
    }
  })
  .filter(function (data) {
    return data.score > 0
  })
}

module.exports = Levi
