# GROQ test suite

The GROQ test suite is the official conformance test suite for the [GROQ specification](https://github.com/sanity-io/GROQ).

## Status

The test suite (and the specification) was started in August 2019 and is nearly empty, but under active development.
Currently we're working on moving over tests from the internal GROQ implementation used in [Sanity](https://www.sanity.io/).

## Structure

The test suite is written in YAML files in the `test/` directory. Here's an example file:

```yaml
- _type: dataset
  documents:
    - _id: a
      _type: person
      name: George Michael Bluth
    - _id: b
      _type: company
      name: Bluth Inc.
      manager:
        _ref: a

- _type: test
  name: Resolve references
  query: |
    *[_type == "company"][].manager->name
  result:
    - George Michael Bluth
```

### Templates

Often you want to test queries which share a lot of similarities.
The test suite supports *templates* to avoid repeating yourself:

```yaml
- _type: template
  id: template.fst-person
  query: |
    *[_type == "person"] [${filter}] [0].${attribute}

- _type: test
  template:
    _ref: template.fst-person
    filter: age <= 18
    attribute: name
  result: George Michael Bluth
```

### Schema

The full schema is as follows:

```typescript
type Content = Array<Document>

type Document = Test | Dataset | Template

// If an _id is not specified it's auto-generated based on the filename.

type Test = {
  _id?: string
  _type: "test"

  // Name of the test
  name: string

  // The query. This should be undefined if you use a template.
  query?: string

  // The expected result.
  result: any

  // Reference to a template (with variables).
  template?: {
    // Reference to a template. If this is undefined, it will will default to
    // the previous template defined in the same file.
    _ref?: string
    [key: string]: string
  }

  // Reference to a dataset. If this is undefined, it will will default to
  // the previous dataset defined in the same file.
  dataset?: {
    _ref: string
  }
}

type Dataset = {
  _id?: string
  _type: "dataset"

  documents: Array<any>
}

type Template = {
  _id?: string
  _type: "template"

  // The template query.
  query: string
}
```

### Compiling the test suite

The YAML files are optimized for writing tests.
If you're planning to consume the test suite it's recommended to use the *compiled* test suite:

```bash
# Install dependencies
$ yarn

# Build the test suite
$ yarn build > test.ndjson
```

The compiled test suite is a [NDJSON](http://ndjson.org/) file where:

- Every document has a generated `_id`.
- Every test has a `dataset` reference.
- Every test has a `query` (i.e. the template is expanded).

