# GROQ test suite

The GROQ test suite is the official conformance test suite for the [GROQ specification](https://github.com/sanity-io/GROQ).

## Status

The test suite (and the specification) was started in August 2019 and has good coverage of the basic features.
Currently we're working on moving over tests from the internal GROQ implementation used in [Sanity](https://www.sanity.io/).

## Versioning

The test suite uses the version scheme `vX.Y.Z` where `X.Y` follows the version of [GROQ](https://github.com/sanity-io/GROQ) and `Z` is monotonically increasing.

## Using the test suite

The YAML files in this repository is optimized for writing tests.
For using the test suite it's recommended to use the _compiled_ version.
The compiled test suite is a [NDJSON](https://github.com/ndjson/ndjson-spec) file where every entry uses the schema below.

The compiled test suite can either be downloaded from [the GitHub Release page](https://github.com/sanity-io/groq-test-suite/releases) or be built from source (see next section).

```typescript
type Entry = Dataset | Test

type Dataset = {
  _type: 'dataset'
  _id: string

  name: string
  documents?: Array<any>
  url: string
}

type Test = {
  _type: 'test'
  _id: string

  name: string
  filename: string
  query: string
  result: any
  valid: boolean
  dataset: {
    _type: 'reference'
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
$ yarn build # outputs to suite.ndjson
$ yarn build --stdout # outputs to stdout
$ yarn build --out=custom.ndjson # outputs to custom.ndjson
$ yarn build --pattern='**/misc.yml' # Only build for files which matched the pattern.
$ yarn build --baseDir=/some/dir' # Look for test  files in this base directory
```

## Structure

The test suite is written in YAML files in the `test/` directory. Here's an example file:

```yaml
documents:
  - _id: 'a'
    _type: 'person'
    name: 'George Michael Bluth'
  - _id: 'b'
    _type: 'company'
    name: 'Bluth Inc.'
    manager:
      _ref: 'a'

tests:
  - name: 'Resolve references'
    query: |
      *[_type == "company"][].manager->name
    result:
      - 'George Michael Bluth'
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

### Versioning

Each test can be tagged with a `version` field which should contain a version selector.
The version is on the form `X.Y` and specifies that it targets GROQ-X.revisionY.

```yaml
# This test file:
documents:
  - _id: 'a'
  - _id: 'b'

version: '>= 1.0'

tests:
  name: 'Counting'
  query: |
    count(*)
  result: 2
```

The version `0.1` is used for the original implementation of GROQ before there was a finalized specification and is maintained here for historical reasons.

### Variables

Queries can use the syntax `~name~` for referring to variables.
Together with test inheritance this can be used to succinctly test many different cases.

```yaml
documents:
  - _id: 'a'
  - _id: 'b'
  - _id: 'c'

tests:
  - name: 'Filtering'
    query: |
      count(*[~filter~])
    tests:
      - result: 1
        variables:
          filter: '_id == "a"'
      - result: 2
        variables:
          filter: '_id >= "b"'
```

### Automatic test generation based on variables

To increase the test coverage we automatically generate extra test cases.
The following test case,

```yaml
tests:
  - name: 'Compare'
    query: |
      ~str~ < "z"
    variables:
      str: ['a', 'b']
```

will generate the following additional test queries:

- Plain: `"a" < "z"`
- GenFilter: `*[_id == "foo"][bar < "z"][]._id` (and create the needed documents)
- GenFetch: `*[_id == "foo"][0].bar < "z"` (and create the needed documents)
- GenJoin: `*[_id == "foo]{\"children\":*[_id == \"foo\"][^.f == f][]._id}"` (and create the needed documents)

The rules of how the tests are generated are as follows:

- If a test case has an explicit dataset (either `documents` or `dataset`) then nothing will be generated.
- Every variable which contains valid JSON is eligable for automatic test generation.
- We assume that every variable is _standalone_ (e.g. we can safely pull them out).
  You can use `standaloneVariables: ["var1"]` in case there are some variables which are not standalone.
- Set `genFilter: false`, `genFetch: false` and/or `genJoin: false` to disable the generated tests.

### Features

A test can specify a list of named features that it requires, which a test runner can use to skip tests or enable specific modes. Currently defined features:

- `portableText`: Functionality provided by the `pt` extensions.
- `geo`: Functionality provided by the `geo` extension.
- `wildcardMatchSegmentation`: Specifies a more sensible semantics for handling wildcards in the `match` operator.

### Scores

Since the scoring algorithm used by `score()` is currently implementation-defined, tests cannot contain the literal score. Instead, tests must use an ordinal number to represent the _position_ among the total list of result scores. The test runner, when comparing results, should replace the actual scores with this algorithm:

- Take all encountered scores in the results
- Remove duplicates
- Sort them
- Replace each score with an attribute `_pos` containing the position in the list

For example: If a query returns:

```yaml
- {id: 'a', _score: 1.0}
- {id: 'b', _score: 1.2}
- {id: 'c', _score: 1.2}
- {id: 'd', _score: 1.4}
```

then these should be remapped as:

```yaml
- {id: 'a', _pos: 1}
- {id: 'b', _pos: 2}
- {id: 'c', _pos: 2}
- {id: 'd', _pos: 3}
```

…and this is what the test needs to test equality against.

In other words, any value with equal score is given the same ordinal value.

### Specifying datasets

Tests can either declare datasets inline (using the `documents` property) or refer to an external dataset by name:

```yaml
dataset: movies
tests:
  - name: 'Good movies'
    query: |
      count(*[_type == "movive" && rating > 8.0])
    result: 123
```

Currently the following named datasets are available:

| Name     | Size                     | Documentation                                            | URL                                                                                                                 |
| -------- | ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `movies` | ~500k documents (~200MB) | [./utils/the-movies-dataset](./utils/the-movies-dataset) | [🔗](https://groq-test-suite.storage.googleapis.com/datasets/movies/movies-8807c4bb9fa31a9a6c21a4f7e41662d6.ndjson) |

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

type Variables = {[key: string]: string}
```

## Versioned Releases

The test suite uses semantic versioning for its YAML/JSON test files and their functionality, independent of the GROQ language specification version. Version numbers are determined by changes to these files specifically:

- Major: breaking change in the file YAML/JSON format
- Minor: new functionality in the file YAML/JSON format
- Patch: no change in the file format or functionality, i.e. adding more tests.

To release a new version vX.Y.Z of the test suite, run:

```sh
git switch main
git pull
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

A version tag push triggers [release GitHub Action](https://github.com/sanity-io/groq-test-suite/actions/workflows/release.yml) which will build the test suite and upload it to the [GitHub Release page](https://github.com/sanity-io/groq-test-suite/releases).
