# Levi

Streaming full-text search for Node.js and browsers. Using LevelDB as storage backend.

```
npm install levi
```

Full-text search based on TF-IDF and cosine similarity, 
stream based search mechanism with query-time field boosting.
Provided with a configurable text processing pipeline: Tokenizer, Stemmer, and Stopwords. 

Levi leverages [LevelUP](https://github.com/Level/levelup) for asynchronous, 
[transactional](https://github.com/cshum/level-transactions/) storage interface.
By default, it uses [LevelDB](https://github.com/Level/leveldown) on Node.js and [IndexedDB](https://github.com/maxogden/level.js) on browser. 
Also works with a variety of LevelDOWN compatible backends.

In addition, Levi provides relevancy scoring for live changing data using [TF-ICF](http://cda.ornl.gov/publications/ICMLA06.pdf) - a TF-IDF approximation based on existing corpus.
Such scoring is comparably close to TF-IDF when existing corpus is sufficiently large and diverse,
and with significantly better efficiency `O(N)` instead of `O(N^2)`.

## API

### levi(dir, [opts])
### levi(sublevel, [opts])

Initialize Levi with [LevelUP's](https://github.com/Level/levelup#ctor) db path.

```js
var levi = require('levi')

// passing db location
var lv = levi('db') 
.use(levi.tokenizer())
.use(levi.stemmer())
.use(levi.stopword())

```
alternatively passing a section of [SublevelUP](https://github.com/cshum/sublevelup).

```js
var sublevel = require('sublevelup')
var db = sublevel(levelup('db'))

// passing db section `levi`
var lv = levi(db.sublevel('levi'))
.use(levi.tokenizer())
.use(levi.stemmer())
.use(levi.stopword())

```

Text processing plugins `levi.tokenizer()`, `levi.stemmer()`, `levi.stopword()` are required for indexing.
These are exposed as plugins so that they can be swapped for different language configurations.

### .put(key, value, [opts])
Index document identified by `key`. `value` can be Object, String or Buffer.
Use fielded Object for `value` if you want field boosting for search.

### .del(key, [opts])
Delete document `key` from index.

### .get(key, [opts])
Fetch value from the store. Behaves exactly like LevelUP's [`get()`](https://github.com/Level/levelup#get)

### .searchStream(query, [opts])

### .liveStream(query, [opts])

Approximates relevancy score for live changing data. 
This a very preferable for live changing data since this does not require database scans, 
which means significantly faster processing.

## License

MIT
