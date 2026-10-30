# uncompyle6 version 3.9.3
# Python bytecode version base 2.5 (62131)
# Decompiled from: Python 3.13.5 (main, Aug 10 2026, 12:06:59) [GCC 14.2.0]
# Embedded file name: wx\__init__.pyo
# Compiled at: 2009-05-14 10:08:00
import __version__
__version__ = __version__.VERSION_STRING
__all__ = [
 2, 
 3, 
 4, 
 5, 
 6, 
 7, 
 8, 
 9, 
 10, 
 11, 
 12, 
 13, 
 14, 
 15, 
 16, 
 17, 
 18, 
 19]
from wx._core import *
del wx
if 'wxMSW' in PlatformInfo:
    __all__ += ['activex']
import wx._core
__docfilter__ = wx._core.__DocFilter(globals())
__all__ += [_[1] for name in dir(wx._core) if not name.startswith('_')]
return

# okay decompiling TextTools/wx/__init__.pyo
