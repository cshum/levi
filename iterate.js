var through = require('through2')

module.exports = function (stream) {
  var cb = null
  var wait = null

  stream
  .on('error', function (err) {
    if (cb) {
      cb(err)
    } else {
      wait = function () {
        wait = null
        cb(err)
      }
    }
  })
  .pipe(through.obj(function (data, _, next) {
    if (cb) {
      cb(null, data)
      cb = null
      next()
    } else {
      wait = function () {
        wait = null
        cb(null, data)
        cb = null
        next()
      }
    }
  }, function (next) {
    if (cb) {
      cb()
      next()
    } else {
      wait = function () {
        cb()
        next()
      }
    }
  }))

  return function iterate (_cb) {
    process.nextTick(function () {
      cb = _cb
      if (wait) wait()
    })
  }
}
