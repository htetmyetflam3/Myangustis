"""Pure Python replacement for the mapper ABI; WASM itself is not executed."""
from .normalize import normalize, mapperNormalize, myNormalize
from .source_mapper import mapperStr, toBurmeseStr, isTail, isBase, isNum, isStick, isStandalone
from .function import isLowercaseAZ, isUppercaseAZ, isLowerOrUpperAZ
from .source_map import tables

MyNormalize = myNormalize


class MapRuntimeUnavailable(NotImplementedError):
    pass


def require_runtime(runtime):
    if runtime is None:
        import sys
        return sys.modules[__name__]
    return runtime
