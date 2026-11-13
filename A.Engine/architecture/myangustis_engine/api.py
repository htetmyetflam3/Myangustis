"""Convenient in-process access to the Python engine for synchronous callers."""
import asyncio
from .init.bridge import bind_engine


async def collect(text, flag='syllable'):
    """Collect the engine's un-hashed stream without building any trees."""
    result = bind_engine({'sourceText': text, 'flag': flag, 'log': False})
    return [item async for item in result]


def collect_sync(text, flag='syllable'):
    """Synchronous adapter; async callers should await :func:`collect` instead."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(collect(text, flag))
    raise RuntimeError('An event loop is running; await myangustis_engine.api.collect instead')


def segment_text(text):
    """Return the formatted syllable stream as newline-terminated text."""
    lines = collect_sync(text, 'syllable')
    return '\n'.join(lines) + ('\n' if lines else '')


def pos_views(text):
    """Return the tagger's aligned raw POS and syllable views."""
    units = collect_sync(text, 'pos')
    def joined(key):
        return '\n'.join(unit[key] for unit in units) + ('\n' if units else '')
    return {'syllable': joined('syllable'), 'raw_pos': joined('rawPos'),
            'output_units': len(units)}


def template_views(text):
    """Return experimental draft-template analyses, one per sentence."""
    return collect_sync(text, 'template')
