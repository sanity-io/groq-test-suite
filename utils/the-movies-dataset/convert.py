#!/usr/bin/env python3
#
# Converts the-movies-dataset to NDJSON files appropriate for GROQ. Written
# in Python, since the CSV files stores complex data structures as Python
# expressions.
#

import ast
import csv
import json
import os
import hashlib
import struct

def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)

class Converter:
    def __init__(self):
        self.assets = {}
        self.collections = {}
        self.companies = {}
        self.genres = {}
        self.movies = {}
        self.persons = {}

    def ref_asset(self, path):
        if path == None or path == '':
            return None
        id = 'asset-{}'.format(path[0] == '/' and path[1:] or path) # Strip /
        ext = "." in path and path.split('.')[-1] or None
        mimetype = {
            "jpg": "image/jpeg",
            "png": "image/png",
        }.get(ext)
        if mimetype == None:
            print('Could not find MIME type for extension {}'.format(ext))

        # We just generate fictional but deterministic asset properties
        # by hashing the ID
        widths = [720, 1280, 1440, 1920, 3840]
        heights = [576, 720, 1080, 2160]
        max_size = 10e6
        hstr = hashlib.sha1(id.encode('utf-8')).digest()
        h, = struct.unpack('l', hstr[0:8])
        self.assets[id] = {
            '_id': id,
            '_type': 'asset',
            'path': path,
            'mimetype': mimetype,
            'size': int(h % max_size),
            'width': widths[h % len(widths)],
            'height': heights[h % len(heights)],
        }
        return {
            '_type': 'reference',
            '_ref': id
        }

    def read(self, inputpath):
        with open(os.path.join(inputpath, "movies_metadata.csv")) as file:
            for row in csv.DictReader(file, strict=True):
                if row['vote_count'] == None:
                    eprint("{}: incomplete record, skipping ".format(file.name), row)
                    continue

                self.movies[row['id']] = movie = {
                    '_id':          'movie-{}'.format(row['id']),
                    '_type':        'movie',
                    'imdb_id':      row['imdb_id'] not in ('', '0') and row['imdb_id'] or None,
                    'title':        row['title'],
                    'original_title': row['original_title'] or None,
                    'original_language': row['original_language'] or None,
                    'tagline':      row['tagline'] or None,
                    'poster':       self.ref_asset(row['poster_path']),
                    'homepage':     row['homepage'] or None,
                    'overview':     row['overview'] or None,
                    'status':       row['status'] or None,
                    'release_date': row['release_date'] or None,
                    'runtime':      row['runtime'] and int(row['runtime'].split('.')[0]) or None,
                    'collection':   None,
                    'genres':       [],
                    'keywords':     [],
                    'spoken_languages': [],
                    'cast':         [],
                    'crew':         [],
                    'production_countries': [],
                    'production_companies': [],
                    'budget':       int(row['budget']) or None,
                    'revenue':      int(row['revenue']) or None,
                    'adult':        bool(ast.literal_eval(row['adult'])),
                    'video':        bool(ast.literal_eval(row['video'])),
                    'popularity':   float(row['popularity']),
                    'vote_average': row['vote_count'] != '0' and float(row['vote_average']) or None,
                    'vote_count':   int(row['vote_count'])
                }

                if row['belongs_to_collection']:
                    c = ast.literal_eval(row['belongs_to_collection'])
                    self.collections[c['id']] = {
                        '_id':      'collection-{}'.format(c['id']),
                        '_type':    'collection',
                        'name':     c['name'],
                        'poster':   self.ref_asset(c['poster_path']),
                        'backdrop': self.ref_asset(c['backdrop_path'])
                    }
                    movie['collection'] = {
                        '_type': '_reference',
                        '_ref': 'collection-{}'.format(c['id'])
                    }

                for g in ast.literal_eval(row['genres']):
                    self.genres[g['id']] = {
                        '_id':      'genre-{}'.format(g['id']),
                        '_type':    'genre',
                        'name':     g['name']
                    }
                    movie['genres'].append({
                        '_type': 'reference',
                        '_ref': 'genre-{}'.format(g['id'])
                    })

                for c in ast.literal_eval(row['production_companies']):
                    self.companies[c['id']] = {
                        '_id':      'company-{}'.format(c['id']),
                        '_type':    'company',
                        'name':     c['name']
                    }
                    movie['production_companies'].append({
                        '_type': 'reference',
                        '_ref': 'company-{}'.format(c['id'])
                    })

                for c in ast.literal_eval(row['production_countries']):
                    movie['production_countries'].append(c['iso_3166_1'])

                for l in ast.literal_eval(row['spoken_languages']):
                    movie['spoken_languages'].append(l['iso_639_1'])

        with open(os.path.join(inputpath, 'keywords.csv')) as file:
            for row in csv.DictReader(file, strict=True):
                if row['id'] not in self.movies:
                    eprint("{}: unknown movie ID {}, skipping".format(file.name, row['id']))
                    continue

                movie = self.movies[row['id']]
                for k in ast.literal_eval(row['keywords']):
                    movie['keywords'].append(k['name'])

        with open(os.path.join(inputpath, 'credits.csv')) as file:
            for row in csv.DictReader(file, strict=True):
                if row['id'] not in self.movies:
                    eprint("{}: unknown movie ID {}, skipping".format(file.name, row['id']))
                    continue
                movie = self.movies[row['id']]

                for c in ast.literal_eval(row['cast']):
                    self.persons[c['id']] = {
                        '_id':      'person-{}'.format(c['id']),
                        '_type':    'person',
                        'name':     c['name'],
                        'gender':   {1: 'f', 2: 'm'}.get(c['gender'], None),
                        'profile':  self.ref_asset(c['profile_path'])
                    }
                    movie['cast'].append({
                        'character': c['character'],
                        'person': {
                            '_type':    'reference',
                            '_ref':     'person-{}'.format(c['id'])
                        }
                    })

                for c in ast.literal_eval(row['crew']):
                    self.persons[c['id']] = {
                        '_id':      'person-{}'.format(c['id']),
                        '_type':    'person',
                        'name':     c['name'],
                        'gender':   {1: 'f', 2: 'm'}.get(c['gender'], None),
                        'profile':  self.ref_asset(c['profile_path'])
                    }
                    movie['crew'].append({
                        'job':      c['job'],
                        'department':   c['department'],
                        'person': {
                            '_type':    'reference',
                            '_ref':     'person-{}'.format(c['id'])
                        }
                    })

    def dump(self, output):
        tables = [
            self.assets,
            self.collections,
            self.companies,
            self.genres,
            self.movies,
            self.persons,
        ]

        for table in tables:
            for _, row in sorted(table.items()):
                json.dump(row, output, separators=(',', ':'), sort_keys=True)
                output.write("\n")

if __name__ == "__main__":
    import sys

    c = Converter()

    if len(sys.argv) <= 1:
        print("usage: {} <directory> > dataset.ndjson".format(sys.argv[0]))
        sys.exit(1)

    c.read(sys.argv[1])
    c.dump(sys.stdout)
