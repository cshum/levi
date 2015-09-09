// extract text values from arbirtary object

module.exports = function extract (data, stack) {
  stack = stack || []
  if (typeof data === 'string') {
    stack.push(data)
  } else if (Array.isArray(data)) {
    for (var i = 0, l = data.length; i < l; i++) {
      extract(data[i], stack)
    }
  } else if (typeof data === 'object' && !!data) {
    for (var key in data) {
      if (data.hasOwnProperty(key)) {
        extract(data[key], stack)
      }
    }
  }
  return stack
}
