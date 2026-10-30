# uncompyle6 version 3.9.3
# Python bytecode version base 2.5 (62131)
# Decompiled from: Python 3.13.5 (main, Aug 10 2026, 12:06:59) [GCC 14.2.0]
# Embedded file name: wx\lib\embeddedimage.pyo
# Compiled at: 2009-05-14 10:08:06
import base64, cStringIO, wx
try:
    b64decode = base64.b64decode
except AttributeError:
    b64decode = base64.decodestring

class PyEmbeddedImage(object):

    def __init__(self, data, isBase64=True):
        self.data = data
        self.isBase64 = isBase64
        return

    def GetBitmap(self):
        return wx.BitmapFromImage(self.GetImage())

    def GetData(self):
        if self.isBase64:
            data = b64decode(self.data)
        return data

    def GetIcon(self):
        icon = wx.EmptyIcon()
        icon.CopyFromBitmap(self.GetBitmap())
        return icon

    def GetImage(self):
        stream = cStringIO.StringIO(self.GetData())
        return wx.ImageFromStream(stream)

    getBitmap = GetBitmap
    getData = GetData
    getIcon = GetIcon
    getImage = GetImage
    Bitmap = property(GetBitmap)
    Icon = property(GetIcon)
    Image = property(GetImage)


return

# okay decompiling TextTools/wx/lib/embeddedimage.pyo
