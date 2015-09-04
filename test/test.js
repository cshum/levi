require('rimraf').sync('./test/db')

var test = require('tape')
var levi = require('../')

var down = require('jsondown')
// var down = require('leveldown')

var lv = levi('./test/db', { db: down })
  .use(levi.tokenizer())
  .use(levi.stemmer())
  .use(levi.stopword())

test('CRUD', function (t) {
  lv.put('a', {
    a: 'hello',
    b: 'the world sucks'
  }, {
    fields: {a: 2, b: 1} 
  }, function (err) {
    t.notOk(err)
    t.end()
  })
})
