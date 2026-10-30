# uncompyle6 version 3.9.3
# Python bytecode version base 2.5 (62131)
# Decompiled from: Python 3.13.5 (main, Aug 10 2026, 12:06:59) [GCC 14.2.0]
# Embedded file name: glob.pyo
# Compiled at: 2007-04-04 08:17:34
import os, fnmatch, re
__all__ = [
 'glob', 'iglob']

def glob(pathname):
    return list(iglob(pathname))


def iglob(pathname):
    if not has_magic(pathname):
        if os.path.lexists(pathname):
            yield pathname
        return
    (dirname, basename) = os.path.split(pathname)
    if not dirname:
        for name in glob1(os.curdir, basename):
            yield name

        return
    if has_magic(dirname):
        dirs = iglob(dirname)
    else:
        dirs = [
         dirname]
    if has_magic(basename):
        glob_in_dir = glob1
    else:
        glob_in_dir = glob0
    for dirname in dirs:
        for name in glob_in_dir(dirname, basename):
            yield os.path.join(dirname, name)

    return


def glob1(dirname, pattern):
    if not dirname:
        dirname = os.curdir
    try:
        names = os.listdir(dirname)
    except os.error:
        return []

    if pattern[0] != '.':
        names = filter((lambda x: x[0] != '.'), names)
    return fnmatch.filter(names, pattern)


def glob0(dirname, basename):
    if basename == '':
        if os.path.isdir(dirname):
            return [
             basename]
    elif os.path.lexists(os.path.join(dirname, basename)):
        return [
         basename]
    return []


magic_check = re.compile('[*?[]')

def has_magic(s):
    return magic_check.search(s) is not None


return

# okay decompiling TextTools/glob.pyo
