"""Visual-order slot rearrangement for Ayar, WinInnwa and ZawCode."""

import json
import re
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def legacy_bases():
    path = Path(__file__).resolve().parents[2] / 'parser/jason-map/burmese-inventory.json'
    with path.open(encoding='utf-8') as source:
        return frozenset(json.load(source)['consonants']) | {'၎'}


def reorder_legacy_slots(input_slots, *, layout="wininnwa"):
    """Reorder only the leading visual-order slots, preserving the suffix."""
    if not isinstance(input_slots, (list, tuple)) or any(
            not isinstance(slot, str) or not slot for slot in input_slots):
        raise TypeError("Expected non-empty Unicode slots")
    slots = list(input_slots)

    bases = legacy_bases()
    zawcode = layout.lower() == 'zawcode'

    def is_base(slot):
        return slot in bases

    def is_ra(slot):
        return slot == '\u103c' or (zawcode and bool(re.fullmatch(r'\u103c[\u103d\u103e]+', slot)))

    def is_ya(slot):
        return slot == '\u103b' or (zawcode and bool(re.fullmatch(r'\u103b[\u103d\u103e]+', slot)))

    def mark_summary(start):
        ra = ya = False
        for slot in slots[start:8]:
            if any(c == '\u1039' or not '\u102b' <= c <= '\u103e' for c in slot):
                break
            ra |= '\u103c' in slot
            ya |= '\u103b' in slot
        return ra, ya

    if len(slots) >= 3 and slots[0] == '\u1031' and is_ra(slots[1]) and is_base(slots[2]):
        if zawcode and mark_summary(3)[1]:
            return slots
        return [slots[2], slots[1], slots[0], *slots[3:]]
    if len(slots) >= 2 and is_ra(slots[0]) and is_base(slots[1]):
        if zawcode and mark_summary(2)[1]:
            return slots
        return [slots[1], slots[0], *slots[2:]]
    if len(slots) < 2 or slots[0] != '\u1031' or not is_base(slots[1]):
        return slots
    if zawcode:
        seen_ra, seen_ya = mark_summary(2)
        if seen_ra and seen_ya:
            return slots

    ya = 2 if len(slots) > 2 and is_ya(slots[2]) else -1
    if ya < 0 and zawcode:
        for i in range(2, min(8, len(slots))):
            slot = slots[i]
            if is_ya(slot):
                ya = i
                break
            # Do not infer an order for a combined ra+ya cluster.
            if any(c in ('\u1039', '\u103c') or not '\u102b' <= c <= '\u103e' for c in slot):
                break
    if ya >= 0:
        # Keep a compound ya+wa/ha glyph together; preserve the other slots.
        return [slots[1], slots[ya], slots[0], *slots[2:ya], *slots[ya + 1:]]
    if zawcode:
        end = 2
        while end < len(slots) and re.fullmatch(r'[\u103d\u103e]+', slots[end]):
            end += 1
        if end > 2:
            return [slots[1], *slots[2:end], slots[0], *slots[end:]]
    return [slots[1], slots[0], *slots[2:]]


def reorder_zawcode_text(text):
    """Apply leading-slot rules without cleanup, normalization or mark loss."""
    if not isinstance(text, str):
        raise TypeError('Expected text')
    chars = list(text)
    bases = legacy_bases()
    out = []

    def mark_span(start, limit):
        end = start
        seen_ra = seen_ya = False
        while end < min(limit, len(chars)):
            ch = chars[end]
            if ch == '္' or not '\u102b' <= ch <= '\u103e':
                break
            seen_ra |= ch == 'ြ'
            seen_ya |= ch == 'ျ'
            end += 1
        return end, seen_ra, seen_ya

    i = 0
    while i < len(chars):
        has_e = chars[i] == 'ေ'
        ra = i + 1 if has_e else i
        if ra < len(chars) and chars[ra] == 'ြ':
            base = ra + 1
            while base < len(chars) and chars[base] in ('ွ', 'ှ'):
                base += 1
            if base < len(chars) and chars[base] in bases:
                end, _, seen_ya = mark_span(base + 1, i + 8)
                if seen_ya:
                    out.extend(chars[i:end])
                    i = end
                    continue
                medial = ''.join(chars[ra:base])
                slots = ['ေ', medial, chars[base]] if has_e else [medial, chars[base]]
                out.extend(reorder_legacy_slots(slots, layout='zawcode'))
                i = base + 1
                continue
        if has_e and i + 1 < len(chars) and chars[i + 1] in bases:
            end, seen_ra, seen_ya = mark_span(i + 2, i + 8)
            if seen_ra and seen_ya:
                out.extend(chars[i:end])
                i = end
                continue
            ya = -1
            for j in range(i + 2, min(i + 8, len(chars))):
                ch = chars[j]
                if ch == 'ျ':
                    ya = j
                    break
                if ch in ('္', 'ြ') or not '\u102b' <= ch <= '\u103e':
                    break
            end = i + 2
            if ya >= 0:
                end = ya + 1
                while end < len(chars) and chars[end] in ('ွ', 'ှ'):
                    end += 1
                slots = [chars[i], chars[i + 1], *chars[i + 2:ya], ''.join(chars[ya:end])]
            else:
                while end < len(chars) and chars[end] in ('ွ', 'ှ'):
                    end += 1
                slots = chars[i:end]
            out.extend(reorder_legacy_slots(slots, layout='zawcode'))
            i = end
            continue
        out.append(chars[i])
        i += 1
    return ''.join(out)


def count_zawcode_evidence(text):
    """Count the leading e+ra+base pattern for the font-scoped draft probe."""
    bases = legacy_bases()
    return sum(1 for i in range(len(text) - 2)
               if text[i] == 'ေ' and text[i + 1] == 'ြ' and text[i + 2] in bases)
