"""Load mapping tables from the existing encrypted master, never from WASM."""
from functools import lru_cache
from myangustis_engine.secure_data.secure import read_master_json


@lru_cache(maxsize=1)
def tables():
    data = dict(read_master_json()['mapData'])
    for key in ('PUNCTUATION', 'Glue', 'ENGLISH_DIGITS', 'BURMESE_DIGITS', 'BLOCK_PUNCT'):
        data[key] = set(data.get(key, []))
    data['ALL_DIGITS'] = data['ENGLISH_DIGITS'] | data['BURMESE_DIGITS']
    return data
