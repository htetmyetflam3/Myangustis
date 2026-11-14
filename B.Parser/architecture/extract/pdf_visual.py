"""Font-local visual Unicode recovery, mirrored from JS codepage-visual.js.

A recovery requires the resource's own contradictory mappings and an exact,
independent outline witness. Names and document hashes never select a font.
"""
import hashlib
import struct

from myangustis_parser.resources import maps

_PREFIX = {'ေ', 'ြ'}
_MARKS = {'e': 'ေ', 'ra': 'ြ', 'raWa': 'ြွ', 'ya': 'ျ', 'wa': 'ွ', 'kinzi': 'င်္'}


def _consonant(cp):
    return isinstance(cp, int) and 0x1000 <= cp <= 0x1021


def _base(cp):
    return _consonant(cp) or (isinstance(cp, int) and (0x1023 <= cp <= 0x1027 or cp in (0x1029, 0x102a, 0x103f, 0x104e)))


def _groups(decoder):
    return getattr(decoder.to_unicode, 'by_width', None) or {2: decoder.to_unicode or {}}


def has_visual_unicode_conflicts(decoder):
    direct = getattr(decoder.own_gids, 'direct', {})
    if not decoder.is_cid or not decoder.to_unicode or not direct:
        return False
    contradictions = set()
    for width, entries in _groups(decoder).items():
        for code, text in entries.items():
            if text not in _PREFIX and not (decoder.conflicting_space_map and text == ' '):
                continue
            gid = decoder.gid_for(decoder.cmap.cid_for(code, width))
            if _consonant(direct.get(gid)):
                contradictions.add(gid)
    return len(contradictions) >= 2


def _glyph_digester(data):
    if not isinstance(data, bytes) or len(data) < 12:
        return None
    tables = {}
    for i in range(struct.unpack_from('>H', data, 4)[0]):
        at = 12 + i * 16
        if at + 16 > len(data):
            break
        name = data[at:at + 4]
        offset, length = struct.unpack_from('>II', data, at + 8)
        if offset <= len(data) and length <= len(data) - offset:
            tables[name] = (offset, length)
    if any(name not in tables or tables[name][1] < minimum
           for name, minimum in ((b'head', 54), (b'maxp', 6), (b'loca', 4), (b'glyf', 0))):
        return None
    head, maxp, loca, glyf = (tables[n] for n in (b'head', b'maxp', b'loca', b'glyf'))
    fmt = struct.unpack_from('>h', data, head[0] + 50)[0]
    count = struct.unpack_from('>H', data, maxp[0] + 4)[0]
    if fmt not in (0, 1) or loca[1] < (count + 1) * (4 if fmt else 2):
        return None
    memo = {}
    def digest(gid):
        if not isinstance(gid, int) or gid < 0 or gid >= count:
            return None
        if gid in memo:
            return memo[gid]
        offset = lambda i: (struct.unpack_from('>I', data, loca[0] + 4 * i)[0] if fmt
                            else struct.unpack_from('>H', data, loca[0] + 2 * i)[0] * 2)
        start, end = offset(gid), offset(gid + 1)
        result = None
        if start <= end <= glyf[1] and end - start >= 10:
            glyph = data[glyf[0] + start:glyf[0] + end]
            if struct.unpack_from('>h', glyph, 0)[0] > 0:
                result = hashlib.sha256(glyph).hexdigest()
        memo[gid] = result
        return result
    return digest


class VisualGlyphs(dict):
    def __init__(self, base_conflicts):
        super().__init__()
        self.base_conflicts = base_conflicts


def match_visual_unicode_glyphs(decoder, program):
    if not has_visual_unicode_conflicts(decoder):
        return None
    digest = _glyph_digester(program)
    if not digest:
        return None
    by_cp = {cp: gid for gid, cp in decoder.own_gids.direct.items()}
    matching = []
    for witness in maps.load_map('visual-unicode-glyph-evidence.json')['witnesses']:
        compared = agreed = 0
        for hex_cp, expected in witness['anchors'].items():
            actual = digest(by_cp.get(int(hex_cp, 0)))
            if not actual:
                continue
            compared += 1
            agreed += actual == expected
        if compared >= 8 and agreed == compared:
            matching.append(witness)
    if len(matching) != 1:
        return None
    witness = matching[0]
    roles = VisualGlyphs(witness.get('baseConflicts', {}))
    for width, entries in _groups(decoder).items():
        for code in entries:
            gid = decoder.gid_for(decoder.cmap.cid_for(code, width))
            glyph = digest(gid)
            role = witness['marks'].get(glyph)
            suffix = witness.get('clusterSuffixes', {}).get(glyph)
            if role or suffix:
                roles[gid] = {'role': role, 'suffix': suffix,
                              'yaPlusEConflict': witness.get('yaPlusEConflict') is True,
                              'spaceMappedMark': role in witness.get('spaceMarkRoles', [])}
    return roles or None


def _tokens_for(decoder, parts):
    tokens = []
    for data in parts:
        for code, cid, width in decoder.cmap.iter_codes(data):
            old = decoder.decode_code(code, cid, width) if cid is not None else None
            original = old if old is not None else f'[{code:0{width * 2}X}]'
            if cid is None:
                tokens.append({'original': original})
                continue
            gid = decoder.gid_for(cid)
            witness = decoder.visual_unicode_glyphs.get(gid) or {}
            role = witness.get('role')
            scalar = len(original) == 1 and '\u1000' <= original <= '\u109f'
            ya_plus_e = role == 'ya' and witness.get('yaPlusEConflict') and original == 'ျေ'
            missing = (role and decoder.conflicting_space_map and original == ''
                       and decoder._to_unicode_for_code(decoder.to_unicode, code, width) == ' ')
            space_mark = role in ('ra', 'raWa') and witness.get('spaceMappedMark') and original == ' '
            if role and (scalar or ya_plus_e or missing or space_mark):
                tokens.append({'role': role, 'original': original, 'text': _MARKS[role],
                               'missingMark': missing, 'yaPlusE': ya_plus_e})
                continue
            cp = getattr(decoder.own_gids, 'direct', {}).get(gid)
            if _base(cp):
                direct = chr(cp)
                conflict = original in decoder.visual_unicode_glyphs.base_conflicts.get(direct, [])
                if original == direct or (_consonant(cp) and (original in _PREFIX or conflict)):
                    tokens.append({'role': 'base', 'original': original, 'text': direct,
                                   'multiConflict': bool(conflict and len(original) > 1)})
                    continue
            tokens.append({'original': original,
                           'suffix': original if witness.get('suffix') == original else None,
                           'realSpace': cp in (0x20, 0xa0) and len(original) == 1 and original.isspace()})
    return tokens


def decode_visual_unicode_run(decoder, parts, *, on_unresolved=None, starts_at_boundary=False):
    tokens = _tokens_for(decoder, parts)
    def get(i):
        return tokens[i] if 0 <= i < len(tokens) else {}
    def suffix(i, value):
        return get(i).get('suffix') == value
    def left_edge(i):
        return starts_at_boundary if i == 0 else (get(i - 1).get('role') in ('base', 'ya', 'wa')
                or bool(get(i - 1).get('suffix')) or get(i - 1).get('realSpace') is True)
    def bare_base(i):
        return left_edge(i) and (suffix(i + 1, '်') or (suffix(i + 1, 'ိ') and suffix(i + 2, 'ု'))
                                or (suffix(i + 1, 'ာ') and suffix(i + 2, 'း')))
    def bare_ya(i):
        if get(i - 1).get('role') != 'base' or not left_edge(i - 1):
            return False
        return ((suffix(i + 1, 'ာ') and suffix(i + 2, 'း'))
                or (suffix(i + 1, 'ိ') and suffix(i + 2, 'ု') and suffix(i + 3, 'း'))
                or (get(i + 1).get('role') == 'base' and suffix(i + 2, '်'))
                or (suffix(i + 1, 'ု') and get(i + 2).get('role') == 'base' and suffix(i + 3, '်')))
    for i in range(1, len(tokens)):
        if get(i).get('role') == 'kinzi' and get(i - 1).get('role') == 'base' and not get(i - 1).get('multiConflict'):
            tokens[i - 1], tokens[i] = tokens[i], tokens[i - 1]
            tokens[i - 1]['confirmed'] = True
    output, i = [], 0
    while i < len(tokens):
        j = i
        e = get(j).get('role') == 'e'
        if e:
            j += 1
        ra_role = get(j).get('role') if get(j).get('role') in ('ra', 'raWa') else ''
        if ra_role:
            j += 1
        ra = _MARKS.get(ra_role, '')
        kinzi = ''
        if get(j).get('role') == 'kinzi' and get(j).get('confirmed'):
            kinzi = get(j)['text']
            j += 1
        if (e or ra) and get(j).get('role') == 'base':
            base = get(j)
            j += 1
            tail, ya_count = '', 0
            while j < len(tokens) and (get(j).get('role') in ('ya', 'wa') or
                    (not get(j).get('role') and get(j)['original'] in ('ွ', 'ှ', 'ျှ', 'ွှ'))):
                tail += get(j).get('text', get(j)['original'])
                ya_count += bool(get(j).get('yaPlusE'))
                j += 1
            ya_base = (base['original'] == 'ြွေ' and e and not ra and ya_count == 1
                       and tail == 'ျ' and suffix(j, 'ာ') and suffix(j + 1, '်'))
            ra_base = (base['original'] == 'ြွေ' and not e and ra_role == 'ra' and not tail
                       and suffix(j, 'ီ') and suffix(j + 1, 'း'))
            e_base = (base['original'] == 'ြွေ' and e and not ra and not tail and suffix(j, 'ာ')
                      and (suffix(j + 1, '်') or (get(j + 1).get('role') == 'base' and suffix(j + 2, '်'))))
            complete = not base.get('multiConflict') or (base['original'] == 'ြွေ' and e and ra_role == 'raWa') or ya_base or ra_base or e_base
            ya_complete = not ya_count or (ya_count == 1 and e and (not base.get('multiConflict') or ya_base))
            if complete and ya_complete and not (ra and 'ျ' in tail):
                output.append(kinzi + base['text'] + ra + tail + ('ေ' if e else ''))
                i = j
                continue
        token = get(i)
        follows = get(i - 1).get('role') == 'base' or (token.get('role') == 'wa'
                  and get(i - 1).get('role') == 'ya' and get(i - 2).get('role') == 'base')
        resolved_base = token.get('multiConflict') and token['original'] == 'ြွေ' and bare_base(i)
        resolved_ya = token.get('yaPlusE') and bare_ya(i)
        if on_unresolved and ((token.get('multiConflict') and not resolved_base) or (token.get('yaPlusE') and not resolved_ya)):
            on_unresolved()
        if ((token.get('role') == 'base' and (not token.get('multiConflict') or resolved_base))
                or (token.get('role') == 'kinzi' and token.get('confirmed'))
                or (token.get('role') in ('ya', 'wa') and follows and (not token.get('yaPlusE') or resolved_ya))
                or token.get('missingMark')):
            output.append(token['text'])
        else:
            output.append(token['original'])
        i += 1
    return ''.join(output)
