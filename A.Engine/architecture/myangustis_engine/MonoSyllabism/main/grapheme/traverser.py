from myangustis_engine.MonoSyllabism.main.grapheme.tree_loaded import load_tree
from myangustis_engine.MonoSyllabism.main.grapheme.reverse import walk_reverse
from myangustis_engine.MonoSyllabism.utilities.js_string import utf16_units

def walk(block, start_pos, tree=None, reverse_tree=None, *, _utf16=False):
    tree = load_tree('syllable.tree.json') if tree is None else tree
    reverse_tree = load_tree('rtl-tree.json') if reverse_tree is None else reverse_tree
    if not _utf16:
        block = utf16_units(block)
    root = block[start_pos]
    node = tree.get('Root', {}).get(root)
    safe = start_pos + 1
    current_id = None
    if not node:
        return {'endPos': safe, 'lastValidPos': safe, 'id': None}
    read_pos, step, acc = safe, 1, root
    while True:
        key = f'St-{step}' if f'St-{step}' in node and node[f'St-{step}'] is not None else 'St-F'
        match = None
        for item in node.get(key, []):
            token = next(iter(item), None)
            if token is not None and block.startswith(utf16_units(token), read_pos):
                match = (utf16_units(token), item[token])
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
