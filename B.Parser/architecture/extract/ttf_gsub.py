"""Reverse the bounded GSUB substitutions used by the JS PDF font loader.

This interprets only single, ligature, and multiple-substitution lookups; it
never infers a character from a different font. Bad tables yield no reading.
"""
import struct

_MAX_STEPS = 2_000_000


def _u16(data, at):
    return struct.unpack_from('>H', data, at)[0] if 0 <= at <= len(data) - 2 else 0


def _u32(data, at):
    return struct.unpack_from('>I', data, at)[0] if 0 <= at <= len(data) - 4 else 0


def _coverage(data, at, budget):
    fmt, count = _u16(data, at), _u16(data, at + 2)
    out = []
    if fmt == 1:
        for i in range(count):
            pos = at + 4 + 2 * i
            if pos + 2 > len(data) or len(out) >= budget:
                break
            out.append(_u16(data, pos))
    elif fmt == 2:
        for i in range(count):
            pos = at + 4 + 6 * i
            if pos + 6 > len(data) or len(out) >= budget:
                break
            start, end = _u16(data, pos), _u16(data, pos + 2)
            out.extend(range(start, min(end + 1, start + budget - len(out))))
    return out


def _subtables(data):
    if not data or len(data) < 12:
        return
    offset = None
    for i in range(_u16(data, 4)):
        pos = 12 + i * 16
        if pos + 16 > len(data):
            break
        if data[pos:pos + 4] == b'GSUB':
            offset = _u32(data, pos + 8)
            break
    if offset is None or offset + 10 > len(data) or _u32(data, offset) not in (0x00010000, 0x00010001):
        return
    lookups = offset + _u16(data, offset + 8)
    budget = _MAX_STEPS
    for i in range(_u16(data, lookups)):
        budget -= 1
        if budget <= 0:
            break
        lookup = lookups + _u16(data, lookups + 2 + 2 * i)
        if lookup + 6 > len(data):
            break
        lookup_type = _u16(data, lookup)
        for j in range(_u16(data, lookup + 4)):
            budget -= 1
            if budget <= 0:
                return
            sub = lookup + _u16(data, lookup + 6 + 2 * j)
            kind = lookup_type
            extension = kind == 7
            if extension:
                if sub + 8 > len(data):
                    continue
                kind = _u16(data, sub + 2)
                sub += _u32(data, sub + 4)
            if sub + 6 <= len(data) and kind in (1, 2, 4):
                yield kind, sub, extension


def parse_gsub(data):
    """Return ``(output_gid -> input_gids, conservative variant groups)``."""
    reverse, singles, sequences = {}, {}, []
    budget = _MAX_STEPS
    for kind, sub, extension in _subtables(data):
        budget -= 1
        if budget <= 0:
            break
        fmt = _u16(data, sub)
        coverage = _coverage(data, sub + _u16(data, sub + 2), budget)
        budget -= len(coverage)
        if budget <= 0:
            break
        if kind == 1:
            if fmt == 1:
                delta = _u16(data, sub + 4)
                for gid in coverage:
                    out = (gid + delta) & 0xffff
                    if out != gid:
                        singles.setdefault(out, gid)
            elif fmt == 2:
                for i in range(min(_u16(data, sub + 4), len(coverage))):
                    out = _u16(data, sub + 6 + i * 2)
                    if out != coverage[i]:
                        singles.setdefault(out, coverage[i])
        elif kind == 4:
            for i in range(min(_u16(data, sub + 4), len(coverage))):
                first = coverage[i]
                if not first:
                    continue
                ligset = sub + _u16(data, sub + 6 + 2 * i)
                if ligset + 2 > len(data):
                    break
                count = _u16(data, ligset)
                budget -= count
                if budget <= 0:
                    break
                for j in range(count):
                    lig = ligset + _u16(data, ligset + 2 + 2 * j)
                    if lig + 4 > len(data):
                        break
                    out, count = _u16(data, lig), _u16(data, lig + 2)
                    if not out or out == first or out in singles or out in reverse:
                        continue
                    if lig + 2 + 2 * count > len(data):
                        continue
                    components = [first] + [_u16(data, lig + 2 + 2 * k) for k in range(1, count)]
                    if all(g and g != out for g in components[1:]):
                        reverse[out] = components
        elif kind == 2 and fmt == 1 and not extension:
            for i in range(min(_u16(data, sub + 4), len(coverage))):
                seq = sub + _u16(data, sub + 6 + 2 * i)
                if seq + 2 > len(data):
                    break
                count = _u16(data, seq)
                budget -= count
                if budget <= 0:
                    break
                if seq + 2 + count * 2 > len(data):
                    continue
                members = [_u16(data, seq + 2 + k * 2) for k in range(count)]
                # Pairwise grouping is quadratic; abstain on maliciously
                # huge sequences rather than exhaust CPU on an untrusted PDF.
                if 2 <= len(members) <= 1024 and coverage[i] in members:
                    sequences.append((members, members.index(coverage[i])))
    for out, gid in singles.items():
        reverse.setdefault(out, [gid])

    together, groups = set(), {}
    # Cap pairwise comparisons separately from table traversal: a malicious
    # PDF must not turn a compact lookup table into unbounded CPU work.
    if sum((len(members) - 1) * (len(members) - 2) // 2
           for members, _ in sequences) > _MAX_STEPS:
        return reverse, []
    for members, base_at in sequences:
        other = [g for i, g in enumerate(members) if i != base_at]
        for i, a in enumerate(other):
            for b in other[i + 1:]:
                if a and b:
                    together.add(tuple(sorted((a, b))))
        for pos, gid in enumerate(members):
            if pos == base_at or not gid:
                continue
            key = (len(members), base_at, pos, tuple(None if i == pos else g for i, g in enumerate(members)))
            groups.setdefault(key, set()).add(gid)
    variants = []
    if sum(len(group) * (len(group) - 1) // 2 for group in groups.values()) > _MAX_STEPS:
        return reverse, []
    for group in groups.values():
        members = sorted(group)
        if len(members) >= 2 and not any((a, b) in together for i, a in enumerate(members) for b in members[i + 1:]):
            variants.append(members)
    return reverse, variants


def resolve_shaped_glyphs(data, table):
    reverse, variants = parse_gsub(data)
    if not reverse:
        return table
    walking = set()
    def resolve(gid, depth):
        if gid in table:
            value = table[gid]
            return chr(value) if isinstance(value, int) else value
        if depth >= 8 or gid in walking or gid not in reverse:
            return None
        walking.add(gid)
        parts = [resolve(part, depth + 1) for part in reverse[gid]]
        walking.remove(gid)
        return ''.join(parts) if all(part is not None for part in parts) else None
    for gid in reverse:
        if gid not in table:
            text = resolve(gid, 0)
            if text:
                table[gid] = text
    for _ in range(3):
        added = False
        for group in variants:
            unknown = [gid for gid in group if gid not in table]
            if not unknown:
                continue
            known = {}
            for gid in group:
                value = table.get(gid)
                if value is not None:
                    text = chr(value) if isinstance(value, int) else value
                    if text:
                        known[text] = value
            if len(known) == 1:
                value = next(iter(known.values()))
                for gid in unknown:
                    table[gid] = value
                    added = True
        if not added:
            break
    return table
