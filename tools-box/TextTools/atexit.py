# uncompyle6 version 3.9.3
# Python bytecode version base 2.5 (62131)
# Decompiled from: Python 3.13.5 (main, Aug 10 2026, 12:06:59) [GCC 14.2.0]
# Embedded file name: atexit.pyo
# Compiled at: 2005-10-28 10:07:40
__all__ = [
 'register']
import sys
_exithandlers = []

def _run_exitfuncs():
    exc_info = None
    while _exithandlers:
        (func, targs, kargs) = _exithandlers.pop()
        try:
            func(*targs, **kargs)
        except SystemExit:
            exc_info = sys.exc_info()
        except:
            import traceback
            print >> sys.stderr, 'Error in atexit._run_exitfuncs:'
            traceback.print_exc()
            exc_info = sys.exc_info()

    if exc_info is not None:
        raise exc_info[0], exc_info[1], exc_info[2]
    return


def register(func, *targs, **kargs):
    _exithandlers.append((func, targs, kargs))
    return


if hasattr(sys, 'exitfunc'):
    register(sys.exitfunc)
sys.exitfunc = _run_exitfuncs
if __name__ == '__main__':

    def x1():
        print 'running x1'
        return


    def x2(n):
        print 'running x2(%r)' % (n,)
        return


    def x3(n, kwd=None):
        print 'running x3(%r, kwd=%r)' % (n, kwd)
        return


    register(x1)
    register(x2, 12)
    register(x3, 5, 'bar')
    register(x3, 'no kwd args')
return

# okay decompiling TextTools/atexit.pyo
