require('rimraf').sync('./test/db')
var levi = require('../')

var test = require('tape')
var levelup = require('levelup')
var down = require('jsondown')
// var down = require('leveldown')
var db = levelup('./test/db', { db: down })
var H = require('highland')

var lv = levi(db)
  .use(levi.tokenizer())
  .use(levi.stemmer())
  .use(levi.stopword())

var similarity = require('../lib/util/similarity')
test('similarity', function (t) {
  t.equal(Math.round(similarity(
    {x: 1, y: 3, z: -5},
    {x: 4, y: -2, z: -1}
  ) * 1000) / 1000, 0.111)

  t.end()
})

test('put', function (t) {
  var aObj = {
    a: 'hello world',
    b: 'the world sucks'
  }
  lv.put('a', aObj, function () {
    lv.get('a', function (err, value) {
      t.notOk(err)
      t.deepEqual(value, aObj, 'fielded object')
    })
  })
  var bText = 'Lorem Ipsum sucks text of the printing and typesetting industry.'
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
        t.end()
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
  t.plan(3)

  var live = lv.liveStream('green plant', {
    fields: { title: 10, body: 1 } 
  })

  H([{
    id: 'a',
    title: 'Mr. Green kills Colonel Mustard',
    body: 'Mr. Green killed Colonel Mustard in the study with the candlestick. Mr. Green is not a very nice fellow.'
  }, {
    id: 'b',
    title: 'Plumb waters plant',
    body: 'Professor Plumb has a green plant in his study'
  }, {
    id: 'c',
    title: 'Scarlett helps Professor',
    body: 'Miss Scarlett watered Professor Plumbs green plant while he was away from his office last week.'
  }, {
    id: 'd',
    title: 'title',
    body: 'handsome'
  }, {
    id: 'e',
    title: 'title',
    body: 'hand'
  }])
  .map(H.wrapCallback(function (doc, cb) {
    lv.put(doc.id, doc, cb)
  }))
  .series()
  .done(function () {
    lv.searchStream('green plant', {
      fields: { title: 10, body: 1 } 
    }).toArray(function (arr) {
      t.equal(arr.length, 3, 'correct search')
      t.equal(arr[0].key, 'b', 'correct search')

      live.take(3).last().pull(function (err, res) {
        t.equal(
          res.score, arr[2].score, 
          'last live score identical to search score'
        )
      })
    })


  })
})
