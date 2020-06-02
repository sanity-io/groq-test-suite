# GROQ test suite

The GROQ test suite is the official conformance test suite for the [GROQ specification](https://github.com/sanity-io/GROQ).

## Status

The test suite (and the specification) was started in August 2019 and has good coverage of the basic features.
Currently we're working on moving over tests from the internal GROQ implementation used in [Sanity](https://www.sanity.io/).

## Versioning

The test suite uses the version scheme `vX.Y.Z` where `X.Y` follows the version of [GROQ](https://github.com/sanity-io/GROQ) and `Z` is monotonically increasing.

## Using the test suite

The YAML files in this repository is optimized for writing tests.
For using the test suite it's recommended to use the *compiled* version.
The compiled test suite is a [NDJSON](http://ndjson.org/) file where every entry uses the schema below.

The compiled test suite can either be downloaded from [the GitHub Release page](https://github.com/sanity-io/groq-test-suite/releases) or be built from source (see next section).

```typescript
type Entry = Dataset | Test

type Dataset = {
  _type: "dataset"
  _id: string

  documents?: Array<any>
  url: string
}

type Test = {
  _type: "test"
  _id: string

  name: string
  filename: string
  query: string
  result: any
  valid: boolean
  dataset: {
    _ref: string
  }
}
```

### Compiling the test suite

Use the provided `build` script to compile the test suite:

```bash
# Install dependencies
$ yarn

# Build the test suite
$ yarn -s build > suite.ndjson
```

## Structure

The test suite is written in YAML files in the `test/` directory. Here's an example file:

```yaml
documents:
  - _id: "a"
    _type: "person"
    name: "George Michael Bluth"
  - _id: "b"
    _type: "company"
    name: "Bluth Inc."
    manager:
      _ref: "a"

tests:
  - name: "Resolve references"
    query: |
      *[_type == "company"][].manager->name
    result:
      - "George Michael Bluth"
```

### Nesting tests

Tests can be nested and will then inherit properties from their parent.

Here's a slightly contrived example which shows how the dataset can be overridden for a specific test case:

```yaml
# This test file:
documents:
  - _id: "a"
  - _id: "b"

tests:
  name: "Counting"
  query: |
    count(*)
  result: 2

  tests:
    - documents:
        - _id: "a"
        - _id: "b"
        - _id: "c"
      result: 3

# … would be equivalent to:
tests:
  - name: "Counting"
    documents:
      - _id: "a"
      - _id: "b"
    query: |
      count(*)
    result: 2

  - name: "Counting 2"
    documents:
      - _id: "a"
      - _id: "b"
      - _id: "c"
    query: |
      count(*)
    result: 3
```

### Variables

Queries can use the syntax `${name}` for referring to variables.
Together with test inheritance this can be used to succinctly test many different cases.

```yaml
documents:
  - _id: "a"
  - _id: "b"
  - _id: "c"

tests:
  - name: "Filtering"
    query: |
      count(*[${filter}])
    tests:
      - result: 1
        variables:
          filter: '_id == "a"'
      - result: 2
        variables:
          filter: '_id >= "b"'
```

### Specifying datasets

Tests can either declare datasets inline (using the `documents` property) or refer to an external dataset by name:

```yaml
dataset: movies
tests:
  - name: "Good movies"
    query: |
      count(*[_type == "movive" && rating > 8.0])
    result: 123
```

Currently the following named datasets are available:

| Name | Size | Documentation | URL |
| --- | --- | --- | --- |
| `movies` | ~500k documents (~200MB) | [./utils/the-movies-dataset](./utils/the-movies-dataset) | [🔗](https://groq-test-suite.storage.googleapis.com/datasets/movies/movies-7d858de5318a6bc27d92a638899957ef.ndjson) |

### Schema

The full schema is as follows:

```typescript
// Every test file contains a single "test"
type TestFile = Test

type Test = {
  dataset?: string
  documents?: Array<any>

  name?: string

  query?: string
  variables?: Variables

  result?: any
  valid?: boolean // defaults to `true`

  tests?: Array<Test>
}

type Variables = { [key: string]: string }
```

