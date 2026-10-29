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

    def is_base(slot):
        return slot in bases

    if len(slots) >= 3 and slots[0] == '\u1031' and slots[1] == '\u103c' and is_base(slots[2]):
        return [slots[2], slots[1], slots[0], *slots[3:]]
    if len(slots) >= 2 and slots[0] == '\u103c' and is_base(slots[1]):
        return [slots[1], slots[0], *slots[2:]]
    if len(slots) < 2 or slots[0] != '\u1031' or not is_base(slots[1]):
        return slots

    zawcode = layout.lower() == 'zawcode'

    def is_ya(slot):
        return slot == '\u103b' or (zawcode and bool(re.fullmatch(r'\u103b[\u103d\u103e]+', slot)))

    ya = 2 if len(slots) > 2 and is_ya(slots[2]) else -1
    if ya < 0 and zawcode:
        for i in range(2, min(8, len(slots))):
            slot = slots[i]
            if is_ya(slot):
                ya = i
                break
            if any(c == '\u1039' or not '\u102b' <= c <= '\u103e' for c in slot):
                break
    if ya >= 0:
        # Split a compound keyboard slot only at its leading ya; preserve the
        # remaining characters and slots in their original order.
        tail = slots[ya][1:]
        return [slots[1], '\u103b', slots[0], *slots[2:ya], *([tail] if tail else []), *slots[ya + 1:]]
    return [slots[1], slots[0], *slots[2:]]
