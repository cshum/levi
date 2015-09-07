require('rimraf').sync('./test/db')
var levi = require('../')
var similarity = require('../lib/util/similarity')

var test = require('tape')
var levelup = require('levelup')
// var down = require('jsondown')
var down = require('leveldown')
var db = levelup('./test/db', { db: down })
var H = require('highland')

var lv = levi(db)
.use(levi.tokenizer())
.use(levi.stemmer())
.use(levi.stopword())

test('pipeline', function (t) {
  lv.pipeline('Aldus PageMaker including versions of Lorem Ipsum.', function (err, tokens) {
    t.notOk(err)
    t.deepEquals(tokens, ['aldu', 'pagemak', 'includ', 'version', 'lorem', 'ipsum'])
    t.end()
  })
})

test('similarity', function (t) {
  t.equal(Math.round(similarity(
    {x: 1, y: 3, z: -5, foo: 0},
    {x: 4, y: -2, z: -1}
  ) * 1000) / 1000, 0.111, 'cosine similarity')

  t.equal(similarity(
    {x: 1, y: 3, z: -5},
    {x: 0, y: 0, z: 0}
  ), 0, 'zero magitude vector')

  t.end()
})

test('put', function (t) {
  var aObj = {
    a: 'hello world',
    b: 'world sucks'
  }
  lv.put('a', aObj, function () {
    lv.get('a', function (err, value) {
      t.notOk(err)
      t.deepEqual(value, aObj, 'put object')
    })
  })
  var bText = 'Lorem Ipsum is simply dummy text of the printing and typesetting industry.'
  lv.put('b', new Buffer(bText), function () {
    lv.get('b', function (err, value) {
      t.notOk(err)
      t.equal(value, bText, 'put buffer')
      t.equal(typeof value, 'string', 'buffer converted to string')
    })
  })
  var cText = 'Aldus PageMaker including versions of Lorem Ipsum.'
  lv.put('c', cText, function () {
    lv.get('c', function (err, value) {
      t.notOk(err)
      t.equal(value, cText, 'put string')
      lv.meta.get('size', function (err, size) {
        t.notOk(err)
        t.equal(size, 3, 'size correct')
        lv.searchStream('aldus pagemaker').toArray(function (arr) {
          t.equal(arr[0].key, 'c', 'text searchable')
          t.end()
        })
      })
    })
  })
})

test('del', function (t) {
  lv.del('a')
  lv.del('b')
  lv.del('c', function (err) {
    t.notOk(err)
    lv.meta.get('size', function (err, size) {
      t.notOk(err && !err.notFound)
      t.notOk(size, 'empty after delete all')
      H(db.readStream()).toArray(function (arr) {
        t.equal(arr.length, 0, 'empty after delete all')
        t.end()
      })
    })
  })
})

test('Search', function (t) {
  t.plan(11)

  var live = lv.liveStream('green plant')

  H([{
    id: 'a',
    title: 'Mr. Green kills Colonel Mustard',
    body: 'Mr. Green killed Colonel Mustard in the study with the candlestick. ' +
      'Mr. Green is not a very nice fellow.'
  }, {
    id: 'b',
    title: 'Plumb waters plant',
    body: 'Professor Plumb has a green plant in his study'
  }, {
    id: 'c',
    title: 'Scarlett helps Professor',
    body: 'Miss Scarlett watered Professor Plumbs green plant while he was away ' +
      'from his office last week.'
  }, {
    id: 'd',
    title: 'foo',
    body: 'bar'
  }])
  .map(H.wrapCallback(function (doc, cb) {
    lv.put(doc.id, doc, cb)
  }))
  .series()
  .done(function () {
    lv.searchStream('green plant').toArray(function (arr) {
      t.equal(arr.length, 3, 'search: correct number of results')
      t.equal(arr[0].key, 'b', 'search: correct score')

      lv.searchStream(['green', 'plant']).toArray(function (arr2) {
        t.deepEqual(arr2, arr, 'tokenized query')
      })

      lv.searchStream('green plant', { offset: 1 }).toArray(function (arr2) {
        t.deepEqual(arr2, arr.slice(1), 'query offset')
      })

      lv.searchStream('green plant', { limit: 1 }).toArray(function (arr2) {
        t.deepEqual(arr2, arr.slice(0, 1), 'limit')
      })

      live.take(3).last().pull(function (err, res) {
        t.notOk(err)
        t.equal(res.score, arr[2].score,
          'live: last score identical to search score')
      })
    })

    lv.searchStream('green', { fields: { title: true } }).toArray(function (arr) {
      t.equal(arr.length, 1, 'fielded: correct number of results')
      t.equal(arr[0].key, 'a', 'fielded: correct result')
    })

    lv.searchStream('watering plant', { fields: { title: 1, body: 10 } }).toArray(function (arr) {
      t.equal(arr.length, 2, 'field boosting: correct number of results')
      t.equal(arr[0].key, 'c', 'field boosting: correct boosted result')
    })
  })
})
