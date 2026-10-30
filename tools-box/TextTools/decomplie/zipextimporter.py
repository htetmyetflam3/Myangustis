# uncompyle6 version 3.9.3
# Python bytecode version base 2.5 (62131)
# Decompiled from: Python 3.13.5 (main, Aug 10 2026, 12:06:59) [GCC 14.2.0]
# Embedded file name: zipextimporter.pyo
# Compiled at: 2008-06-16 15:20:08
import imp, sys, zipimport, _memimporter

class ZipExtensionImporter(zipimport.zipimporter):
    _suffixes = [_[1] for s in imp.get_suffixes() if s[2] == imp.C_EXTENSION]

    def find_module(self, fullname, path=None):
        result = zipimport.zipimporter.find_module(self, fullname, path)
        if result:
            return result
        if fullname in ('pywintypes', 'pythoncom'):
            fullname = fullname + '%d%d' % sys.version_info[:2]
            fullname = fullname.replace('.', '\\') + '.dll'
            if fullname in self._files:
                return self
        else:
            fullname = fullname.replace('.', '\\')
            for s in self._suffixes:
                if fullname + s in self._files:
                    return self

        return

    def locate_dll_image(self, name):
        if name in self._files:
            return self.get_data(name)
        return

    def load_module(self, fullname):
        if sys.modules.has_key(fullname):
            mod = sys.modules[fullname]
            if _memimporter.get_verbose_flag():
                sys.stderr.write('import %s # previously loaded from zipfile %s\n' % (fullname, self.archive))
            return mod
        _memimporter.set_find_proc(self.locate_dll_image)
        try:
            return zipimport.zipimporter.load_module(self, fullname)
        except zipimport.ZipImportError:
            pass

        initname = 'init' + fullname.split('.')[-1]
        filename = fullname.replace('.', '\\')
        if filename in ('pywintypes', 'pythoncom'):
            filename = filename + '%d%d' % sys.version_info[:2]
            suffixes = ('.dll', )
        else:
            suffixes = self._suffixes
        for s in suffixes:
            path = filename + s
            if path in self._files:
                if _memimporter.get_verbose_flag():
                    sys.stderr.write('# found %s in zipfile %s\n' % (path, self.archive))
                code = self.get_data(path)
                mod = _memimporter.import_module(code, initname, fullname, path)
                mod.__file__ = '%s\\%s' % (self.archive, path)
                mod.__loader__ = self
                if _memimporter.get_verbose_flag():
                    sys.stderr.write('import %s # loaded from zipfile %s\n' % (fullname, mod.__file__))
                return mod

        raise zipimport.ZipImportError, "can't find module %s" % fullname
        return

    def __repr__(self):
        return '<%s object %r>' % (self.__class__.__name__, self.archive)


def install():
    sys.path_hooks.insert(0, ZipExtensionImporter)
    sys.path_importer_cache.clear()
    return


return

# okay decompiling TextTools/zipextimporter.pyo
