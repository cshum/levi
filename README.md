# Levi

Streaming full-text search for Node.js and browsers. Using LevelDB as storage backend.

```
npm install levi
```

Full-text search based on TF-IDF, 
cosine similarity relevancy scoring, and field boosting in query time.
The text processing pipeline contains Tokenizer, Porter Stemmer, and English Stopwords Filter. 
These are exposed as [Ginga](https://github.com/cshum/ginga) plugins so that they can be swapped for different language configurations.

Levi leverages [LevelUP](https://github.com/Level/levelup) for asynchronous, 
[transactional](https://github.com/cshum/level-transactions/) storage interface.
By default, it uses [LevelDB](https://github.com/Level/leveldown) on Node.js and [IndexedDB](https://github.com/maxogden/level.js) on browser. 
Also works with a variety of LevelDOWN compatible backends.
Search interface is built on [Highland](http://highlandjs.org/), a Node compatible stream with async and functional programming concepts. 


In addition, Levi provides relevancy scoring on live streaming data feeds.
This is done using TF-ICF - a TF-IDF approximation based on already processed corpus.
From the evaluation of 
[TF-ICF: A New Term Weighting Scheme for Clustering Dynamic Data Streams](http://cda.ornl.gov/publications/ICMLA06.pdf), 
such score can be relatively accurate to TF-IDF when the corpus 
is sufficiently large and diverse.
This a very preferable for live changing data since this does not require database scans, 
which means significantly faster processing.


## API

### levi(dir, [opts])
### levi(sublevel, [opts])

Initialize Levi with database path and the required plugins `levi.tokenizer()`, `levi.stemmer()`, `levi.stopword()`.

```js
var levi = require('levi')

// passing db location
var lv = levi('db') 
.use(levi.tokenizer())
.use(levi.stemmer())
.use(levi.stopword())

```
alternatively passing [SublevelUP](https://github.com/cshum/sublevelup) section.

```js
var sublevel = require('sublevelup')
var db = sublevel(levelup('db'))

// passing sublevel of SublevelUP
var lv = levi(db.sublevel('levi'))
.use(levi.tokenizer())
.use(levi.stemmer())
.use(levi.stopword())

```

### .put(key, value, [opts])
### .del(key, [opts])
### .get(key, [opts])
Fetching value from the store. Behaves exactly like LevelUP's [`get()`](https://github.com/Level/levelup#get)

### .searchStream(query, [opts])

* TF-IDF
* Cosine similarity

### .liveStream(query, [opts])

`liveStream()` approximates relevancy score for live incoming results. 

## License

MIT
