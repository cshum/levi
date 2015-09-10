// extract text values from arbirtary object

module.exports = function extract (data, tokens, stack) {
  tokens = tokens || []
  stack = stack || []
  if (stack.indexOf(data) !== -1) {
    throw new Error('Cycle detected')
  }
  if (typeof data === 'string') {
    tokens.push(data)
  } else if (Array.isArray(data)) {
    stack.push(data)
    for (var i = 0, l = data.length; i < l; i++) {
      extract(data[i], tokens, stack)
    }
  } else if (typeof data === 'object' && !!data) {
    stack.push(data)
    for (var key in data) {
      if (data.hasOwnProperty(key)) {
        extract(data[key], tokens, stack)
      }
    }
  }
  return tokens
}
