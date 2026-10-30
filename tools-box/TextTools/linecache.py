# uncompyle6 version 3.9.3
# Python bytecode version base 2.5 (62131)
# Decompiled from: Python 3.13.5 (main, Aug 10 2026, 12:06:59) [GCC 14.2.0]
# Embedded file name: linecache.pyo
# Compiled at: 2006-06-19 23:26:02
import sys, os
__all__ = [
 'getline', 'clearcache', 'checkcache']

def getline(filename, lineno, module_globals=None):
    lines = getlines(filename, module_globals)
    if 1 <= lineno <= len(lines):
        return lines[lineno - 1]
    else:
        return ''
    return


cache = {}

def clearcache():
    global cache
    cache = {}
    return


def getlines(filename, module_globals=None):
    if filename in cache:
        return cache[filename][2]
    else:
        return updatecache(filename, module_globals)
    return


def checkcache(filename=None):
    if filename is None:
        filenames = cache.keys()
    elif filename in cache:
        filenames = [
         filename]
    else:
        return
    for filename in filenames:
        (size, mtime, lines, fullname) = cache[filename]
        if mtime is None:
            continue
        try:
            stat = os.stat(fullname)
        except os.error:
            del cache[filename]
            continue

        if size != stat.st_size or mtime != stat.st_mtime:
            del cache[filename]

    return


def updatecache(filename, module_globals=None):
    if filename in cache:
        del cache[filename]
    if not filename or filename[0] + filename[-1] == '<>':
        return []
    fullname = filename
    try:
        stat = os.stat(fullname)
    except os.error, msg:
        basename = os.path.split(filename)[1]
        if module_globals and '__loader__' in module_globals:
            name = module_globals.get('__name__')
            loader = module_globals['__loader__']
            get_source = getattr(loader, 'get_source', None)
            if name and get_source:
                if basename.startswith(name.split('.')[-1] + '.'):
                    try:
                        data = get_source(name)
                    except (ImportError, IOError):
                        pass
                    else:
                        if data is None:
                            return []
                        cache[filename] = (
                         len(data), None, [_[1] for line in data.splitlines()], fullname)
                        return cache[filename][2]
        for dirname in sys.path:
            try:
                fullname = os.path.join(dirname, basename)
            except (TypeError, AttributeError):
                pass
            else:
                try:
                    stat = os.stat(fullname)
                    break
                except os.error:
                    pass

        else:
            return []

    try:
        fp = open(fullname, 'rU')
        lines = fp.readlines()
        fp.close()
    except IOError, msg:
        return []

    size, mtime = stat.st_size, stat.st_mtime
    cache[filename] = (size, mtime, lines, fullname)
    return lines


return

# okay decompiling TextTools/linecache.pyo
