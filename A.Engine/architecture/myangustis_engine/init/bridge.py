"""One text-in, asynchronous-stream-out engine entry point."""
from myangustis_engine.logen import Logen
from myangustis_engine.MonoSyllabism.utilities import formatter as fmt
from myangustis_engine.MonoSyllabism.map.loader import require_runtime
from myangustis_engine.MonoSyllabism.main.grapheme.cache_integrity import verify_cache_tree
from myangustis_engine.MonoSyllabism.generators.pos_input import fullstop_holder
from myangustis_engine.MonoSyllabism.generators.input import read_from_api
from myangustis_engine.bridge.Ginit import run_rule_engine
from myangustis_engine.Lexical_No_inspect.abstract.template_runtime import analyse_lines
from myangustis_engine.MonoSyllabism.main.phoneme.lexer import run_segmentor
from myangustis_engine.MonoSyllabism.main.phoneme.phonology import run_tagger
from myangustis_engine.MonoSyllabism.generators.SfomatterForP import to_line_strings

_logger = Logen()


def bind_engine(request, *, runtime=None, logger=None):
    """Return a stream of syllables, POS views, or experimental template reports."""
    if not isinstance(request, dict):
        raise TypeError('BindEngine: a request object is required')
    if not isinstance(request.get('sourceText'), str):
        raise TypeError('BindEngine: sourceText must be a string')
    if any(key in request for key in ('inputPath', 'outputPath', 'work', 'seg', 'hash')):
        raise TypeError('BindEngine: supply text without paths or a caller signature')
    if request.get('flag') not in ('syllable', 'pos', 'template'):
        raise TypeError('BindEngine: flag must be syllable, pos or template')
    for key, default in (('debug', False), ('log', True), ('quiet', False)):
        if not isinstance(request.get(key, default), bool):
            raise TypeError(f'BindEngine: {key} must be a boolean')
    if request.get('debug', False):
        raise NotImplementedError('The bridge debug path is intentionally not mirrored')
    source, flag = request['sourceText'], request['flag']
    logger = (logger or _logger) if request.get('log', True) else None

    async def stream():
        manifest = verify_cache_tree()
        required = {'syllable.tree.json', 'rtl-tree.json', 'pos.tree.json', 'syllable.mapped.txt'}
        missing = required.difference(manifest['files'])
        if missing:
            raise ValueError(f'Prebuilt tree manifest missing required files: {", ".join(sorted(missing))}')
        mapper = require_runtime(runtime)
        lines = to_line_strings(run_segmentor(read_from_api(source, mapper), mapper, logger))
        if flag == 'syllable':
            for line in lines:
                yield fmt.to_syllable_line(line)
        else:
            resolved = run_rule_engine(run_tagger(fullstop_holder(lines), mapper, logger))
            if flag == 'template':
                for report in analyse_lines(resolved):
                    yield report
            else:
                for line in resolved:
                    yield {'syllable': fmt.to_burmese_line(line), 'rawPos': fmt.to_burmese_line_with_pos(line, 'rawPos')}

    return stream()


BindEngine = bind_engine
