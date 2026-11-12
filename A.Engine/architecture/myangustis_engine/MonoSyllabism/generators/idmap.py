from myangustis_engine.MonoSyllabism.main.grapheme.tree_loaded import mappings

def burmese_to_id(text): return mappings()['burmese'].get(text) if text else None


def ascii_to_id(text): return mappings()['ascii'].get(text) if text else None


def id_to_burmese(text): return mappings()['id_burmese'].get(text) if text else None


def id_to_ascii(text): return mappings()['id_ascii'].get(text) if text else None
