# Levi

Streaming text search for Node.js and browsers. Using LevelDB as storage backend.

### levi(dir, opts)
### levi(sublevel, opts)

By default, Levi uses LevelDB on Node.js and IndexedDB on browser. Also works with a variety of LevelDOWN compatible backends.

```js
var lv = levi('db', {
  fields: {
    title: 1,
    body: 1,
    tags: 10
  }
})
.use(levi.tokenizer())
.use(levi.stemmer())
.use(levi.stopword())
```

Levi provides the typical text processing pipeline: tokenizer, porter stemmer and english stopword filter. These are exposed as plugins so that they can be swapped for different configurations.

### .put(key, value, [opts])
### .del(key, [opts])

### .searchStream(query)

* TF-IDF
* Cosine similarity

### .liveStream(query)

`liveStream()` approximates score for live incoming results. This is done based on the evaluation of 
[TF-ICF: A New Term Weighting Scheme for Clustering Dynamic Data Streams](http://cda.ornl.gov/publications/ICMLA06.pdf), 
where TC-ICF approximate TF-IDF score based on corpus already have.
The score can be relatively accurate to TF-IDF when the corpus size is large. 
This a very preferable for live changing data feeds since TF-ICF is
O(n) plus `liveStream()` does not require database scans, 
which means significantly faster processing.
