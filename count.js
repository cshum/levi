// counting unique tokens

module.exports = function count (tokens) {
  var counts = {}
  tokens.forEach(function (token) {
    counts[token] = (counts[token] || 0) + 1
  })
  return counts
}
