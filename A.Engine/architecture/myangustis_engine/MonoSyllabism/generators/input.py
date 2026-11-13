from myangustis_engine.MonoSyllabism.utilities.stream import collect_from_text

def read_from_api(text, runtime):
    for block in collect_from_text(text):
        yield runtime.mapperNormalize(block)
