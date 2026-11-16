"""Evidence for the legacy code-page decision: shared glyphs and numbers.

Nothing here rewrites a page. ``normalize/cleanup.order_text`` is the one
ordering the chain gives a page (see ``workflow/finish.py``), and this module's
own visual-order slot rules -- ``legacy_bases``, ``reorder_legacy_slots``,
``reorder_zawcode_text``, ``count_zawcode_evidence`` -- are **deleted**, not
parked: they moved the same ``ေ``/``ြ`` that ``cleanup`` already moves, so on
44,601 corpus lines they changed 15,846 and removed zero ``orphan`` or
``impossible`` hits. Their only readers, ``tools-box/python/zawcode-gid-contexts.py``
and ``zawcode-order-evidence.py``, went with them.

THE LEGACY LANE'S OWN ORDERING RULE DOES NOT EXIST HERE, AND THAT IS THE STATE OF
THE DESIGN, NOT AN OVERSIGHT. In the chain the legacy lane's beautify step is a
legacy ordering rule; neither tree implements one, and the mirror says so itself
(``@core/runtime/finalized-cmap.js``): "Legacy pages are written as decoded, then
given the one shared ordering (orderUnicodeText) every lane gets at page finish.
There is no legacy-specific reorder rule: extraction only decodes." So the slot is
left empty rather than filled with a rule nothing calls -- an unwired imitation is
worse than no rule, because the next reader cannot tell which of the two a legacy
page went through. When legacy ordering lands it lands in ``finish.apply_decision``'s
``legacy`` branch (the lane's beautify slot) and in the JS ``decision === "legacy"``
line at the same time, with the parity oracle re-pinned in the same change. See
``B.Parser/AUDIT.md``, "The legacy ordering rule does not exist in either tree".

What remains below is the shared-glyph pairs from ``homoglyphs.json`` and the
Burmese-number test that tells ``ဝ`` from ``၀``: ``extract/legacy_judgement``
ranks the two legacy code pages with it, and ``normalize/judgement`` carries the
count on every lane.
"""

import re
from functools import lru_cache

from myangustis_parser.normalize.beautify import arrange_zawcode_order
from myangustis_parser.normalize.mm_score import MARKS
from myangustis_parser.resources import maps



def fix_digit_consonant_confusion(text):
    """Restore the consonant ``ဝ`` where a legacy face wrote the digit ``၀``.

    U+101D (the consonant wa) and U+1040 (digit zero) are the same shape, and
    legacy code pages routinely resolve the shared glyph to the digit. The
    disambiguation is structural: a digit cannot carry a dependent mark, so a
    ``၀`` wearing one is really the consonant.

    Two structural cases, and nothing else:

    1. a digit wearing a dependent MARK;
    2. a digit with a Myanmar letter or mark on BOTH sides -- it is inside a
       word, and a number is not. This is the common one: the neighbour in
       front is usually a mark, not a base (``ပါ၀င်`` ×327, ``တာ၀န်``, ``တာ၀တိံ``,
       ``သာ၀က``), so requiring a base in front finds nothing at all.

    A digit is never a letter or a mark, so a real number is untouched from
    either side: ``၁၀``, ``၅၀၊`` and a ``၀`` after a space stay digits.

    The same glyph runs the other way too: ``\u101b`` (ra) and ``\u1047`` (digit seven)
    are one shape, so a ``\u101b`` INSIDE a run of digits is the digit -- ``\u1041\u101b`` is
    17 and ``\u1043\u1048\u101b`` is 387. Never when a letter or mark follows, or ``\u1045\u101b\u1000\u103a``
    (five days) would lose its ``\u101b\u1000\u103a``.

    On a 445-page legacy grammar this takes orphan marks from 4.47% to 2.20%,
    and the later cases convert a further ~1,700 occurrences.
    """
    def letter_or_mark(ch):
        # ch may be "" at a string edge, and "" is `in` every string
        return bool(ch) and ("\u1000" <= ch <= "\u1021"
                             or ch in ("\u1025", "\u1027", "\u1039")
                             or ch in MARKS)

    def digit(ch):
        return bool(ch) and "\u1040" <= ch <= "\u1049"

    out = list(text)
    n = len(out)
    for i in range(n):
        after = out[i + 1] if i + 1 < n else ""
        before = out[i - 1] if i else ""
        if out[i] == "\u1040":
            # ၀ -> ဝ : the digit is wearing a mark, or sits inside a word
            if after in MARKS or (letter_or_mark(before) and letter_or_mark(after)):
                out[i] = "\u101d"
            # ...or it OPENS a word: a number does not run into a consonant
            elif not digit(before) and not letter_or_mark(before) \
                    and "\u1000" <= after <= "\u1021":
                out[i] = "\u101d"
    text = "".join(out)

    # ရ and ၇ are the same glyph, and the test is simply this: the shape is
    # ရ unless a digit sits next to it. ရက် always carries its က်, so a
    # following Myanmar letter or mark means ရ -- while a following digit, or
    # another ရ, keeps it numeric.
    #
    #   ၅ရက်   -> ၅ရက်    (five days; က follows, so it is the word)
    #   ရ၅ကတ္တား -> ၇၅ ကတ္တား  (index: the page number runs into the entry)
    #   ၃ရရ     -> ၃၇၇      (page 377)
    #   ၅၀ရာ    -> ၅၀ရာ     (ာ follows, so it is ရာ)
    #
    # Repeated to a fixed point so a run of ရ resolves from either end:
    # ရရ၅ needs the rightmost to become ၇ before the leftmost can see a digit.
    for _ in range(3):
        chars = list(text)
        changed = False
        for i, ch in enumerate(text):
            if ch != "\u101b":
                continue
            before = text[i - 1] if i else ""
            after = text[i + 1] if i + 1 < len(text) else ""
            if (digit(before) or digit(after)) and (
                    not letter_or_mark(after) or digit(after) or after == "\u101b"):
                chars[i] = "\u1047"
                changed = True
        text = "".join(chars)
        if not changed:
            break
    return text

_PREPOSED_RE = re.compile(
    r"((?:ေ?ြ[ွှ]+)|[ြေ]+)"         # preposed slots, including compound ra
    r"([က-အ၀၈၇])"                 # its base
    r"(င်္)?"                       # kinzi, written after the base
    r"((?:္[က-အ])*)"                # any stacked consonants
)

def visual_order(text):
    """The ZawCode visual map order, put back into code-point order.

    Named for the order it reads: a legacy subset table -- Ayar, WinInnwa, ZawCode
    Keymagic -- files each glyph at the slot its keyboard struck, so a decode
    straight out of a table is in VISUAL order. ``ြ``/``ေ`` sit in front of their
    base and ``့`` sits wherever its slot was, which is not where Unicode 16 wants
    a mark. Beautify is what normally fixes that, and beautify runs AFTER the lane
    has been chosen, so anything that judges a reading before beautify has to
    judge it in this order and count a mark in the wrong slot as the valid Burmese
    glyph it is. The flip itself is the ZawCode slot swap, with this lane's
    zero-width markers kept.

    ``\u103c``/``\u1031`` movement -- the preposed rules below -- is this rule's
    ancestor: the minimal set stayed here while the branch grew into
    ``beautify/arrange_zawcode_order`` once a real ZawCode PDF forced the longer
    slot patterns (``\u1031\u103c``+base+``\u1031``+base, the four- and five-slot
    swaps). A legacy face can carry the same encoding, so the legacy lane needs
    the descendant too, not only the ancestor.

    The swap drops U+200B as its first act while this lane's contract preserves
    zero-width text, so the markers are taken off before the swap and put back at
    their original offsets after it.
    """
    marks = [(i, ch) for i, ch in enumerate(text) if ch == '\u200b']
    if not marks:
        return arrange_zawcode_order(text)
    swapped = arrange_zawcode_order(''.join(ch for ch in text if ch != '\u200b'))
    out = list(swapped)
    for i, ch in marks:
        out.insert(min(i, len(out)), ch)
    return ''.join(out)


#: The order's own name, kept so the call sites below read as the rule they apply.
_zawcode_swap = visual_order


def arrange_legacy_order(text):
    """
    The legacy lane's beautify rule: visual order in, code-point order out.

    This is the rule the chain puts in the legacy lane's own slot -- called from
    ``workflow/finish.apply_decision`` for ``decision == 'legacy'``, BEFORE the one
    shared ordering every lane gets at the page finish (``cleanup.order_text``),
    and never from the extraction join, where it sat behind a ``legacy_text_fix``
    boolean that ``workflow/pipeline`` then switched off. The switch is deleted: a
    lane's repair is not optional, and a repair no pipeline reaches is worse than
    none, because the next reader cannot tell whether the bytes were fixed.

    It carries the ZawCode swap as well (see :func:`_zawcode_swap`): the preposed
    movement below is that rule's ancestor, left minimal here while the branch
    grew for ZawCode PDFs, and a legacy face can be encoded either way.

    Intentionally small and conservative: it mirrors the established Ayar ->
    Myanmar3 conversion -- move preposed \u103c/\u1031 after the base, move the
    \u1004\u103a\u1039 clusters into their Unicode order -- and preserves zero-width
    text.
    """
    text = _zawcode_swap(text)
    # A combined kinzi/vowel glyph can precede medials in legacy order.
    text = re.sub(r"([က-အ])(င်္)([ိီံ])([ျြွှ]+)", r"\1\2\4\3", text)
    # ONE left-to-right pass for the preposed vowels. Two passes cannot work:
    # the first would place သေကင်္တ correctly as သင်္ကေတ, and the second
    # would then see that same ေ sitting in front of တ and move it AGAIN,
    # giving သင်္ကတေ. Matching once and continuing past the replacement
    # is what keeps it put.
    #
    # The vowel clears the whole cluster, never landing inside it:
    #   base            ေက        -> ကေ
    #   stacked pair    ေဏ္ဏ     -> ဏ္ဏေ      (not ဏေ္ဏ)
    #   kinzi           ေကင်္    -> င်္ကေ     (kinzi leads the cluster)
    def reorder_preposed(match):
        vowel = match.group(1)
        if vowel.startswith("ေြ") and ("ွ" in vowel or "ှ" in vowel):
            vowel = vowel[1:] + "ေ"
        return (match.group(3) or "") + match.group(2) + (match.group(4) or "") + vowel

    text = _PREPOSED_RE.sub(reorder_preposed, text)

    # A kinzi that is NOT followed by a consonant cannot belong to one on its
    # right, so it belongs to the cluster on its left and moves in front of
    # it: သချင်္ာ -> သင်္ချာ. When a consonant DOES follow, the kinzi is
    # already where it belongs (ဝါစင်္ဂ) and is left alone -- 460 of those
    # here against 24 of the broken shape.
    #
    # This repairs the AUTHOR'S TYPING, not a decoding error. The raw stream
    # really holds \u101e \u1001 \u103b \u1004\u103a\u1039 \u102c (medial BEFORE kinzi) for all 24
    # occurrences -- the order the legacy input method does not accept. The
    # two encodings differ in how loudly they say so: Zawgyi renders that
    # order visibly wrong, while Unicode reorders on the fly and renders it
    # correctly, so in Unicode the same mistake is INVISIBLE and only the
    # code points show it. That is why the matching scanner check compares
    # code points and never shapes.
    #
    # It has to run AFTER the preposed vowel has been placed, and the group
    # it jumps must include that vowel. သေဘင်္ာ is သင်္ဘော: moving the
    # kinzi first leaves it sitting behind ေ, and the preposed rule then
    # splits it apart and destroys it (18 သင်္ဘော, 7 တနင်္ဂနွေ, 6 ခြင်္သေ့
    # were lost that way).
    text = re.sub(r"([\u1000-\u1021][\u102b-\u103e]*)"
                  r"(\u1004\u103a\u1039)(?![\u1000-\u1021])",
                  r"\2\1", text)
    # Pair medials with the base before ေ, including a combined ya/wa/ha.
    text = re.sub(r"([က-အ၀၇၈])ေ([ျြ]?)([ွှ]+)", r"\1\2\3ေ", text)
    text = re.sub(r"([က-အ၀၇၈])(ေ)([ျြ])", r"\1\3\2", text)
    text = re.sub(r"([က-အ])([က-အ])(င်္)", r"\1\3\2", text)
    # Ayar writes ဦး as ဦး in a number of older subsets.
    text = text.replace("ဦး", "ဦး")

    # The AA-vowel step used to be gated on ``_aa_vowel_rule_for_legacy(doc)``,
    # which read the decoder's ``legacy_code_page``/``map``: true for both legacy
    # code pages and for the default map -- always true on this lane, and the only
    # way it came out false was the deleted switch. So the gate is gone and the
    # rule simply runs; the predicate stayed behind in the extract stage, where it
    # has no subject left.
    #
    # Reorder-by-priority is NOT done here. It belongs to exactly one place,
    # cleanup.reorder_marks, which reads the single shared priority table;
    # a second implementation here drifted from it once already. What stays
    # is what only this function can do: the legacy font's visual order.
    #
    # The single-word substitution that used to live here (a ``ဲ``/``ွ`` mix-up
    # in one Arlarwade subset) is gone: per-resource decoding removed the
    # cause, and patching one word of one document was never a fix.
    # A digit cannot carry a mark; restore the consonant so the marks that
    # follow have a base to attach to.
    text = fix_digit_consonant_confusion(text)
    # In these legacy layouts, ya/ra uses ာ rather than ါ. Apply this only
    # after visual-order conversion, without moving the other marks.
    text = re.sub(r"([က-အ][ျြ][ျြွှ]*ေ?)ါ", r"\1ာ", text)
    return text

# ══════════════════════════════════════════════════════════════════════════
# THE SHARED GLYPH, AND THE NUMBER TEST THAT DIVIDES IT
# ``homoglyphs.json`` lists code-point pairs that ONE glyph stands for in these
# faces: ``ဝ``/``၀``, ``ရ``/``၇``, ``ဉ``/``ဥ``. A code page has to resolve the
# shared glyph to one side, and when it picks wrong the other side is what the
# text meant -- so a reading can look like fluent Burmese and still be wrong.
# The scanner's ``digit`` kind sees it, and so does the historical rule from
# ``@postprocess/beautify/beautify.js``, whose whole test is that a Myanmar
# number is not a word: ``၀၁၂`` is a number and proves nothing, while a digit
# inside a syllable run is not Burmese at all. That is the ``ဝ``-from-``၀``
# detection, kept here beside the pairs it reads.
#
# It is evidence, not a rewrite. Repairing these pairs needs the master word
# data (JS ``beautifyToken`` only ever acted when exactly one variant was a
# word), and the beautify chain owns that; the parse chain's use is the count --
# ``extract/legacy_judgement.decide_legacy_family`` ranks the two legacy code
# pages by it, and ``normalize/judgement.judge_page_lines`` carries it on every
# lane so the report says what the page looked like.
# ══════════════════════════════════════════════════════════════════════════

#: A Myanmar run including the digit block, so a numeral inside a word stays
#: inside the token where it can be seen (JS ``MM_RUN``).
MM_RUN = re.compile('[\u1000-\u1049\u105a-\u109f]+')
_ONLY_DIGITS = re.compile('[\u1040-\u1049]+')


@lru_cache(maxsize=1)
def homoglyph_pairs():
    """``[(letter, digit, what they are)]`` straight from the map, unedited."""
    return tuple(tuple(entry) for entry in maps.load_map('homoglyphs.json')['pairs'])


@lru_cache(maxsize=1)
def numeral_pairs():
    """The pairs whose second side really is a Myanmar numeral.

    Two of the three are: ``ဝ``/``၀`` and ``ရ``/``၇``. ``ဉ``/``ဥ`` shares a glyph
    between two letters, and no number tells those apart -- the dictionary does
    or nothing does. So every count below reads this subset and never the full
    pair list: treating ``ဥ`` as "a digit inside a word" would flag ordinary
    Burmese.
    """
    return tuple(entry for entry in homoglyph_pairs()
                 if _ONLY_DIGITS.fullmatch(entry[1]))


def is_burmese_number(token):
    """True for a run that is nothing but Myanmar digits: a number, not a word.

    JS said why this is the exception that matters: a number on its own is not
    evidence that ``၀`` or ``၇`` should become a letter.
    """
    return bool(token) and _ONLY_DIGITS.fullmatch(token) is not None


def number_in_word_sites(text):
    """``[(offset, token)]`` for every shared-glyph digit inside a Myanmar word.

    On a legacy page this means the code page resolved the shared glyph to the
    numeral side where the text wanted the letter -- a structural error of the
    same family as the ones ``normalize/scan.py`` counts, and the reason a
    reading with more of them is the worse reading. A run of digits only is a
    number and is never counted: see :func:`is_burmese_number`.
    """
    sites = []
    if not text:
        return sites
    for match in MM_RUN.finditer(text):
        token = match.group(0)
        if is_burmese_number(token):
            continue
        for offset, char in enumerate(token):
            for _letter, digit, _label in numeral_pairs():
                if char == digit:
                    sites.append((match.start() + offset, token))
    return sites
