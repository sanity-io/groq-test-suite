# The Movies Dataset

Data originally from MovieLens, via <https://www.kaggle.com/rounakbanik/the-movies-dataset>.

## Building

```bash
python3 convert.py the-movies-dataset/ > movies.ndjson
```

## Data Model

Document data models by document type.

### `movie`

* `imdb_id`: IMDb ID
* `title`: title
* `original_title`: title in original language
* `original_language`: ISO 639-1 code for original title language
* `tagline`: tagline
* `poster`: reference to `asset`
* `homepage`: website URL
* `overview`: summary
* `status`: status, e.g. `Released`
* `release_date`: release date in ISO 8601 format, e.g. `1995-10-30`
* `runtime`: runtime in minutes
* `collection`: reference to `collection`
* `genres`: array of references to `genre`
* `keywords`: array of keyword strings
* `spoken_languages`: array of language strings with ISO 639-1 code
* `cast`: array of cast objects
  * `character`: name of movie character
  * `person`: reference to `person`
* `crew`: array of crew objects
  * `job`: crew member's role
  * `department`: crew member's department
  * `person`: reference to `person`
* `production_countries`: array of production country strings in iso 3166-1 alpha-2 code, e.g. `US`
* `production_companies`: array of references to `company`
* `budget`: production budget in USD
* `revenue`: total revenue in USD
* `adult`: `true` if adult movie
* `video`: `true` if straight-to-video
* `popularity`: popularity rating as decimal number
* `vote_average`: average vote as decimal number (1-10)
* `vote_count`: number of votes

### `asset`

* `path`: image file path
* `mimetype`: image mimetype
* `size`: image size in bytes
* `width` image width in pixels
* `height`: image height in pixels

### `collection`

Movie collections.

* `name`: collection name
* `poster`: reference to `asset`
* `backdrop`: reference to `asset`

### `company`

* `name`: company name

### `genre`

* `name`: genre name

### `person`

* `name`: person name
* `gender`: person's gender (`m` or `f`)
* `profile`: reference to `asset`
