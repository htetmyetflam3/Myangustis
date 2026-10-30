# uncompyle6 version 3.9.3
# Python bytecode version base 2.5 (62131)
# Decompiled from: Python 3.13.5 (main, Aug 10 2026, 12:06:59) [GCC 14.2.0]
# Embedded file name: types.pyo
# Compiled at: 2006-08-02 23:27:30
import sys
NoneType = type(None)
TypeType = type
ObjectType = object
IntType = int
LongType = long
FloatType = float
BooleanType = bool
try:
    ComplexType = complex
except NameError:
    pass

StringType = str
try:
    UnicodeType = unicode
    StringTypes = (StringType, UnicodeType)
except NameError:
    StringTypes = (
     StringType,)

BufferType = buffer
TupleType = tuple
ListType = list
DictType = DictionaryType = dict

def _f():
    return


FunctionType = type(_f)
LambdaType = type((lambda : None))
try:
    CodeType = type(_f.func_code)
except RuntimeError:
    pass

def _g():
    yield 1
    return


GeneratorType = type(_g())

class _C:

    def _m(self):
        return


ClassType = type(_C)
UnboundMethodType = type(_C._m)
_x = _C()
InstanceType = type(_x)
MethodType = type(_x._m)
BuiltinFunctionType = type(len)
BuiltinMethodType = type([].append)
ModuleType = type(sys)
FileType = file
XRangeType = xrange
try:
    raise TypeError
except TypeError:
    try:
        tb = sys.exc_info()[2]
        TracebackType = type(tb)
        FrameType = type(tb.tb_frame)
    except AttributeError:
        pass
    else:
        tb = None
        del tb

SliceType = slice
EllipsisType = type(Ellipsis)
DictProxyType = type(TypeType.__dict__)
NotImplementedType = type(NotImplemented)
try:
    import _types
except ImportError:
    pass
else:
    GetSetDescriptorType = type(_types.Helper.getter)
    MemberDescriptorType = type(_types.Helper.member)
    del _types

del sys
del _f
del _g
del _C
del _x
return

# okay decompiling TextTools/types.pyo
