from myangustis_engine.MonoSyllabism.utilities import formatter as fmt
from myangustis_engine.MonoSyllabism.utilities.js_string import js_trim

def fullstop_holder(lines):
    unit, stops, content, previous = '', 0, False, False
    for line in lines:
        if not isinstance(line, str): continue
        if previous: unit += fmt.SPACE_TOKEN
        previous = True
        parts = line.split('√')
        for i, core in enumerate(parts):
            terminated = i < len(parts) - 1
            if not terminated and not core: continue
            unit += core + ('√' if terminated else '')
            if core == '။':
                stops += 1
                content = True
                if stops >= 2:
                    yield unit
                    unit, stops, content = '', 0, False
            elif js_trim(core):
                content = True
    if unit and content:
        yield unit
