// counting unique tokens

module.exports = function count (tokens) {
  var counts = {}
  for (var i = 0, l = tokens.length; i < l; i++) {
    var token = tokens[i]
    counts[token] = (counts[token] || 0) + 1
  }
  return counts
}
