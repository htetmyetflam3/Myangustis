from myangustis_engine.MonoSyllabism.main.grapheme.tree_loaded import load_tree
from myangustis_engine.MonoSyllabism.main.grapheme.reverse import walk_reverse
from myangustis_engine.MonoSyllabism.utilities.js_string import utf16_units

_COMPILED_SYLLABLE_TREE = (None, None)
_COMPILED_REVERSE_MEMO = (None, {})


def _compile_syllable_tree(tree):
    compiled = {}
    for root, node in (tree.get('Root') or {}).items():
        if not isinstance(node, dict):
            continue
        steps = {}
        for key, items in node.items():
            if items is None:
                continue
            by_first = {}
            empty = []
            for item in items:
                token = next(iter(item), None)
                if token is None:
                    continue
                u16 = utf16_units(token)
                ids = item[token]
                has_ids = bool(isinstance(ids, list) and ids)
                rec = (u16, len(u16), has_ids)
                if u16:
                    by_first.setdefault(u16[0], []).append(rec)
                else:
                    empty.append(rec)
            steps[key] = (by_first, empty)
        compiled[root] = steps
    return compiled


def _get_compiled_roots(default_tree):
    global _COMPILED_SYLLABLE_TREE
    cached_src, cached_roots = _COMPILED_SYLLABLE_TREE
    if cached_src is not default_tree:
        cached_roots = _compile_syllable_tree(default_tree)
        _COMPILED_SYLLABLE_TREE = (default_tree, cached_roots)
    return cached_roots


def walk(block, start_pos, tree=None, reverse_tree=None, *, _utf16=False):
    default_tree = load_tree('syllable.tree.json') if tree is None else None
    default_rtl = load_tree('rtl-tree.json') if reverse_tree is None else None
    reverse_tree = default_rtl if default_rtl is not None else reverse_tree
    if not _utf16:
        block = utf16_units(block)
    root = block[start_pos]
    safe = start_pos + 1
    current_id = None
    n = len(block)

    if default_tree is not None or tree is load_tree('syllable.tree.json'):
        steps = _get_compiled_roots(default_tree or tree).get(root)
        if not steps:
            return {'endPos': safe, 'lastValidPos': safe, 'id': None}
        rtl_memo = None
        if default_rtl is not None or reverse_tree is load_tree('rtl-tree.json'):
            global _COMPILED_REVERSE_MEMO
            if _COMPILED_REVERSE_MEMO[0] is not reverse_tree:
                _COMPILED_REVERSE_MEMO = (reverse_tree, {})
            rtl_memo = _COMPILED_REVERSE_MEMO[1]
        read_pos, step, acc = safe, 1, root
        while True:
            step_key = f'St-{step}'
            key = step_key if step_key in steps else 'St-F'
            bucket = steps.get(key)
            if bucket is None:
                break
            by_first, empty = bucket
            match = None
            if read_pos < n:
                candidates = by_first.get(block[read_pos])
                if candidates:
                    for tok, tok_len, has_ids in candidates:
                        if tok_len == 1 or block.startswith(tok, read_pos):
                            match = (tok, tok_len, has_ids)
                            break
            if match is None and empty:
                match = empty[0]
            if match is None:
                break
            tok, tok_len, has_ids = match
            read_pos += tok_len
            acc += tok
            if has_ids:
                if rtl_memo is not None:
                    rev_id = rtl_memo.get(acc)
                    if rev_id is None and acc not in rtl_memo:
                        rev_id = walk_reverse(reverse_tree, acc, root)['id']
                        if len(rtl_memo) < 16384:
                            rtl_memo[acc] = rev_id
                else:
                    rev_id = walk_reverse(reverse_tree, acc, root)['id']
                if rev_id:
                    safe, current_id = read_pos, rev_id
            if key == 'St-F':
                break
            step += 1
        return {'endPos': safe, 'lastValidPos': safe, 'id': current_id}

    node = tree.get('Root', {}).get(root)
    if not node:
        return {'endPos': safe, 'lastValidPos': safe, 'id': None}
    read_pos, step, acc = safe, 1, root
    while True:
        key = f'St-{step}' if f'St-{step}' in node and node[f'St-{step}'] is not None else 'St-F'
        match = None
        for item in node.get(key, []):
            token = next(iter(item), None)
            if token is not None:
                u16 = utf16_units(token)
                if block.startswith(u16, read_pos):
                    match = (u16, item[token])
                    break
        if match is None:
            break
        token, ids = match
        read_pos += len(token)
        acc += token
        if isinstance(ids, list) and ids:
            reverse = walk_reverse(reverse_tree, acc, root)
            if reverse['id']:
                safe, current_id = read_pos, reverse['id']
        if key == 'St-F':
            break
        step += 1
    return {'endPos': safe, 'lastValidPos': safe, 'id': current_id}


def walk_pos(block, start_pos, tree=None):
    tree = load_tree('pos.tree.json') if tree is None else tree
    node = tree.get(block[start_pos])
    if not node:
        return {'endPos': start_pos + 1, 'lastValidPos': start_pos + 1, 'rawPos': ['?']}
    read_pos = valid = start_pos + 1
    current = node.get('x') or ['?']
    step = 1
    while read_pos < len(block):
        next_node = node.get(f'St-{step}', {}).get(block[read_pos])
        if next_node is None:
            break
        read_pos += 1
        if next_node.get('x'):
            valid, current = read_pos, next_node['x']
        node = next_node
        step += 1
    return {'endPos': read_pos, 'lastValidPos': valid, 'rawPos': current}
