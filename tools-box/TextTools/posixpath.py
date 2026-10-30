# uncompyle6 version 3.9.3
# Python bytecode version base 2.5 (62131)
# Decompiled from: Python 3.13.5 (main, Aug 10 2026, 12:06:59) [GCC 14.2.0]
# Embedded file name: posixpath.pyo
# Compiled at: 2008-01-21 07:51:16
import os, stat
__all__ = [
 2, 3, 4, 5, 6, 7, 
 8, 9, 10, 11, 12, 
 13, 14, 15, 16, 17, 18, 
 19, 
 20, 21, 22, 23, 24, 25, 
 26, 27, 28, 
 29, 30, 31, 32, 
 33, 34, 35, 
 36, 37, 38]
curdir = '.'
pardir = '..'
extsep = '.'
sep = '/'
pathsep = ':'
defpath = ':/bin:/usr/bin'
altsep = None
devnull = '/dev/null'

def normcase(s):
    return s


def isabs(s):
    return s.startswith('/')


def join(a, *p):
    path = a
    for b in p:
        if b.startswith('/'):
            path = b
        elif path == '' or path.endswith('/'):
            path += b
        else:
            path += '/' + b

    return path


def split(p):
    i = p.rfind('/') + 1
    head, tail = p[:i], p[i:]
    if head and head != '/' * len(head):
        head = head.rstrip('/')
    return (
     head, tail)


def splitext(p):
    i = p.rfind('.')
    if i <= p.rfind('/'):
        return (
         p, '')
    else:
        return (
         p[:i], p[i:])
    return


def splitdrive(p):
    return (
     '', p)


def basename(p):
    return split(p)[1]


def dirname(p):
    return split(p)[0]


def commonprefix(m):
    if not m:
        return ''
    s1 = min(m)
    s2 = max(m)
    n = min(len(s1), len(s2))
    for i in xrange(n):
        if s1[i] != s2[i]:
            return s1[:i]

    return s1[:n]


def getsize(filename):
    return os.stat(filename).st_size


def getmtime(filename):
    return os.stat(filename).st_mtime


def getatime(filename):
    return os.stat(filename).st_atime


def getctime(filename):
    return os.stat(filename).st_ctime


def islink(path):
    try:
        st = os.lstat(path)
    except (os.error, AttributeError):
        return False

    return stat.S_ISLNK(st.st_mode)


def exists(path):
    try:
        st = os.stat(path)
    except os.error:
        return False

    return True


def lexists(path):
    try:
        st = os.lstat(path)
    except os.error:
        return False

    return True


def isdir(path):
    try:
        st = os.stat(path)
    except os.error:
        return False

    return stat.S_ISDIR(st.st_mode)


def isfile(path):
    try:
        st = os.stat(path)
    except os.error:
        return False

    return stat.S_ISREG(st.st_mode)


def samefile(f1, f2):
    s1 = os.stat(f1)
    s2 = os.stat(f2)
    return samestat(s1, s2)


def sameopenfile(fp1, fp2):
    s1 = os.fstat(fp1)
    s2 = os.fstat(fp2)
    return samestat(s1, s2)


def samestat(s1, s2):
    return s1.st_ino == s2.st_ino and s1.st_dev == s2.st_dev


def ismount(path):
    try:
        s1 = os.lstat(path)
        s2 = os.lstat(join(path, '..'))
    except os.error:
        return False

    dev1 = s1.st_dev
    dev2 = s2.st_dev
    if dev1 != dev2:
        return True
    ino1 = s1.st_ino
    ino2 = s2.st_ino
    if ino1 == ino2:
        return True
    return False


def walk(top, func, arg):
    try:
        names = os.listdir(top)
    except os.error:
        return

    func(arg, top, names)
    for name in names:
        name = join(top, name)
        try:
            st = os.lstat(name)
        except os.error:
            continue

        if stat.S_ISDIR(st.st_mode):
            walk(name, func, arg)

    return


def expanduser(path):
    if not path.startswith('~'):
        return path
    i = path.find('/', 1)
    if i < 0:
        i = len(path)
    if i == 1:
        if 'HOME' not in os.environ:
            import pwd
            userhome = pwd.getpwuid(os.getuid()).pw_dir
        else:
            userhome = os.environ['HOME']
    else:
        import pwd
        try:
            pwent = pwd.getpwnam(path[1:i])
        except KeyError:
            return path

        userhome = pwent.pw_dir
    userhome = userhome.rstrip('/')
    return userhome + path[i:]


_varprog = None

def expandvars(path):
    global _varprog
    if '$' not in path:
        return path
    if not _varprog:
        import re
        _varprog = re.compile('\\$(\\w+|\\{[^}]*\\})')
    i = 0
    while True:
        m = _varprog.search(path, i)
        if not m:
            break
        (i, j) = m.span(0)
        name = m.group(1)
        if name.startswith('{') and name.endswith('}'):
            name = name[1:-1]
        if name in os.environ:
            tail = path[j:]
            path = path[:i] + os.environ[name]
            i = len(path)
            path += tail
        else:
            i = j

    return path


def normpath(path):
    if path == '':
        return '.'
    initial_slashes = path.startswith('/')
    if initial_slashes and path.startswith('//') and not path.startswith('///'):
        initial_slashes = 2
    comps = path.split('/')
    new_comps = []
    for comp in comps:
        if comp in ('', '.'):
            continue
        if comp != '..' or not initial_slashes and not new_comps or new_comps and new_comps[-1] == '..':
            new_comps.append(comp)
        elif new_comps:
            new_comps.pop()

    comps = new_comps
    path = ('/').join(comps)
    if initial_slashes:
        path = '/' * initial_slashes + path
    return path or '.'


def abspath(path):
    if not isabs(path):
        path = join(os.getcwd(), path)
    return normpath(path)


def realpath(filename):
    if isabs(filename):
        bits = [
         '/'] + filename.split('/')[1:]
    else:
        bits = [
         ''] + filename.split('/')
    for i in range(2, len(bits) + 1):
        component = join(*bits[0:i])
        if islink(component):
            resolved = _resolve_link(component)
            if resolved is None:
                return abspath(join(*([component] + bits[i:])))
            else:
                newpath = join(*([resolved] + bits[i:]))
                return realpath(newpath)

    return abspath(filename)


def _resolve_link(path):
    paths_seen = []
    while islink(path):
        if path in paths_seen:
            return
        paths_seen.append(path)
        resolved = os.readlink(path)
        if not isabs(resolved):
            dir = dirname(path)
            path = normpath(join(dir, resolved))
        else:
            path = normpath(resolved)

    return path


supports_unicode_filenames = False
return

# okay decompiling TextTools/posixpath.pyo
