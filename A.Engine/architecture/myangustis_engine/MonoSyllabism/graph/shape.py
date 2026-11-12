"""Tree-shaping helpers, mirroring the separate graph/shape.js build tools."""


def get_step(node, step): return node.setdefault(f'St-{step}', [])
def ensure_node(tree, root): return tree.setdefault(root, {'x': []})
def ensure_step(node, step): return node.setdefault(f'St-{step}', {})
def add_pos(tags, pos):
    if pos in tags: return False
    tags.append(pos)
    return True
