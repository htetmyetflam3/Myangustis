"""Public non-debug engine entry points, imported lazily."""


def __getattr__(name):
    if name in ('bind_engine', 'BindEngine'):
        from .init.bridge import bind_engine, BindEngine
        return {'bind_engine': bind_engine, 'BindEngine': BindEngine}[name]
    if name == 'MapRuntimeUnavailable':
        from .MonoSyllabism.map.loader import MapRuntimeUnavailable
        return MapRuntimeUnavailable
    raise AttributeError(name)


__all__ = ['bind_engine', 'BindEngine', 'MapRuntimeUnavailable']
