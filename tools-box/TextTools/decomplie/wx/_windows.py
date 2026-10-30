# uncompyle6 version 3.9.3
# Python bytecode version base 2.5 (62131)
# Decompiled from: Python 3.13.5 (main, Aug 10 2026, 12:06:59) [GCC 14.2.0]
# Embedded file name: wx\_windows.pyo
# Compiled at: 2009-05-14 10:08:00
import _windows_, new
new_instancemethod = new.instancemethod

def _swig_setattr_nondynamic(self, class_type, name, value, static=1):
    if name == 'thisown':
        return self.this.own(value)
    if name == 'this':
        if type(value).__name__ == 'PySwigObject':
            self.__dict__[name] = value
            return
    method = class_type.__swig_setmethods__.get(name, None)
    if method:
        return method(self, value)
    if not static or hasattr(self, name):
        self.__dict__[name] = value
    else:
        raise AttributeError('You cannot add attributes to %s' % self)
    return


def _swig_setattr(self, class_type, name, value):
    return _swig_setattr_nondynamic(self, class_type, name, value, 0)


def _swig_getattr(self, class_type, name):
    if name == 'thisown':
        return self.this.own()
    method = class_type.__swig_getmethods__.get(name, None)
    if method:
        return method(self)
    raise AttributeError, name
    return


def _swig_repr(self):
    try:
        strthis = 'proxy of ' + self.this.__repr__()
    except:
        strthis = ''

    return '<%s.%s; %s >' % (self.__class__.__module__, self.__class__.__name__, strthis)


import types
try:
    _object = types.ObjectType
    _newclass = 1
except AttributeError:

    class _object():
        pass


    _newclass = 0

del types

def _swig_setattr_nondynamic_method(set):

    def set_attr(self, name, value):
        if name == 'thisown':
            return self.this.own(value)
        if hasattr(self, name) or name == 'this':
            set(self, name, value)
        else:
            raise AttributeError('You cannot add attributes to %s' % self)
        return

    return set_attr


import _core
wx = _core

class Panel(_core.Window):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.Panel_swiginit(self, _windows_.new_Panel(*args, **kwargs))
        self._setOORInfo(self)
        return

    def Create(*args, **kwargs):
        return _windows_.Panel_Create(*args, **kwargs)

    def SetFocusIgnoringChildren(*args, **kwargs):
        return _windows_.Panel_SetFocusIgnoringChildren(*args, **kwargs)

    def GetClassDefaultAttributes(*args, **kwargs):
        return _windows_.Panel_GetClassDefaultAttributes(*args, **kwargs)

    GetClassDefaultAttributes = staticmethod(GetClassDefaultAttributes)


_windows_.Panel_swigregister(Panel)

def PrePanel(*args, **kwargs):
    val = _windows_.new_PrePanel(*args, **kwargs)
    return val


def Panel_GetClassDefaultAttributes(*args, **kwargs):
    return _windows_.Panel_GetClassDefaultAttributes(*args, **kwargs)


class ScrolledWindow(Panel):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.ScrolledWindow_swiginit(self, _windows_.new_ScrolledWindow(*args, **kwargs))
        self._setOORInfo(self)
        return

    def Create(*args, **kwargs):
        return _windows_.ScrolledWindow_Create(*args, **kwargs)

    def SetScrollbars(*args, **kwargs):
        return _windows_.ScrolledWindow_SetScrollbars(*args, **kwargs)

    def Scroll(*args, **kwargs):
        return _windows_.ScrolledWindow_Scroll(*args, **kwargs)

    def GetScrollPageSize(*args, **kwargs):
        return _windows_.ScrolledWindow_GetScrollPageSize(*args, **kwargs)

    def SetScrollPageSize(*args, **kwargs):
        return _windows_.ScrolledWindow_SetScrollPageSize(*args, **kwargs)

    def SetScrollRate(*args, **kwargs):
        return _windows_.ScrolledWindow_SetScrollRate(*args, **kwargs)

    def GetScrollPixelsPerUnit(*args, **kwargs):
        return _windows_.ScrolledWindow_GetScrollPixelsPerUnit(*args, **kwargs)

    def EnableScrolling(*args, **kwargs):
        return _windows_.ScrolledWindow_EnableScrolling(*args, **kwargs)

    def GetViewStart(*args, **kwargs):
        return _windows_.ScrolledWindow_GetViewStart(*args, **kwargs)

    def SetScale(*args, **kwargs):
        return _windows_.ScrolledWindow_SetScale(*args, **kwargs)

    def GetScaleX(*args, **kwargs):
        return _windows_.ScrolledWindow_GetScaleX(*args, **kwargs)

    def GetScaleY(*args, **kwargs):
        return _windows_.ScrolledWindow_GetScaleY(*args, **kwargs)

    def CalcScrolledPosition(*args):
        return _windows_.ScrolledWindow_CalcScrolledPosition(*args)

    def CalcUnscrolledPosition(*args):
        return _windows_.ScrolledWindow_CalcUnscrolledPosition(*args)

    def AdjustScrollbars(*args, **kwargs):
        return _windows_.ScrolledWindow_AdjustScrollbars(*args, **kwargs)

    def CalcScrollInc(*args, **kwargs):
        return _windows_.ScrolledWindow_CalcScrollInc(*args, **kwargs)

    def SetTargetWindow(*args, **kwargs):
        return _windows_.ScrolledWindow_SetTargetWindow(*args, **kwargs)

    def GetTargetWindow(*args, **kwargs):
        return _windows_.ScrolledWindow_GetTargetWindow(*args, **kwargs)

    def SetTargetRect(*args, **kwargs):
        return _windows_.ScrolledWindow_SetTargetRect(*args, **kwargs)

    def GetTargetRect(*args, **kwargs):
        return _windows_.ScrolledWindow_GetTargetRect(*args, **kwargs)

    def DoPrepareDC(*args, **kwargs):
        return _windows_.ScrolledWindow_DoPrepareDC(*args, **kwargs)

    def GetClassDefaultAttributes(*args, **kwargs):
        return _windows_.ScrolledWindow_GetClassDefaultAttributes(*args, **kwargs)

    GetClassDefaultAttributes = staticmethod(GetClassDefaultAttributes)
    ScaleX = property(GetScaleX, doc='See `GetScaleX`')
    ScaleY = property(GetScaleY, doc='See `GetScaleY`')
    TargetWindow = property(GetTargetWindow, SetTargetWindow, doc='See `GetTargetWindow` and `SetTargetWindow`')
    ViewStart = property(GetViewStart, doc='See `GetViewStart`')


_windows_.ScrolledWindow_swigregister(ScrolledWindow)

def PreScrolledWindow(*args, **kwargs):
    val = _windows_.new_PreScrolledWindow(*args, **kwargs)
    return val


def ScrolledWindow_GetClassDefaultAttributes(*args, **kwargs):
    return _windows_.ScrolledWindow_GetClassDefaultAttributes(*args, **kwargs)


STAY_ON_TOP = _windows_.STAY_ON_TOP
ICONIZE = _windows_.ICONIZE
MINIMIZE = _windows_.MINIMIZE
MAXIMIZE = _windows_.MAXIMIZE
CLOSE_BOX = _windows_.CLOSE_BOX
THICK_FRAME = _windows_.THICK_FRAME
SYSTEM_MENU = _windows_.SYSTEM_MENU
MINIMIZE_BOX = _windows_.MINIMIZE_BOX
MAXIMIZE_BOX = _windows_.MAXIMIZE_BOX
TINY_CAPTION_HORIZ = _windows_.TINY_CAPTION_HORIZ
TINY_CAPTION_VERT = _windows_.TINY_CAPTION_VERT
RESIZE_BOX = _windows_.RESIZE_BOX
RESIZE_BORDER = _windows_.RESIZE_BORDER
DIALOG_NO_PARENT = _windows_.DIALOG_NO_PARENT
DEFAULT_FRAME_STYLE = _windows_.DEFAULT_FRAME_STYLE
DEFAULT_DIALOG_STYLE = _windows_.DEFAULT_DIALOG_STYLE
FRAME_TOOL_WINDOW = _windows_.FRAME_TOOL_WINDOW
FRAME_FLOAT_ON_PARENT = _windows_.FRAME_FLOAT_ON_PARENT
FRAME_NO_WINDOW_MENU = _windows_.FRAME_NO_WINDOW_MENU
FRAME_NO_TASKBAR = _windows_.FRAME_NO_TASKBAR
FRAME_SHAPED = _windows_.FRAME_SHAPED
FRAME_DRAWER = _windows_.FRAME_DRAWER
FRAME_EX_METAL = _windows_.FRAME_EX_METAL
DIALOG_EX_METAL = _windows_.DIALOG_EX_METAL
WS_EX_CONTEXTHELP = _windows_.WS_EX_CONTEXTHELP
DIALOG_MODAL = _windows_.DIALOG_MODAL
DIALOG_MODELESS = _windows_.DIALOG_MODELESS
USER_COLOURS = _windows_.USER_COLOURS
NO_3D = _windows_.NO_3D
FRAME_EX_CONTEXTHELP = _windows_.FRAME_EX_CONTEXTHELP
DIALOG_EX_CONTEXTHELP = _windows_.DIALOG_EX_CONTEXTHELP
FULLSCREEN_NOMENUBAR = _windows_.FULLSCREEN_NOMENUBAR
FULLSCREEN_NOTOOLBAR = _windows_.FULLSCREEN_NOTOOLBAR
FULLSCREEN_NOSTATUSBAR = _windows_.FULLSCREEN_NOSTATUSBAR
FULLSCREEN_NOBORDER = _windows_.FULLSCREEN_NOBORDER
FULLSCREEN_NOCAPTION = _windows_.FULLSCREEN_NOCAPTION
FULLSCREEN_ALL = _windows_.FULLSCREEN_ALL
TOPLEVEL_EX_DIALOG = _windows_.TOPLEVEL_EX_DIALOG
USER_ATTENTION_INFO = _windows_.USER_ATTENTION_INFO
USER_ATTENTION_ERROR = _windows_.USER_ATTENTION_ERROR

class TopLevelWindow(_core.Window):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')

    def __init__(self):
        raise AttributeError, 'No constructor defined'
        return

    __repr__ = _swig_repr

    def Maximize(*args, **kwargs):
        return _windows_.TopLevelWindow_Maximize(*args, **kwargs)

    def Restore(*args, **kwargs):
        return _windows_.TopLevelWindow_Restore(*args, **kwargs)

    def Iconize(*args, **kwargs):
        return _windows_.TopLevelWindow_Iconize(*args, **kwargs)

    def IsMaximized(*args, **kwargs):
        return _windows_.TopLevelWindow_IsMaximized(*args, **kwargs)

    def IsAlwaysMaximized(*args, **kwargs):
        return _windows_.TopLevelWindow_IsAlwaysMaximized(*args, **kwargs)

    def IsIconized(*args, **kwargs):
        return _windows_.TopLevelWindow_IsIconized(*args, **kwargs)

    def GetIcon(*args, **kwargs):
        return _windows_.TopLevelWindow_GetIcon(*args, **kwargs)

    def SetIcon(*args, **kwargs):
        return _windows_.TopLevelWindow_SetIcon(*args, **kwargs)

    def SetIcons(*args, **kwargs):
        return _windows_.TopLevelWindow_SetIcons(*args, **kwargs)

    def ShowFullScreen(*args, **kwargs):
        return _windows_.TopLevelWindow_ShowFullScreen(*args, **kwargs)

    def IsFullScreen(*args, **kwargs):
        return _windows_.TopLevelWindow_IsFullScreen(*args, **kwargs)

    def SetTitle(*args, **kwargs):
        return _windows_.TopLevelWindow_SetTitle(*args, **kwargs)

    def GetTitle(*args, **kwargs):
        return _windows_.TopLevelWindow_GetTitle(*args, **kwargs)

    def EnableCloseButton(*args, **kwargs):
        return _windows_.TopLevelWindow_EnableCloseButton(*args, **kwargs)

    def SetShape(*args, **kwargs):
        return _windows_.TopLevelWindow_SetShape(*args, **kwargs)

    def RequestUserAttention(*args, **kwargs):
        return _windows_.TopLevelWindow_RequestUserAttention(*args, **kwargs)

    def IsActive(*args, **kwargs):
        return _windows_.TopLevelWindow_IsActive(*args, **kwargs)

    def MacSetMetalAppearance(*args, **kwargs):
        return _windows_.TopLevelWindow_MacSetMetalAppearance(*args, **kwargs)

    def MacGetMetalAppearance(*args, **kwargs):
        return _windows_.TopLevelWindow_MacGetMetalAppearance(*args, **kwargs)

    def MacGetUnifiedAppearance(*args, **kwargs):
        return _windows_.TopLevelWindow_MacGetUnifiedAppearance(*args, **kwargs)

    def MacGetTopLevelWindowRef(*args, **kwargs):
        return _windows_.TopLevelWindow_MacGetTopLevelWindowRef(*args, **kwargs)

    def CenterOnScreen(*args, **kwargs):
        return _windows_.TopLevelWindow_CenterOnScreen(*args, **kwargs)

    CentreOnScreen = CenterOnScreen

    def GetDefaultItem(*args, **kwargs):
        return _windows_.TopLevelWindow_GetDefaultItem(*args, **kwargs)

    def SetDefaultItem(*args, **kwargs):
        return _windows_.TopLevelWindow_SetDefaultItem(*args, **kwargs)

    def SetTmpDefaultItem(*args, **kwargs):
        return _windows_.TopLevelWindow_SetTmpDefaultItem(*args, **kwargs)

    def GetTmpDefaultItem(*args, **kwargs):
        return _windows_.TopLevelWindow_GetTmpDefaultItem(*args, **kwargs)

    DefaultItem = property(GetDefaultItem, SetDefaultItem, doc='See `GetDefaultItem` and `SetDefaultItem`')
    Icon = property(GetIcon, SetIcon, doc='See `GetIcon` and `SetIcon`')
    Title = property(GetTitle, SetTitle, doc='See `GetTitle` and `SetTitle`')
    TmpDefaultItem = property(GetTmpDefaultItem, SetTmpDefaultItem, doc='See `GetTmpDefaultItem` and `SetTmpDefaultItem`')


_windows_.TopLevelWindow_swigregister(TopLevelWindow)
cvar = _windows_.cvar
FrameNameStr = cvar.FrameNameStr
DialogNameStr = cvar.DialogNameStr
StatusLineNameStr = cvar.StatusLineNameStr
ToolBarNameStr = cvar.ToolBarNameStr

class Frame(TopLevelWindow):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.Frame_swiginit(self, _windows_.new_Frame(*args, **kwargs))
        self._setOORInfo(self)
        return

    def Create(*args, **kwargs):
        return _windows_.Frame_Create(*args, **kwargs)

    def SendSizeEvent(*args, **kwargs):
        return _windows_.Frame_SendSizeEvent(*args, **kwargs)

    def SetMenuBar(*args, **kwargs):
        return _windows_.Frame_SetMenuBar(*args, **kwargs)

    def GetMenuBar(*args, **kwargs):
        return _windows_.Frame_GetMenuBar(*args, **kwargs)

    def ProcessCommand(*args, **kwargs):
        return _windows_.Frame_ProcessCommand(*args, **kwargs)

    Command = ProcessCommand

    def CreateStatusBar(*args, **kwargs):
        return _windows_.Frame_CreateStatusBar(*args, **kwargs)

    def GetStatusBar(*args, **kwargs):
        return _windows_.Frame_GetStatusBar(*args, **kwargs)

    def SetStatusBar(*args, **kwargs):
        return _windows_.Frame_SetStatusBar(*args, **kwargs)

    def SetStatusText(*args, **kwargs):
        return _windows_.Frame_SetStatusText(*args, **kwargs)

    def SetStatusWidths(*args, **kwargs):
        return _windows_.Frame_SetStatusWidths(*args, **kwargs)

    def PushStatusText(*args, **kwargs):
        return _windows_.Frame_PushStatusText(*args, **kwargs)

    def PopStatusText(*args, **kwargs):
        return _windows_.Frame_PopStatusText(*args, **kwargs)

    def SetStatusBarPane(*args, **kwargs):
        return _windows_.Frame_SetStatusBarPane(*args, **kwargs)

    def GetStatusBarPane(*args, **kwargs):
        return _windows_.Frame_GetStatusBarPane(*args, **kwargs)

    def CreateToolBar(*args, **kwargs):
        return _windows_.Frame_CreateToolBar(*args, **kwargs)

    def GetToolBar(*args, **kwargs):
        return _windows_.Frame_GetToolBar(*args, **kwargs)

    def SetToolBar(*args, **kwargs):
        return _windows_.Frame_SetToolBar(*args, **kwargs)

    def DoGiveHelp(*args, **kwargs):
        return _windows_.Frame_DoGiveHelp(*args, **kwargs)

    def DoMenuUpdates(*args, **kwargs):
        return _windows_.Frame_DoMenuUpdates(*args, **kwargs)

    def GetClassDefaultAttributes(*args, **kwargs):
        return _windows_.Frame_GetClassDefaultAttributes(*args, **kwargs)

    GetClassDefaultAttributes = staticmethod(GetClassDefaultAttributes)
    MenuBar = property(GetMenuBar, SetMenuBar, doc='See `GetMenuBar` and `SetMenuBar`')
    StatusBar = property(GetStatusBar, SetStatusBar, doc='See `GetStatusBar` and `SetStatusBar`')
    StatusBarPane = property(GetStatusBarPane, SetStatusBarPane, doc='See `GetStatusBarPane` and `SetStatusBarPane`')
    ToolBar = property(GetToolBar, SetToolBar, doc='See `GetToolBar` and `SetToolBar`')


_windows_.Frame_swigregister(Frame)

def PreFrame(*args, **kwargs):
    val = _windows_.new_PreFrame(*args, **kwargs)
    return val


def Frame_GetClassDefaultAttributes(*args, **kwargs):
    return _windows_.Frame_GetClassDefaultAttributes(*args, **kwargs)


class Dialog(TopLevelWindow):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr
    ButtonSizerFlags = _windows_.Dialog_ButtonSizerFlags

    def __init__(self, *args, **kwargs):
        _windows_.Dialog_swiginit(self, _windows_.new_Dialog(*args, **kwargs))
        self._setOORInfo(self)
        return

    def Create(*args, **kwargs):
        return _windows_.Dialog_Create(*args, **kwargs)

    def SetReturnCode(*args, **kwargs):
        return _windows_.Dialog_SetReturnCode(*args, **kwargs)

    def GetReturnCode(*args, **kwargs):
        return _windows_.Dialog_GetReturnCode(*args, **kwargs)

    def SetAffirmativeId(*args, **kwargs):
        return _windows_.Dialog_SetAffirmativeId(*args, **kwargs)

    def GetAffirmativeId(*args, **kwargs):
        return _windows_.Dialog_GetAffirmativeId(*args, **kwargs)

    def SetEscapeId(*args, **kwargs):
        return _windows_.Dialog_SetEscapeId(*args, **kwargs)

    def GetEscapeId(*args, **kwargs):
        return _windows_.Dialog_GetEscapeId(*args, **kwargs)

    def CreateTextSizer(*args, **kwargs):
        return _windows_.Dialog_CreateTextSizer(*args, **kwargs)

    def _CreateButtonSizer(*args, **kwargs):
        return _windows_.Dialog__CreateButtonSizer(*args, **kwargs)

    def CreateButtonSizer(self, flags, *ignored):
        return self._CreateButtonSizer(flags)

    def CreateSeparatedButtonSizer(*args, **kwargs):
        return _windows_.Dialog_CreateSeparatedButtonSizer(*args, **kwargs)

    def CreateStdDialogButtonSizer(*args, **kwargs):
        return _windows_.Dialog_CreateStdDialogButtonSizer(*args, **kwargs)

    def IsModal(*args, **kwargs):
        return _windows_.Dialog_IsModal(*args, **kwargs)

    def ShowModal(*args, **kwargs):
        return _windows_.Dialog_ShowModal(*args, **kwargs)

    def EndModal(*args, **kwargs):
        return _windows_.Dialog_EndModal(*args, **kwargs)

    def GetClassDefaultAttributes(*args, **kwargs):
        return _windows_.Dialog_GetClassDefaultAttributes(*args, **kwargs)

    GetClassDefaultAttributes = staticmethod(GetClassDefaultAttributes)
    AffirmativeId = property(GetAffirmativeId, SetAffirmativeId, doc='See `GetAffirmativeId` and `SetAffirmativeId`')
    EscapeId = property(GetEscapeId, SetEscapeId, doc='See `GetEscapeId` and `SetEscapeId`')
    ReturnCode = property(GetReturnCode, SetReturnCode, doc='See `GetReturnCode` and `SetReturnCode`')


_windows_.Dialog_swigregister(Dialog)

def PreDialog(*args, **kwargs):
    val = _windows_.new_PreDialog(*args, **kwargs)
    return val


def Dialog_GetClassDefaultAttributes(*args, **kwargs):
    return _windows_.Dialog_GetClassDefaultAttributes(*args, **kwargs)


DEFAULT_MINIFRAME_STYLE = _windows_.DEFAULT_MINIFRAME_STYLE

class MiniFrame(Frame):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.MiniFrame_swiginit(self, _windows_.new_MiniFrame(*args, **kwargs))
        self._setOORInfo(self)
        return

    def Create(*args, **kwargs):
        return _windows_.MiniFrame_Create(*args, **kwargs)


_windows_.MiniFrame_swigregister(MiniFrame)

def PreMiniFrame(*args, **kwargs):
    val = _windows_.new_PreMiniFrame(*args, **kwargs)
    return val


SPLASH_CENTRE_ON_PARENT = _windows_.SPLASH_CENTRE_ON_PARENT
SPLASH_CENTRE_ON_SCREEN = _windows_.SPLASH_CENTRE_ON_SCREEN
SPLASH_NO_CENTRE = _windows_.SPLASH_NO_CENTRE
SPLASH_CENTER_ON_PARENT = _windows_.SPLASH_CENTER_ON_PARENT
SPLASH_CENTER_ON_SCREEN = _windows_.SPLASH_CENTER_ON_SCREEN
SPLASH_NO_CENTER = _windows_.SPLASH_NO_CENTER
SPLASH_TIMEOUT = _windows_.SPLASH_TIMEOUT
SPLASH_NO_TIMEOUT = _windows_.SPLASH_NO_TIMEOUT

class SplashScreenWindow(_core.Window):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.SplashScreenWindow_swiginit(self, _windows_.new_SplashScreenWindow(*args, **kwargs))
        self._setOORInfo(self)
        return

    def SetBitmap(*args, **kwargs):
        return _windows_.SplashScreenWindow_SetBitmap(*args, **kwargs)

    def GetBitmap(*args, **kwargs):
        return _windows_.SplashScreenWindow_GetBitmap(*args, **kwargs)

    Bitmap = property(GetBitmap, SetBitmap, doc='See `GetBitmap` and `SetBitmap`')


_windows_.SplashScreenWindow_swigregister(SplashScreenWindow)

class SplashScreen(Frame):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.SplashScreen_swiginit(self, _windows_.new_SplashScreen(*args, **kwargs))
        self._setOORInfo(self)
        return

    def GetSplashStyle(*args, **kwargs):
        return _windows_.SplashScreen_GetSplashStyle(*args, **kwargs)

    def GetSplashWindow(*args, **kwargs):
        return _windows_.SplashScreen_GetSplashWindow(*args, **kwargs)

    def GetTimeout(*args, **kwargs):
        return _windows_.SplashScreen_GetTimeout(*args, **kwargs)

    SplashStyle = property(GetSplashStyle, doc='See `GetSplashStyle`')
    SplashWindow = property(GetSplashWindow, doc='See `GetSplashWindow`')
    Timeout = property(GetTimeout, doc='See `GetTimeout`')


_windows_.SplashScreen_swigregister(SplashScreen)
SB_NORMAL = _windows_.SB_NORMAL
SB_FLAT = _windows_.SB_FLAT
SB_RAISED = _windows_.SB_RAISED

class StatusBar(_core.Window):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.StatusBar_swiginit(self, _windows_.new_StatusBar(*args, **kwargs))
        self._setOORInfo(self)
        return

    def Create(*args, **kwargs):
        return _windows_.StatusBar_Create(*args, **kwargs)

    def SetFieldsCount(*args, **kwargs):
        return _windows_.StatusBar_SetFieldsCount(*args, **kwargs)

    def GetFieldsCount(*args, **kwargs):
        return _windows_.StatusBar_GetFieldsCount(*args, **kwargs)

    def SetStatusText(*args, **kwargs):
        return _windows_.StatusBar_SetStatusText(*args, **kwargs)

    def GetStatusText(*args, **kwargs):
        return _windows_.StatusBar_GetStatusText(*args, **kwargs)

    def PushStatusText(*args, **kwargs):
        return _windows_.StatusBar_PushStatusText(*args, **kwargs)

    def PopStatusText(*args, **kwargs):
        return _windows_.StatusBar_PopStatusText(*args, **kwargs)

    def SetStatusWidths(*args, **kwargs):
        return _windows_.StatusBar_SetStatusWidths(*args, **kwargs)

    def SetStatusStyles(*args, **kwargs):
        return _windows_.StatusBar_SetStatusStyles(*args, **kwargs)

    def GetFieldRect(*args, **kwargs):
        return _windows_.StatusBar_GetFieldRect(*args, **kwargs)

    def SetMinHeight(*args, **kwargs):
        return _windows_.StatusBar_SetMinHeight(*args, **kwargs)

    def GetBorderX(*args, **kwargs):
        return _windows_.StatusBar_GetBorderX(*args, **kwargs)

    def GetBorderY(*args, **kwargs):
        return _windows_.StatusBar_GetBorderY(*args, **kwargs)

    def GetClassDefaultAttributes(*args, **kwargs):
        return _windows_.StatusBar_GetClassDefaultAttributes(*args, **kwargs)

    GetClassDefaultAttributes = staticmethod(GetClassDefaultAttributes)

    def GetFields(self):
        return [_[1] for i in range(self.GetFieldsCount())]

    def SetFields(self, items):
        self.SetFieldsCount(len(items))
        for i in range(len(items)):
            self.SetStatusText(items[i], i)

        return

    BorderX = property(GetBorderX, doc='See `GetBorderX`')
    BorderY = property(GetBorderY, doc='See `GetBorderY`')
    FieldRect = property(GetFieldRect, doc='See `GetFieldRect`')
    Fields = property(GetFields, SetFields, doc='See `GetFields` and `SetFields`')
    FieldsCount = property(GetFieldsCount, SetFieldsCount, doc='See `GetFieldsCount` and `SetFieldsCount`')
    StatusText = property(GetStatusText, SetStatusText, doc='See `GetStatusText` and `SetStatusText`')


_windows_.StatusBar_swigregister(StatusBar)

def PreStatusBar(*args, **kwargs):
    val = _windows_.new_PreStatusBar(*args, **kwargs)
    return val


def StatusBar_GetClassDefaultAttributes(*args, **kwargs):
    return _windows_.StatusBar_GetClassDefaultAttributes(*args, **kwargs)


SP_NOBORDER = _windows_.SP_NOBORDER
SP_NOSASH = _windows_.SP_NOSASH
SP_PERMIT_UNSPLIT = _windows_.SP_PERMIT_UNSPLIT
SP_LIVE_UPDATE = _windows_.SP_LIVE_UPDATE
SP_3DSASH = _windows_.SP_3DSASH
SP_3DBORDER = _windows_.SP_3DBORDER
SP_NO_XP_THEME = _windows_.SP_NO_XP_THEME
SP_BORDER = _windows_.SP_BORDER
SP_3D = _windows_.SP_3D
SPLIT_HORIZONTAL = _windows_.SPLIT_HORIZONTAL
SPLIT_VERTICAL = _windows_.SPLIT_VERTICAL
SPLIT_DRAG_NONE = _windows_.SPLIT_DRAG_NONE
SPLIT_DRAG_DRAGGING = _windows_.SPLIT_DRAG_DRAGGING
SPLIT_DRAG_LEFT_DOWN = _windows_.SPLIT_DRAG_LEFT_DOWN

class SplitterWindow(_core.Window):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        if kwargs.has_key('point'):
            kwargs['pos'] = kwargs['point']
            del kwargs['point']
        _windows_.SplitterWindow_swiginit(self, _windows_.new_SplitterWindow(*args, **kwargs))
        self._setOORInfo(self)
        return

    def Create(*args, **kwargs):
        return _windows_.SplitterWindow_Create(*args, **kwargs)

    def GetWindow1(*args, **kwargs):
        return _windows_.SplitterWindow_GetWindow1(*args, **kwargs)

    def GetWindow2(*args, **kwargs):
        return _windows_.SplitterWindow_GetWindow2(*args, **kwargs)

    def SetSplitMode(*args, **kwargs):
        return _windows_.SplitterWindow_SetSplitMode(*args, **kwargs)

    def GetSplitMode(*args, **kwargs):
        return _windows_.SplitterWindow_GetSplitMode(*args, **kwargs)

    def Initialize(*args, **kwargs):
        return _windows_.SplitterWindow_Initialize(*args, **kwargs)

    def SplitVertically(*args, **kwargs):
        return _windows_.SplitterWindow_SplitVertically(*args, **kwargs)

    def SplitHorizontally(*args, **kwargs):
        return _windows_.SplitterWindow_SplitHorizontally(*args, **kwargs)

    def Unsplit(*args, **kwargs):
        return _windows_.SplitterWindow_Unsplit(*args, **kwargs)

    def ReplaceWindow(*args, **kwargs):
        return _windows_.SplitterWindow_ReplaceWindow(*args, **kwargs)

    def UpdateSize(*args, **kwargs):
        return _windows_.SplitterWindow_UpdateSize(*args, **kwargs)

    def IsSplit(*args, **kwargs):
        return _windows_.SplitterWindow_IsSplit(*args, **kwargs)

    def SetSashSize(*args, **kwargs):
        return _windows_.SplitterWindow_SetSashSize(*args, **kwargs)

    def SetBorderSize(*args, **kwargs):
        return _windows_.SplitterWindow_SetBorderSize(*args, **kwargs)

    def GetSashSize(*args, **kwargs):
        return _windows_.SplitterWindow_GetSashSize(*args, **kwargs)

    def GetBorderSize(*args, **kwargs):
        return _windows_.SplitterWindow_GetBorderSize(*args, **kwargs)

    def SetSashPosition(*args, **kwargs):
        return _windows_.SplitterWindow_SetSashPosition(*args, **kwargs)

    def GetSashPosition(*args, **kwargs):
        return _windows_.SplitterWindow_GetSashPosition(*args, **kwargs)

    def SetSashGravity(*args, **kwargs):
        return _windows_.SplitterWindow_SetSashGravity(*args, **kwargs)

    def GetSashGravity(*args, **kwargs):
        return _windows_.SplitterWindow_GetSashGravity(*args, **kwargs)

    def SetMinimumPaneSize(*args, **kwargs):
        return _windows_.SplitterWindow_SetMinimumPaneSize(*args, **kwargs)

    def GetMinimumPaneSize(*args, **kwargs):
        return _windows_.SplitterWindow_GetMinimumPaneSize(*args, **kwargs)

    def SashHitTest(*args, **kwargs):
        return _windows_.SplitterWindow_SashHitTest(*args, **kwargs)

    def SizeWindows(*args, **kwargs):
        return _windows_.SplitterWindow_SizeWindows(*args, **kwargs)

    def SetNeedUpdating(*args, **kwargs):
        return _windows_.SplitterWindow_SetNeedUpdating(*args, **kwargs)

    def GetNeedUpdating(*args, **kwargs):
        return _windows_.SplitterWindow_GetNeedUpdating(*args, **kwargs)

    def GetClassDefaultAttributes(*args, **kwargs):
        return _windows_.SplitterWindow_GetClassDefaultAttributes(*args, **kwargs)

    GetClassDefaultAttributes = staticmethod(GetClassDefaultAttributes)
    BorderSize = property(GetBorderSize, SetBorderSize, doc='See `GetBorderSize` and `SetBorderSize`')
    MinimumPaneSize = property(GetMinimumPaneSize, SetMinimumPaneSize, doc='See `GetMinimumPaneSize` and `SetMinimumPaneSize`')
    NeedUpdating = property(GetNeedUpdating, SetNeedUpdating, doc='See `GetNeedUpdating` and `SetNeedUpdating`')
    SashGravity = property(GetSashGravity, SetSashGravity, doc='See `GetSashGravity` and `SetSashGravity`')
    SashPosition = property(GetSashPosition, SetSashPosition, doc='See `GetSashPosition` and `SetSashPosition`')
    SashSize = property(GetSashSize, SetSashSize, doc='See `GetSashSize` and `SetSashSize`')
    SplitMode = property(GetSplitMode, SetSplitMode, doc='See `GetSplitMode` and `SetSplitMode`')
    Window1 = property(GetWindow1, doc='See `GetWindow1`')
    Window2 = property(GetWindow2, doc='See `GetWindow2`')


_windows_.SplitterWindow_swigregister(SplitterWindow)
SplitterNameStr = cvar.SplitterNameStr

def PreSplitterWindow(*args, **kwargs):
    val = _windows_.new_PreSplitterWindow(*args, **kwargs)
    return val


def SplitterWindow_GetClassDefaultAttributes(*args, **kwargs):
    return _windows_.SplitterWindow_GetClassDefaultAttributes(*args, **kwargs)


class SplitterEvent(_core.NotifyEvent):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.SplitterEvent_swiginit(self, _windows_.new_SplitterEvent(*args, **kwargs))
        return

    def SetSashPosition(*args, **kwargs):
        return _windows_.SplitterEvent_SetSashPosition(*args, **kwargs)

    def GetSashPosition(*args, **kwargs):
        return _windows_.SplitterEvent_GetSashPosition(*args, **kwargs)

    def GetWindowBeingRemoved(*args, **kwargs):
        return _windows_.SplitterEvent_GetWindowBeingRemoved(*args, **kwargs)

    def GetX(*args, **kwargs):
        return _windows_.SplitterEvent_GetX(*args, **kwargs)

    def GetY(*args, **kwargs):
        return _windows_.SplitterEvent_GetY(*args, **kwargs)

    SashPosition = property(GetSashPosition, SetSashPosition, doc='See `GetSashPosition` and `SetSashPosition`')
    WindowBeingRemoved = property(GetWindowBeingRemoved, doc='See `GetWindowBeingRemoved`')
    X = property(GetX, doc='See `GetX`')
    Y = property(GetY, doc='See `GetY`')


_windows_.SplitterEvent_swigregister(SplitterEvent)
wxEVT_COMMAND_SPLITTER_SASH_POS_CHANGED = _windows_.wxEVT_COMMAND_SPLITTER_SASH_POS_CHANGED
wxEVT_COMMAND_SPLITTER_SASH_POS_CHANGING = _windows_.wxEVT_COMMAND_SPLITTER_SASH_POS_CHANGING
wxEVT_COMMAND_SPLITTER_DOUBLECLICKED = _windows_.wxEVT_COMMAND_SPLITTER_DOUBLECLICKED
wxEVT_COMMAND_SPLITTER_UNSPLIT = _windows_.wxEVT_COMMAND_SPLITTER_UNSPLIT
EVT_SPLITTER_SASH_POS_CHANGED = wx.PyEventBinder(wxEVT_COMMAND_SPLITTER_SASH_POS_CHANGED, 1)
EVT_SPLITTER_SASH_POS_CHANGING = wx.PyEventBinder(wxEVT_COMMAND_SPLITTER_SASH_POS_CHANGING, 1)
EVT_SPLITTER_DOUBLECLICKED = wx.PyEventBinder(wxEVT_COMMAND_SPLITTER_DOUBLECLICKED, 1)
EVT_SPLITTER_UNSPLIT = wx.PyEventBinder(wxEVT_COMMAND_SPLITTER_UNSPLIT, 1)
EVT_SPLITTER_DCLICK = EVT_SPLITTER_DOUBLECLICKED
SASH_DRAG_NONE = _windows_.SASH_DRAG_NONE
SASH_DRAG_DRAGGING = _windows_.SASH_DRAG_DRAGGING
SASH_DRAG_LEFT_DOWN = _windows_.SASH_DRAG_LEFT_DOWN
SW_NOBORDER = _windows_.SW_NOBORDER
SW_BORDER = _windows_.SW_BORDER
SW_3DSASH = _windows_.SW_3DSASH
SW_3DBORDER = _windows_.SW_3DBORDER
SW_3D = _windows_.SW_3D
SASH_TOP = _windows_.SASH_TOP
SASH_RIGHT = _windows_.SASH_RIGHT
SASH_BOTTOM = _windows_.SASH_BOTTOM
SASH_LEFT = _windows_.SASH_LEFT
SASH_NONE = _windows_.SASH_NONE

class SashWindow(_core.Window):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.SashWindow_swiginit(self, _windows_.new_SashWindow(*args, **kwargs))
        self._setOORInfo(self)
        return

    def Create(*args, **kwargs):
        return _windows_.SashWindow_Create(*args, **kwargs)

    def SetSashVisible(*args, **kwargs):
        return _windows_.SashWindow_SetSashVisible(*args, **kwargs)

    def GetSashVisible(*args, **kwargs):
        return _windows_.SashWindow_GetSashVisible(*args, **kwargs)

    def SetSashBorder(*args, **kwargs):
        return _windows_.SashWindow_SetSashBorder(*args, **kwargs)

    SetSashBorder = wx._deprecated(SetSashBorder)

    def HasBorder(*args, **kwargs):
        return _windows_.SashWindow_HasBorder(*args, **kwargs)

    HasBorder = wx._deprecated(HasBorder)

    def GetEdgeMargin(*args, **kwargs):
        return _windows_.SashWindow_GetEdgeMargin(*args, **kwargs)

    def SetDefaultBorderSize(*args, **kwargs):
        return _windows_.SashWindow_SetDefaultBorderSize(*args, **kwargs)

    def GetDefaultBorderSize(*args, **kwargs):
        return _windows_.SashWindow_GetDefaultBorderSize(*args, **kwargs)

    def SetExtraBorderSize(*args, **kwargs):
        return _windows_.SashWindow_SetExtraBorderSize(*args, **kwargs)

    def GetExtraBorderSize(*args, **kwargs):
        return _windows_.SashWindow_GetExtraBorderSize(*args, **kwargs)

    def SetMinimumSizeX(*args, **kwargs):
        return _windows_.SashWindow_SetMinimumSizeX(*args, **kwargs)

    def SetMinimumSizeY(*args, **kwargs):
        return _windows_.SashWindow_SetMinimumSizeY(*args, **kwargs)

    def GetMinimumSizeX(*args, **kwargs):
        return _windows_.SashWindow_GetMinimumSizeX(*args, **kwargs)

    def GetMinimumSizeY(*args, **kwargs):
        return _windows_.SashWindow_GetMinimumSizeY(*args, **kwargs)

    def SetMaximumSizeX(*args, **kwargs):
        return _windows_.SashWindow_SetMaximumSizeX(*args, **kwargs)

    def SetMaximumSizeY(*args, **kwargs):
        return _windows_.SashWindow_SetMaximumSizeY(*args, **kwargs)

    def GetMaximumSizeX(*args, **kwargs):
        return _windows_.SashWindow_GetMaximumSizeX(*args, **kwargs)

    def GetMaximumSizeY(*args, **kwargs):
        return _windows_.SashWindow_GetMaximumSizeY(*args, **kwargs)

    def SashHitTest(*args, **kwargs):
        return _windows_.SashWindow_SashHitTest(*args, **kwargs)

    def SizeWindows(*args, **kwargs):
        return _windows_.SashWindow_SizeWindows(*args, **kwargs)

    DefaultBorderSize = property(GetDefaultBorderSize, SetDefaultBorderSize, doc='See `GetDefaultBorderSize` and `SetDefaultBorderSize`')
    ExtraBorderSize = property(GetExtraBorderSize, SetExtraBorderSize, doc='See `GetExtraBorderSize` and `SetExtraBorderSize`')
    MaximumSizeX = property(GetMaximumSizeX, SetMaximumSizeX, doc='See `GetMaximumSizeX` and `SetMaximumSizeX`')
    MaximumSizeY = property(GetMaximumSizeY, SetMaximumSizeY, doc='See `GetMaximumSizeY` and `SetMaximumSizeY`')
    MinimumSizeX = property(GetMinimumSizeX, SetMinimumSizeX, doc='See `GetMinimumSizeX` and `SetMinimumSizeX`')
    MinimumSizeY = property(GetMinimumSizeY, SetMinimumSizeY, doc='See `GetMinimumSizeY` and `SetMinimumSizeY`')


_windows_.SashWindow_swigregister(SashWindow)
SashNameStr = cvar.SashNameStr
SashLayoutNameStr = cvar.SashLayoutNameStr

def PreSashWindow(*args, **kwargs):
    val = _windows_.new_PreSashWindow(*args, **kwargs)
    return val


SASH_STATUS_OK = _windows_.SASH_STATUS_OK
SASH_STATUS_OUT_OF_RANGE = _windows_.SASH_STATUS_OUT_OF_RANGE

class SashEvent(_core.CommandEvent):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.SashEvent_swiginit(self, _windows_.new_SashEvent(*args, **kwargs))
        return

    def SetEdge(*args, **kwargs):
        return _windows_.SashEvent_SetEdge(*args, **kwargs)

    def GetEdge(*args, **kwargs):
        return _windows_.SashEvent_GetEdge(*args, **kwargs)

    def SetDragRect(*args, **kwargs):
        return _windows_.SashEvent_SetDragRect(*args, **kwargs)

    def GetDragRect(*args, **kwargs):
        return _windows_.SashEvent_GetDragRect(*args, **kwargs)

    def SetDragStatus(*args, **kwargs):
        return _windows_.SashEvent_SetDragStatus(*args, **kwargs)

    def GetDragStatus(*args, **kwargs):
        return _windows_.SashEvent_GetDragStatus(*args, **kwargs)

    DragRect = property(GetDragRect, SetDragRect, doc='See `GetDragRect` and `SetDragRect`')
    DragStatus = property(GetDragStatus, SetDragStatus, doc='See `GetDragStatus` and `SetDragStatus`')
    Edge = property(GetEdge, SetEdge, doc='See `GetEdge` and `SetEdge`')


_windows_.SashEvent_swigregister(SashEvent)
wxEVT_SASH_DRAGGED = _windows_.wxEVT_SASH_DRAGGED
EVT_SASH_DRAGGED = wx.PyEventBinder(wxEVT_SASH_DRAGGED, 1)
EVT_SASH_DRAGGED_RANGE = wx.PyEventBinder(wxEVT_SASH_DRAGGED, 2)
LAYOUT_HORIZONTAL = _windows_.LAYOUT_HORIZONTAL
LAYOUT_VERTICAL = _windows_.LAYOUT_VERTICAL
LAYOUT_NONE = _windows_.LAYOUT_NONE
LAYOUT_TOP = _windows_.LAYOUT_TOP
LAYOUT_LEFT = _windows_.LAYOUT_LEFT
LAYOUT_RIGHT = _windows_.LAYOUT_RIGHT
LAYOUT_BOTTOM = _windows_.LAYOUT_BOTTOM
LAYOUT_LENGTH_Y = _windows_.LAYOUT_LENGTH_Y
LAYOUT_LENGTH_X = _windows_.LAYOUT_LENGTH_X
LAYOUT_MRU_LENGTH = _windows_.LAYOUT_MRU_LENGTH
LAYOUT_QUERY = _windows_.LAYOUT_QUERY
wxEVT_QUERY_LAYOUT_INFO = _windows_.wxEVT_QUERY_LAYOUT_INFO
wxEVT_CALCULATE_LAYOUT = _windows_.wxEVT_CALCULATE_LAYOUT

class QueryLayoutInfoEvent(_core.Event):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.QueryLayoutInfoEvent_swiginit(self, _windows_.new_QueryLayoutInfoEvent(*args, **kwargs))
        return

    def SetRequestedLength(*args, **kwargs):
        return _windows_.QueryLayoutInfoEvent_SetRequestedLength(*args, **kwargs)

    def GetRequestedLength(*args, **kwargs):
        return _windows_.QueryLayoutInfoEvent_GetRequestedLength(*args, **kwargs)

    def SetFlags(*args, **kwargs):
        return _windows_.QueryLayoutInfoEvent_SetFlags(*args, **kwargs)

    def GetFlags(*args, **kwargs):
        return _windows_.QueryLayoutInfoEvent_GetFlags(*args, **kwargs)

    def SetSize(*args, **kwargs):
        return _windows_.QueryLayoutInfoEvent_SetSize(*args, **kwargs)

    def GetSize(*args, **kwargs):
        return _windows_.QueryLayoutInfoEvent_GetSize(*args, **kwargs)

    def SetOrientation(*args, **kwargs):
        return _windows_.QueryLayoutInfoEvent_SetOrientation(*args, **kwargs)

    def GetOrientation(*args, **kwargs):
        return _windows_.QueryLayoutInfoEvent_GetOrientation(*args, **kwargs)

    def SetAlignment(*args, **kwargs):
        return _windows_.QueryLayoutInfoEvent_SetAlignment(*args, **kwargs)

    def GetAlignment(*args, **kwargs):
        return _windows_.QueryLayoutInfoEvent_GetAlignment(*args, **kwargs)

    Alignment = property(GetAlignment, SetAlignment, doc='See `GetAlignment` and `SetAlignment`')
    Flags = property(GetFlags, SetFlags, doc='See `GetFlags` and `SetFlags`')
    Orientation = property(GetOrientation, SetOrientation, doc='See `GetOrientation` and `SetOrientation`')
    RequestedLength = property(GetRequestedLength, SetRequestedLength, doc='See `GetRequestedLength` and `SetRequestedLength`')
    Size = property(GetSize, SetSize, doc='See `GetSize` and `SetSize`')


_windows_.QueryLayoutInfoEvent_swigregister(QueryLayoutInfoEvent)

class CalculateLayoutEvent(_core.Event):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.CalculateLayoutEvent_swiginit(self, _windows_.new_CalculateLayoutEvent(*args, **kwargs))
        return

    def SetFlags(*args, **kwargs):
        return _windows_.CalculateLayoutEvent_SetFlags(*args, **kwargs)

    def GetFlags(*args, **kwargs):
        return _windows_.CalculateLayoutEvent_GetFlags(*args, **kwargs)

    def SetRect(*args, **kwargs):
        return _windows_.CalculateLayoutEvent_SetRect(*args, **kwargs)

    def GetRect(*args, **kwargs):
        return _windows_.CalculateLayoutEvent_GetRect(*args, **kwargs)

    Flags = property(GetFlags, SetFlags, doc='See `GetFlags` and `SetFlags`')
    Rect = property(GetRect, SetRect, doc='See `GetRect` and `SetRect`')


_windows_.CalculateLayoutEvent_swigregister(CalculateLayoutEvent)
EVT_QUERY_LAYOUT_INFO = wx.PyEventBinder(wxEVT_QUERY_LAYOUT_INFO)
EVT_CALCULATE_LAYOUT = wx.PyEventBinder(wxEVT_CALCULATE_LAYOUT)

class SashLayoutWindow(SashWindow):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.SashLayoutWindow_swiginit(self, _windows_.new_SashLayoutWindow(*args, **kwargs))
        self._setOORInfo(self)
        return

    def Create(*args, **kwargs):
        return _windows_.SashLayoutWindow_Create(*args, **kwargs)

    def GetAlignment(*args, **kwargs):
        return _windows_.SashLayoutWindow_GetAlignment(*args, **kwargs)

    def GetOrientation(*args, **kwargs):
        return _windows_.SashLayoutWindow_GetOrientation(*args, **kwargs)

    def SetAlignment(*args, **kwargs):
        return _windows_.SashLayoutWindow_SetAlignment(*args, **kwargs)

    def SetDefaultSize(*args, **kwargs):
        return _windows_.SashLayoutWindow_SetDefaultSize(*args, **kwargs)

    def SetOrientation(*args, **kwargs):
        return _windows_.SashLayoutWindow_SetOrientation(*args, **kwargs)

    Alignment = property(GetAlignment, SetAlignment, doc='See `GetAlignment` and `SetAlignment`')
    Orientation = property(GetOrientation, SetOrientation, doc='See `GetOrientation` and `SetOrientation`')


_windows_.SashLayoutWindow_swigregister(SashLayoutWindow)

def PreSashLayoutWindow(*args, **kwargs):
    val = _windows_.new_PreSashLayoutWindow(*args, **kwargs)
    return val


class LayoutAlgorithm(_core.Object):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.LayoutAlgorithm_swiginit(self, _windows_.new_LayoutAlgorithm(*args, **kwargs))
        return

    __swig_destroy__ = _windows_.delete_LayoutAlgorithm
    __del__ = lambda self: None

    def LayoutMDIFrame(*args, **kwargs):
        return _windows_.LayoutAlgorithm_LayoutMDIFrame(*args, **kwargs)

    def LayoutFrame(*args, **kwargs):
        return _windows_.LayoutAlgorithm_LayoutFrame(*args, **kwargs)

    def LayoutWindow(*args, **kwargs):
        return _windows_.LayoutAlgorithm_LayoutWindow(*args, **kwargs)


_windows_.LayoutAlgorithm_swigregister(LayoutAlgorithm)

class PopupWindow(_core.Window):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.PopupWindow_swiginit(self, _windows_.new_PopupWindow(*args, **kwargs))
        self._setOORInfo(self)
        return

    def Create(*args, **kwargs):
        return _windows_.PopupWindow_Create(*args, **kwargs)

    def Position(*args, **kwargs):
        return _windows_.PopupWindow_Position(*args, **kwargs)


_windows_.PopupWindow_swigregister(PopupWindow)

def PrePopupWindow(*args, **kwargs):
    val = _windows_.new_PrePopupWindow(*args, **kwargs)
    return val


class PopupTransientWindow(PopupWindow):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.PopupTransientWindow_swiginit(self, _windows_.new_PopupTransientWindow(*args, **kwargs))
        self._setOORInfo(self)
        PopupTransientWindow._setCallbackInfo(self, self, PopupTransientWindow)
        return

    def _setCallbackInfo(*args, **kwargs):
        return _windows_.PopupTransientWindow__setCallbackInfo(*args, **kwargs)

    def Popup(*args, **kwargs):
        return _windows_.PopupTransientWindow_Popup(*args, **kwargs)

    def Dismiss(*args, **kwargs):
        return _windows_.PopupTransientWindow_Dismiss(*args, **kwargs)


_windows_.PopupTransientWindow_swigregister(PopupTransientWindow)

def PrePopupTransientWindow(*args, **kwargs):
    val = _windows_.new_PrePopupTransientWindow(*args, **kwargs)
    return val


class TipWindow(PopupTransientWindow):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.TipWindow_swiginit(self, _windows_.new_TipWindow(*args, **kwargs))
        self._setOORInfo(self)
        return

    def SetBoundingRect(*args, **kwargs):
        return _windows_.TipWindow_SetBoundingRect(*args, **kwargs)

    def Close(*args, **kwargs):
        return _windows_.TipWindow_Close(*args, **kwargs)


_windows_.TipWindow_swigregister(TipWindow)

class VScrolledWindow(Panel):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.VScrolledWindow_swiginit(self, _windows_.new_VScrolledWindow(*args, **kwargs))
        self._setOORInfo(self)
        VScrolledWindow._setCallbackInfo(self, self, VScrolledWindow)
        return

    def _setCallbackInfo(*args, **kwargs):
        return _windows_.VScrolledWindow__setCallbackInfo(*args, **kwargs)

    def Create(*args, **kwargs):
        return _windows_.VScrolledWindow_Create(*args, **kwargs)

    def SetLineCount(*args, **kwargs):
        return _windows_.VScrolledWindow_SetLineCount(*args, **kwargs)

    def ScrollToLine(*args, **kwargs):
        return _windows_.VScrolledWindow_ScrollToLine(*args, **kwargs)

    def RefreshLine(*args, **kwargs):
        return _windows_.VScrolledWindow_RefreshLine(*args, **kwargs)

    def RefreshLines(*args, **kwargs):
        return _windows_.VScrolledWindow_RefreshLines(*args, **kwargs)

    def HitTestXY(*args, **kwargs):
        return _windows_.VScrolledWindow_HitTestXY(*args, **kwargs)

    def HitTest(*args, **kwargs):
        return _windows_.VScrolledWindow_HitTest(*args, **kwargs)

    def RefreshAll(*args, **kwargs):
        return _windows_.VScrolledWindow_RefreshAll(*args, **kwargs)

    def GetLineCount(*args, **kwargs):
        return _windows_.VScrolledWindow_GetLineCount(*args, **kwargs)

    def GetVisibleBegin(*args, **kwargs):
        return _windows_.VScrolledWindow_GetVisibleBegin(*args, **kwargs)

    def GetVisibleEnd(*args, **kwargs):
        return _windows_.VScrolledWindow_GetVisibleEnd(*args, **kwargs)

    def IsVisible(*args, **kwargs):
        return _windows_.VScrolledWindow_IsVisible(*args, **kwargs)

    def GetFirstVisibleLine(*args, **kwargs):
        return _windows_.VScrolledWindow_GetFirstVisibleLine(*args, **kwargs)

    def GetLastVisibleLine(*args, **kwargs):
        return _windows_.VScrolledWindow_GetLastVisibleLine(*args, **kwargs)

    def FindFirstFromBottom(*args, **kwargs):
        return _windows_.VScrolledWindow_FindFirstFromBottom(*args, **kwargs)

    def GetLinesHeight(*args, **kwargs):
        return _windows_.VScrolledWindow_GetLinesHeight(*args, **kwargs)

    FirstVisibleLine = property(GetFirstVisibleLine, doc='See `GetFirstVisibleLine`')
    LastVisibleLine = property(GetLastVisibleLine, doc='See `GetLastVisibleLine`')
    LineCount = property(GetLineCount, SetLineCount, doc='See `GetLineCount` and `SetLineCount`')
    VisibleBegin = property(GetVisibleBegin, doc='See `GetVisibleBegin`')
    VisibleEnd = property(GetVisibleEnd, doc='See `GetVisibleEnd`')


_windows_.VScrolledWindow_swigregister(VScrolledWindow)

def PreVScrolledWindow(*args, **kwargs):
    val = _windows_.new_PreVScrolledWindow(*args, **kwargs)
    return val


class VListBox(VScrolledWindow):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.VListBox_swiginit(self, _windows_.new_VListBox(*args, **kwargs))
        self._setOORInfo(self)
        VListBox._setCallbackInfo(self, self, VListBox)
        return

    def _setCallbackInfo(*args, **kwargs):
        return _windows_.VListBox__setCallbackInfo(*args, **kwargs)

    def Create(*args, **kwargs):
        return _windows_.VListBox_Create(*args, **kwargs)

    def GetItemCount(*args, **kwargs):
        return _windows_.VListBox_GetItemCount(*args, **kwargs)

    def HasMultipleSelection(*args, **kwargs):
        return _windows_.VListBox_HasMultipleSelection(*args, **kwargs)

    def GetSelection(*args, **kwargs):
        return _windows_.VListBox_GetSelection(*args, **kwargs)

    def IsCurrent(*args, **kwargs):
        return _windows_.VListBox_IsCurrent(*args, **kwargs)

    def IsSelected(*args, **kwargs):
        return _windows_.VListBox_IsSelected(*args, **kwargs)

    def GetSelectedCount(*args, **kwargs):
        return _windows_.VListBox_GetSelectedCount(*args, **kwargs)

    def GetFirstSelected(*args, **kwargs):
        return _windows_.VListBox_GetFirstSelected(*args, **kwargs)

    def GetNextSelected(*args, **kwargs):
        return _windows_.VListBox_GetNextSelected(*args, **kwargs)

    def GetMargins(*args, **kwargs):
        return _windows_.VListBox_GetMargins(*args, **kwargs)

    def GetSelectionBackground(*args, **kwargs):
        return _windows_.VListBox_GetSelectionBackground(*args, **kwargs)

    def SetItemCount(*args, **kwargs):
        return _windows_.VListBox_SetItemCount(*args, **kwargs)

    def Clear(*args, **kwargs):
        return _windows_.VListBox_Clear(*args, **kwargs)

    def SetSelection(*args, **kwargs):
        return _windows_.VListBox_SetSelection(*args, **kwargs)

    def Select(*args, **kwargs):
        return _windows_.VListBox_Select(*args, **kwargs)

    def SelectRange(*args, **kwargs):
        return _windows_.VListBox_SelectRange(*args, **kwargs)

    def Toggle(*args, **kwargs):
        return _windows_.VListBox_Toggle(*args, **kwargs)

    def SelectAll(*args, **kwargs):
        return _windows_.VListBox_SelectAll(*args, **kwargs)

    def DeselectAll(*args, **kwargs):
        return _windows_.VListBox_DeselectAll(*args, **kwargs)

    def SetMargins(*args, **kwargs):
        return _windows_.VListBox_SetMargins(*args, **kwargs)

    def SetMarginsXY(*args, **kwargs):
        return _windows_.VListBox_SetMarginsXY(*args, **kwargs)

    def SetSelectionBackground(*args, **kwargs):
        return _windows_.VListBox_SetSelectionBackground(*args, **kwargs)

    def OnDrawSeparator(*args, **kwargs):
        return _windows_.VListBox_OnDrawSeparator(*args, **kwargs)

    def OnDrawBackground(*args, **kwargs):
        return _windows_.VListBox_OnDrawBackground(*args, **kwargs)

    FirstSelected = property(GetFirstSelected, doc='See `GetFirstSelected`')
    ItemCount = property(GetItemCount, SetItemCount, doc='See `GetItemCount` and `SetItemCount`')
    Margins = property(GetMargins, SetMargins, doc='See `GetMargins` and `SetMargins`')
    SelectedCount = property(GetSelectedCount, doc='See `GetSelectedCount`')
    Selection = property(GetSelection, SetSelection, doc='See `GetSelection` and `SetSelection`')
    SelectionBackground = property(GetSelectionBackground, SetSelectionBackground, doc='See `GetSelectionBackground` and `SetSelectionBackground`')


_windows_.VListBox_swigregister(VListBox)
VListBoxNameStr = cvar.VListBoxNameStr

def PreVListBox(*args, **kwargs):
    val = _windows_.new_PreVListBox(*args, **kwargs)
    return val


class HtmlListBox(VListBox):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.HtmlListBox_swiginit(self, _windows_.new_HtmlListBox(*args, **kwargs))
        self._setOORInfo(self)
        HtmlListBox._setCallbackInfo(self, self, HtmlListBox)
        return

    def _setCallbackInfo(*args, **kwargs):
        return _windows_.HtmlListBox__setCallbackInfo(*args, **kwargs)

    def Create(*args, **kwargs):
        return _windows_.HtmlListBox_Create(*args, **kwargs)

    def SetItemCount(*args, **kwargs):
        return _windows_.HtmlListBox_SetItemCount(*args, **kwargs)

    def GetFileSystem(*args, **kwargs):
        return _windows_.HtmlListBox_GetFileSystem(*args, **kwargs)

    def OnLinkClicked(*args, **kwargs):
        return _windows_.HtmlListBox_OnLinkClicked(*args, **kwargs)

    FileSystem = property(GetFileSystem, doc='See `GetFileSystem`')


_windows_.HtmlListBox_swigregister(HtmlListBox)

def PreHtmlListBox(*args, **kwargs):
    val = _windows_.new_PreHtmlListBox(*args, **kwargs)
    return val


HLB_DEFAULT_STYLE = _windows_.HLB_DEFAULT_STYLE
HLB_MULTIPLE = _windows_.HLB_MULTIPLE

class SimpleHtmlListBox(HtmlListBox, _core.ItemContainer):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.SimpleHtmlListBox_swiginit(self, _windows_.new_SimpleHtmlListBox(*args, **kwargs))
        self._setOORInfo(self)
        return

    def Create(*args, **kwargs):
        return _windows_.SimpleHtmlListBox_Create(*args, **kwargs)

    def _Clear(*args, **kwargs):
        return _windows_.SimpleHtmlListBox__Clear(*args, **kwargs)

    Clear = _Clear


_windows_.SimpleHtmlListBox_swigregister(SimpleHtmlListBox)
SimpleHtmlListBoxNameStr = cvar.SimpleHtmlListBoxNameStr

def PreSimpleHtmlListBox(*args, **kwargs):
    val = _windows_.new_PreSimpleHtmlListBox(*args, **kwargs)
    return val


class TaskBarIcon(_core.EvtHandler):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.TaskBarIcon_swiginit(self, _windows_.new_TaskBarIcon(*args, **kwargs))
        TaskBarIcon._setCallbackInfo(self, self, TaskBarIcon)
        return

    __swig_destroy__ = _windows_.delete_TaskBarIcon
    __del__ = lambda self: None

    def _setCallbackInfo(*args, **kwargs):
        return _windows_.TaskBarIcon__setCallbackInfo(*args, **kwargs)

    def Destroy(*args, **kwargs):
        args[0].this.own(False)
        return _windows_.TaskBarIcon_Destroy(*args, **kwargs)

    def IsOk(*args, **kwargs):
        return _windows_.TaskBarIcon_IsOk(*args, **kwargs)

    def __nonzero__(self):
        return self.IsOk()

    def IsIconInstalled(*args, **kwargs):
        return _windows_.TaskBarIcon_IsIconInstalled(*args, **kwargs)

    def SetIcon(*args, **kwargs):
        return _windows_.TaskBarIcon_SetIcon(*args, **kwargs)

    def RemoveIcon(*args, **kwargs):
        return _windows_.TaskBarIcon_RemoveIcon(*args, **kwargs)

    def PopupMenu(*args, **kwargs):
        return _windows_.TaskBarIcon_PopupMenu(*args, **kwargs)


_windows_.TaskBarIcon_swigregister(TaskBarIcon)

class TaskBarIconEvent(_core.Event):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.TaskBarIconEvent_swiginit(self, _windows_.new_TaskBarIconEvent(*args, **kwargs))
        return


_windows_.TaskBarIconEvent_swigregister(TaskBarIconEvent)
wxEVT_TASKBAR_MOVE = _windows_.wxEVT_TASKBAR_MOVE
wxEVT_TASKBAR_LEFT_DOWN = _windows_.wxEVT_TASKBAR_LEFT_DOWN
wxEVT_TASKBAR_LEFT_UP = _windows_.wxEVT_TASKBAR_LEFT_UP
wxEVT_TASKBAR_RIGHT_DOWN = _windows_.wxEVT_TASKBAR_RIGHT_DOWN
wxEVT_TASKBAR_RIGHT_UP = _windows_.wxEVT_TASKBAR_RIGHT_UP
wxEVT_TASKBAR_LEFT_DCLICK = _windows_.wxEVT_TASKBAR_LEFT_DCLICK
wxEVT_TASKBAR_RIGHT_DCLICK = _windows_.wxEVT_TASKBAR_RIGHT_DCLICK
wxEVT_TASKBAR_CLICK = _windows_.wxEVT_TASKBAR_CLICK
EVT_TASKBAR_MOVE = wx.PyEventBinder(wxEVT_TASKBAR_MOVE)
EVT_TASKBAR_LEFT_DOWN = wx.PyEventBinder(wxEVT_TASKBAR_LEFT_DOWN)
EVT_TASKBAR_LEFT_UP = wx.PyEventBinder(wxEVT_TASKBAR_LEFT_UP)
EVT_TASKBAR_RIGHT_DOWN = wx.PyEventBinder(wxEVT_TASKBAR_RIGHT_DOWN)
EVT_TASKBAR_RIGHT_UP = wx.PyEventBinder(wxEVT_TASKBAR_RIGHT_UP)
EVT_TASKBAR_LEFT_DCLICK = wx.PyEventBinder(wxEVT_TASKBAR_LEFT_DCLICK)
EVT_TASKBAR_RIGHT_DCLICK = wx.PyEventBinder(wxEVT_TASKBAR_RIGHT_DCLICK)
EVT_TASKBAR_CLICK = wx.PyEventBinder(wxEVT_TASKBAR_CLICK)

class ColourData(_core.Object):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.ColourData_swiginit(self, _windows_.new_ColourData(*args, **kwargs))
        return

    __swig_destroy__ = _windows_.delete_ColourData
    __del__ = lambda self: None

    def GetChooseFull(*args, **kwargs):
        return _windows_.ColourData_GetChooseFull(*args, **kwargs)

    def GetColour(*args, **kwargs):
        return _windows_.ColourData_GetColour(*args, **kwargs)

    def GetCustomColour(*args, **kwargs):
        return _windows_.ColourData_GetCustomColour(*args, **kwargs)

    def SetChooseFull(*args, **kwargs):
        return _windows_.ColourData_SetChooseFull(*args, **kwargs)

    def SetColour(*args, **kwargs):
        return _windows_.ColourData_SetColour(*args, **kwargs)

    def SetCustomColour(*args, **kwargs):
        return _windows_.ColourData_SetCustomColour(*args, **kwargs)

    ChooseFull = property(GetChooseFull, SetChooseFull, doc='See `GetChooseFull` and `SetChooseFull`')
    Colour = property(GetColour, SetColour, doc='See `GetColour` and `SetColour`')
    CustomColour = property(GetCustomColour, SetCustomColour, doc='See `GetCustomColour` and `SetCustomColour`')


_windows_.ColourData_swigregister(ColourData)
FileSelectorPromptStr = cvar.FileSelectorPromptStr
DirSelectorPromptStr = cvar.DirSelectorPromptStr
DirDialogNameStr = cvar.DirDialogNameStr
FileSelectorDefaultWildcardStr = cvar.FileSelectorDefaultWildcardStr
GetTextFromUserPromptStr = cvar.GetTextFromUserPromptStr
MessageBoxCaptionStr = cvar.MessageBoxCaptionStr

class ColourDialog(Dialog):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.ColourDialog_swiginit(self, _windows_.new_ColourDialog(*args, **kwargs))
        self._setOORInfo(self)
        return

    def GetColourData(*args, **kwargs):
        return _windows_.ColourDialog_GetColourData(*args, **kwargs)

    ColourData = property(GetColourData, doc='See `GetColourData`')


_windows_.ColourDialog_swigregister(ColourDialog)

def GetColourFromUser(*args, **kwargs):
    return _windows_.GetColourFromUser(*args, **kwargs)


DD_CHANGE_DIR = _windows_.DD_CHANGE_DIR
DD_DIR_MUST_EXIST = _windows_.DD_DIR_MUST_EXIST
DD_NEW_DIR_BUTTON = _windows_.DD_NEW_DIR_BUTTON
DD_DEFAULT_STYLE = _windows_.DD_DEFAULT_STYLE

class DirDialog(Dialog):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.DirDialog_swiginit(self, _windows_.new_DirDialog(*args, **kwargs))
        self._setOORInfo(self)
        return

    def GetPath(*args, **kwargs):
        return _windows_.DirDialog_GetPath(*args, **kwargs)

    def GetMessage(*args, **kwargs):
        return _windows_.DirDialog_GetMessage(*args, **kwargs)

    def SetMessage(*args, **kwargs):
        return _windows_.DirDialog_SetMessage(*args, **kwargs)

    def SetPath(*args, **kwargs):
        return _windows_.DirDialog_SetPath(*args, **kwargs)

    Message = property(GetMessage, SetMessage, doc='See `GetMessage` and `SetMessage`')
    Path = property(GetPath, SetPath, doc='See `GetPath` and `SetPath`')


_windows_.DirDialog_swigregister(DirDialog)
OPEN = _windows_.OPEN
SAVE = _windows_.SAVE
OVERWRITE_PROMPT = _windows_.OVERWRITE_PROMPT
FILE_MUST_EXIST = _windows_.FILE_MUST_EXIST
MULTIPLE = _windows_.MULTIPLE
CHANGE_DIR = _windows_.CHANGE_DIR
HIDE_READONLY = _windows_.HIDE_READONLY
FD_OPEN = _windows_.FD_OPEN
FD_SAVE = _windows_.FD_SAVE
FD_OVERWRITE_PROMPT = _windows_.FD_OVERWRITE_PROMPT
FD_FILE_MUST_EXIST = _windows_.FD_FILE_MUST_EXIST
FD_MULTIPLE = _windows_.FD_MULTIPLE
FD_CHANGE_DIR = _windows_.FD_CHANGE_DIR
FD_PREVIEW = _windows_.FD_PREVIEW
FD_DEFAULT_STYLE = _windows_.FD_DEFAULT_STYLE

class FileDialog(Dialog):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.FileDialog_swiginit(self, _windows_.new_FileDialog(*args, **kwargs))
        self._setOORInfo(self)
        return

    def SetMessage(*args, **kwargs):
        return _windows_.FileDialog_SetMessage(*args, **kwargs)

    def SetPath(*args, **kwargs):
        return _windows_.FileDialog_SetPath(*args, **kwargs)

    def SetDirectory(*args, **kwargs):
        return _windows_.FileDialog_SetDirectory(*args, **kwargs)

    def SetFilename(*args, **kwargs):
        return _windows_.FileDialog_SetFilename(*args, **kwargs)

    def SetWildcard(*args, **kwargs):
        return _windows_.FileDialog_SetWildcard(*args, **kwargs)

    def SetFilterIndex(*args, **kwargs):
        return _windows_.FileDialog_SetFilterIndex(*args, **kwargs)

    def GetMessage(*args, **kwargs):
        return _windows_.FileDialog_GetMessage(*args, **kwargs)

    def GetPath(*args, **kwargs):
        return _windows_.FileDialog_GetPath(*args, **kwargs)

    def GetDirectory(*args, **kwargs):
        return _windows_.FileDialog_GetDirectory(*args, **kwargs)

    def GetFilename(*args, **kwargs):
        return _windows_.FileDialog_GetFilename(*args, **kwargs)

    def GetWildcard(*args, **kwargs):
        return _windows_.FileDialog_GetWildcard(*args, **kwargs)

    def GetFilterIndex(*args, **kwargs):
        return _windows_.FileDialog_GetFilterIndex(*args, **kwargs)

    def GetFilenames(*args, **kwargs):
        return _windows_.FileDialog_GetFilenames(*args, **kwargs)

    def GetPaths(*args, **kwargs):
        return _windows_.FileDialog_GetPaths(*args, **kwargs)

    Directory = property(GetDirectory, SetDirectory, doc='See `GetDirectory` and `SetDirectory`')
    Filename = property(GetFilename, SetFilename, doc='See `GetFilename` and `SetFilename`')
    Filenames = property(GetFilenames, doc='See `GetFilenames`')
    FilterIndex = property(GetFilterIndex, SetFilterIndex, doc='See `GetFilterIndex` and `SetFilterIndex`')
    Message = property(GetMessage, SetMessage, doc='See `GetMessage` and `SetMessage`')
    Path = property(GetPath, SetPath, doc='See `GetPath` and `SetPath`')
    Paths = property(GetPaths, doc='See `GetPaths`')
    Wildcard = property(GetWildcard, SetWildcard, doc='See `GetWildcard` and `SetWildcard`')


_windows_.FileDialog_swigregister(FileDialog)
CHOICEDLG_STYLE = _windows_.CHOICEDLG_STYLE

class MultiChoiceDialog(Dialog):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.MultiChoiceDialog_swiginit(self, _windows_.new_MultiChoiceDialog(*args, **kwargs))
        self._setOORInfo(self)
        return

    def SetSelections(*args, **kwargs):
        return _windows_.MultiChoiceDialog_SetSelections(*args, **kwargs)

    def GetSelections(*args, **kwargs):
        return _windows_.MultiChoiceDialog_GetSelections(*args, **kwargs)

    Selections = property(GetSelections, SetSelections, doc='See `GetSelections` and `SetSelections`')


_windows_.MultiChoiceDialog_swigregister(MultiChoiceDialog)

class SingleChoiceDialog(Dialog):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.SingleChoiceDialog_swiginit(self, _windows_.new_SingleChoiceDialog(*args, **kwargs))
        self._setOORInfo(self)
        return

    def GetSelection(*args, **kwargs):
        return _windows_.SingleChoiceDialog_GetSelection(*args, **kwargs)

    def GetStringSelection(*args, **kwargs):
        return _windows_.SingleChoiceDialog_GetStringSelection(*args, **kwargs)

    def SetSelection(*args, **kwargs):
        return _windows_.SingleChoiceDialog_SetSelection(*args, **kwargs)

    Selection = property(GetSelection, SetSelection, doc='See `GetSelection` and `SetSelection`')
    StringSelection = property(GetStringSelection, doc='See `GetStringSelection`')


_windows_.SingleChoiceDialog_swigregister(SingleChoiceDialog)
TextEntryDialogStyle = _windows_.TextEntryDialogStyle

class TextEntryDialog(Dialog):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.TextEntryDialog_swiginit(self, _windows_.new_TextEntryDialog(*args, **kwargs))
        self._setOORInfo(self)
        return

    def GetValue(*args, **kwargs):
        return _windows_.TextEntryDialog_GetValue(*args, **kwargs)

    def SetValue(*args, **kwargs):
        return _windows_.TextEntryDialog_SetValue(*args, **kwargs)

    Value = property(GetValue, SetValue, doc='See `GetValue` and `SetValue`')


_windows_.TextEntryDialog_swigregister(TextEntryDialog)

class PasswordEntryDialog(TextEntryDialog):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.PasswordEntryDialog_swiginit(self, _windows_.new_PasswordEntryDialog(*args, **kwargs))
        return


_windows_.PasswordEntryDialog_swigregister(PasswordEntryDialog)
GetPasswordFromUserPromptStr = cvar.GetPasswordFromUserPromptStr

class NumberEntryDialog(Dialog):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.NumberEntryDialog_swiginit(self, _windows_.new_NumberEntryDialog(*args, **kwargs))
        self._setOORInfo(self)
        return

    def GetValue(*args, **kwargs):
        return _windows_.NumberEntryDialog_GetValue(*args, **kwargs)

    Value = property(GetValue, doc='See `GetValue`')


_windows_.NumberEntryDialog_swigregister(NumberEntryDialog)

class FontData(_core.Object):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.FontData_swiginit(self, _windows_.new_FontData(*args, **kwargs))
        return

    __swig_destroy__ = _windows_.delete_FontData
    __del__ = lambda self: None

    def EnableEffects(*args, **kwargs):
        return _windows_.FontData_EnableEffects(*args, **kwargs)

    def GetAllowSymbols(*args, **kwargs):
        return _windows_.FontData_GetAllowSymbols(*args, **kwargs)

    def GetColour(*args, **kwargs):
        return _windows_.FontData_GetColour(*args, **kwargs)

    def GetChosenFont(*args, **kwargs):
        return _windows_.FontData_GetChosenFont(*args, **kwargs)

    def GetEnableEffects(*args, **kwargs):
        return _windows_.FontData_GetEnableEffects(*args, **kwargs)

    def GetInitialFont(*args, **kwargs):
        return _windows_.FontData_GetInitialFont(*args, **kwargs)

    def GetShowHelp(*args, **kwargs):
        return _windows_.FontData_GetShowHelp(*args, **kwargs)

    def SetAllowSymbols(*args, **kwargs):
        return _windows_.FontData_SetAllowSymbols(*args, **kwargs)

    def SetChosenFont(*args, **kwargs):
        return _windows_.FontData_SetChosenFont(*args, **kwargs)

    def SetColour(*args, **kwargs):
        return _windows_.FontData_SetColour(*args, **kwargs)

    def SetInitialFont(*args, **kwargs):
        return _windows_.FontData_SetInitialFont(*args, **kwargs)

    def SetRange(*args, **kwargs):
        return _windows_.FontData_SetRange(*args, **kwargs)

    def SetShowHelp(*args, **kwargs):
        return _windows_.FontData_SetShowHelp(*args, **kwargs)

    AllowSymbols = property(GetAllowSymbols, SetAllowSymbols, doc='See `GetAllowSymbols` and `SetAllowSymbols`')
    ChosenFont = property(GetChosenFont, SetChosenFont, doc='See `GetChosenFont` and `SetChosenFont`')
    Colour = property(GetColour, SetColour, doc='See `GetColour` and `SetColour`')
    InitialFont = property(GetInitialFont, SetInitialFont, doc='See `GetInitialFont` and `SetInitialFont`')
    ShowHelp = property(GetShowHelp, SetShowHelp, doc='See `GetShowHelp` and `SetShowHelp`')


_windows_.FontData_swigregister(FontData)

class FontDialog(Dialog):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.FontDialog_swiginit(self, _windows_.new_FontDialog(*args, **kwargs))
        self._setOORInfo(self)
        return

    def GetFontData(*args, **kwargs):
        return _windows_.FontDialog_GetFontData(*args, **kwargs)

    FontData = property(GetFontData, doc='See `GetFontData`')


_windows_.FontDialog_swigregister(FontDialog)

def GetFontFromUser(*args, **kwargs):
    return _windows_.GetFontFromUser(*args, **kwargs)


class MessageDialog(Dialog):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.MessageDialog_swiginit(self, _windows_.new_MessageDialog(*args, **kwargs))
        self._setOORInfo(self)
        return


_windows_.MessageDialog_swigregister(MessageDialog)
PD_AUTO_HIDE = _windows_.PD_AUTO_HIDE
PD_APP_MODAL = _windows_.PD_APP_MODAL
PD_CAN_ABORT = _windows_.PD_CAN_ABORT
PD_ELAPSED_TIME = _windows_.PD_ELAPSED_TIME
PD_ESTIMATED_TIME = _windows_.PD_ESTIMATED_TIME
PD_REMAINING_TIME = _windows_.PD_REMAINING_TIME
PD_SMOOTH = _windows_.PD_SMOOTH
PD_CAN_SKIP = _windows_.PD_CAN_SKIP

class ProgressDialog(Dialog):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.ProgressDialog_swiginit(self, _windows_.new_ProgressDialog(*args, **kwargs))
        self._setOORInfo(self)
        return

    def Update(*args, **kwargs):
        return _windows_.ProgressDialog_Update(*args, **kwargs)

    def Pulse(*args, **kwargs):
        return _windows_.ProgressDialog_Pulse(*args, **kwargs)

    UpdatePulse = Pulse

    def Resume(*args, **kwargs):
        return _windows_.ProgressDialog_Resume(*args, **kwargs)


_windows_.ProgressDialog_swigregister(ProgressDialog)
FR_DOWN = _windows_.FR_DOWN
FR_WHOLEWORD = _windows_.FR_WHOLEWORD
FR_MATCHCASE = _windows_.FR_MATCHCASE
FR_REPLACEDIALOG = _windows_.FR_REPLACEDIALOG
FR_NOUPDOWN = _windows_.FR_NOUPDOWN
FR_NOMATCHCASE = _windows_.FR_NOMATCHCASE
FR_NOWHOLEWORD = _windows_.FR_NOWHOLEWORD
wxEVT_COMMAND_FIND = _windows_.wxEVT_COMMAND_FIND
wxEVT_COMMAND_FIND_NEXT = _windows_.wxEVT_COMMAND_FIND_NEXT
wxEVT_COMMAND_FIND_REPLACE = _windows_.wxEVT_COMMAND_FIND_REPLACE
wxEVT_COMMAND_FIND_REPLACE_ALL = _windows_.wxEVT_COMMAND_FIND_REPLACE_ALL
wxEVT_COMMAND_FIND_CLOSE = _windows_.wxEVT_COMMAND_FIND_CLOSE
EVT_FIND = wx.PyEventBinder(wxEVT_COMMAND_FIND, 1)
EVT_FIND_NEXT = wx.PyEventBinder(wxEVT_COMMAND_FIND_NEXT, 1)
EVT_FIND_REPLACE = wx.PyEventBinder(wxEVT_COMMAND_FIND_REPLACE, 1)
EVT_FIND_REPLACE_ALL = wx.PyEventBinder(wxEVT_COMMAND_FIND_REPLACE_ALL, 1)
EVT_FIND_CLOSE = wx.PyEventBinder(wxEVT_COMMAND_FIND_CLOSE, 1)
EVT_COMMAND_FIND = EVT_FIND
EVT_COMMAND_FIND_NEXT = EVT_FIND_NEXT
EVT_COMMAND_FIND_REPLACE = EVT_FIND_REPLACE
EVT_COMMAND_FIND_REPLACE_ALL = EVT_FIND_REPLACE_ALL
EVT_COMMAND_FIND_CLOSE = EVT_FIND_CLOSE

class FindDialogEvent(_core.CommandEvent):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.FindDialogEvent_swiginit(self, _windows_.new_FindDialogEvent(*args, **kwargs))
        return

    def GetFlags(*args, **kwargs):
        return _windows_.FindDialogEvent_GetFlags(*args, **kwargs)

    def GetFindString(*args, **kwargs):
        return _windows_.FindDialogEvent_GetFindString(*args, **kwargs)

    def GetReplaceString(*args, **kwargs):
        return _windows_.FindDialogEvent_GetReplaceString(*args, **kwargs)

    def GetDialog(*args, **kwargs):
        return _windows_.FindDialogEvent_GetDialog(*args, **kwargs)

    def SetFlags(*args, **kwargs):
        return _windows_.FindDialogEvent_SetFlags(*args, **kwargs)

    def SetFindString(*args, **kwargs):
        return _windows_.FindDialogEvent_SetFindString(*args, **kwargs)

    def SetReplaceString(*args, **kwargs):
        return _windows_.FindDialogEvent_SetReplaceString(*args, **kwargs)

    Dialog = property(GetDialog, doc='See `GetDialog`')
    FindString = property(GetFindString, SetFindString, doc='See `GetFindString` and `SetFindString`')
    Flags = property(GetFlags, SetFlags, doc='See `GetFlags` and `SetFlags`')
    ReplaceString = property(GetReplaceString, SetReplaceString, doc='See `GetReplaceString` and `SetReplaceString`')


_windows_.FindDialogEvent_swigregister(FindDialogEvent)

class FindReplaceData(_core.Object):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.FindReplaceData_swiginit(self, _windows_.new_FindReplaceData(*args, **kwargs))
        return

    __swig_destroy__ = _windows_.delete_FindReplaceData
    __del__ = lambda self: None

    def GetFindString(*args, **kwargs):
        return _windows_.FindReplaceData_GetFindString(*args, **kwargs)

    def GetReplaceString(*args, **kwargs):
        return _windows_.FindReplaceData_GetReplaceString(*args, **kwargs)

    def GetFlags(*args, **kwargs):
        return _windows_.FindReplaceData_GetFlags(*args, **kwargs)

    def SetFlags(*args, **kwargs):
        return _windows_.FindReplaceData_SetFlags(*args, **kwargs)

    def SetFindString(*args, **kwargs):
        return _windows_.FindReplaceData_SetFindString(*args, **kwargs)

    def SetReplaceString(*args, **kwargs):
        return _windows_.FindReplaceData_SetReplaceString(*args, **kwargs)

    FindString = property(GetFindString, SetFindString, doc='See `GetFindString` and `SetFindString`')
    Flags = property(GetFlags, SetFlags, doc='See `GetFlags` and `SetFlags`')
    ReplaceString = property(GetReplaceString, SetReplaceString, doc='See `GetReplaceString` and `SetReplaceString`')


_windows_.FindReplaceData_swigregister(FindReplaceData)

class FindReplaceDialog(Dialog):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.FindReplaceDialog_swiginit(self, _windows_.new_FindReplaceDialog(*args, **kwargs))
        self._setOORInfo(self)
        return

    def Create(*args, **kwargs):
        return _windows_.FindReplaceDialog_Create(*args, **kwargs)

    def GetData(*args, **kwargs):
        return _windows_.FindReplaceDialog_GetData(*args, **kwargs)

    def SetData(*args, **kwargs):
        return _windows_.FindReplaceDialog_SetData(*args, **kwargs)

    Data = property(GetData, SetData, doc='See `GetData` and `SetData`')


_windows_.FindReplaceDialog_swigregister(FindReplaceDialog)

def PreFindReplaceDialog(*args, **kwargs):
    val = _windows_.new_PreFindReplaceDialog(*args, **kwargs)
    return val


IDM_WINDOWTILE = _windows_.IDM_WINDOWTILE
IDM_WINDOWTILEHOR = _windows_.IDM_WINDOWTILEHOR
IDM_WINDOWCASCADE = _windows_.IDM_WINDOWCASCADE
IDM_WINDOWICONS = _windows_.IDM_WINDOWICONS
IDM_WINDOWNEXT = _windows_.IDM_WINDOWNEXT
IDM_WINDOWTILEVERT = _windows_.IDM_WINDOWTILEVERT
IDM_WINDOWPREV = _windows_.IDM_WINDOWPREV
FIRST_MDI_CHILD = _windows_.FIRST_MDI_CHILD
LAST_MDI_CHILD = _windows_.LAST_MDI_CHILD

class MDIParentFrame(Frame):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.MDIParentFrame_swiginit(self, _windows_.new_MDIParentFrame(*args, **kwargs))
        self._setOORInfo(self)
        return

    def Create(*args, **kwargs):
        return _windows_.MDIParentFrame_Create(*args, **kwargs)

    def ActivateNext(*args, **kwargs):
        return _windows_.MDIParentFrame_ActivateNext(*args, **kwargs)

    def ActivatePrevious(*args, **kwargs):
        return _windows_.MDIParentFrame_ActivatePrevious(*args, **kwargs)

    def ArrangeIcons(*args, **kwargs):
        return _windows_.MDIParentFrame_ArrangeIcons(*args, **kwargs)

    def Cascade(*args, **kwargs):
        return _windows_.MDIParentFrame_Cascade(*args, **kwargs)

    def GetActiveChild(*args, **kwargs):
        return _windows_.MDIParentFrame_GetActiveChild(*args, **kwargs)

    def GetClientWindow(*args, **kwargs):
        return _windows_.MDIParentFrame_GetClientWindow(*args, **kwargs)

    def GetWindowMenu(*args, **kwargs):
        return _windows_.MDIParentFrame_GetWindowMenu(*args, **kwargs)

    def SetWindowMenu(*args, **kwargs):
        return _windows_.MDIParentFrame_SetWindowMenu(*args, **kwargs)

    def Tile(*args, **kwargs):
        return _windows_.MDIParentFrame_Tile(*args, **kwargs)

    ActiveChild = property(GetActiveChild, doc='See `GetActiveChild`')
    ClientWindow = property(GetClientWindow, doc='See `GetClientWindow`')


_windows_.MDIParentFrame_swigregister(MDIParentFrame)

def PreMDIParentFrame(*args, **kwargs):
    val = _windows_.new_PreMDIParentFrame(*args, **kwargs)
    return val


class MDIChildFrame(Frame):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.MDIChildFrame_swiginit(self, _windows_.new_MDIChildFrame(*args, **kwargs))
        self._setOORInfo(self)
        return

    def Create(*args, **kwargs):
        return _windows_.MDIChildFrame_Create(*args, **kwargs)

    def Activate(*args, **kwargs):
        return _windows_.MDIChildFrame_Activate(*args, **kwargs)


_windows_.MDIChildFrame_swigregister(MDIChildFrame)

def PreMDIChildFrame(*args, **kwargs):
    val = _windows_.new_PreMDIChildFrame(*args, **kwargs)
    return val


class MDIClientWindow(_core.Window):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.MDIClientWindow_swiginit(self, _windows_.new_MDIClientWindow(*args, **kwargs))
        self._setOORInfo(self)
        return

    def Create(*args, **kwargs):
        return _windows_.MDIClientWindow_Create(*args, **kwargs)


_windows_.MDIClientWindow_swigregister(MDIClientWindow)

def PreMDIClientWindow(*args, **kwargs):
    val = _windows_.new_PreMDIClientWindow(*args, **kwargs)
    return val


class PyWindow(_core.Window):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.PyWindow_swiginit(self, _windows_.new_PyWindow(*args, **kwargs))
        self._setOORInfo(self)
        PyWindow._setCallbackInfo(self, self, PyWindow)
        return

    def _setCallbackInfo(*args, **kwargs):
        return _windows_.PyWindow__setCallbackInfo(*args, **kwargs)

    SetBestSize = wx.Window.SetInitialSize

    def DoEraseBackground(*args, **kwargs):
        return _windows_.PyWindow_DoEraseBackground(*args, **kwargs)

    def DoMoveWindow(*args, **kwargs):
        return _windows_.PyWindow_DoMoveWindow(*args, **kwargs)

    def DoSetSize(*args, **kwargs):
        return _windows_.PyWindow_DoSetSize(*args, **kwargs)

    def DoSetClientSize(*args, **kwargs):
        return _windows_.PyWindow_DoSetClientSize(*args, **kwargs)

    def DoSetVirtualSize(*args, **kwargs):
        return _windows_.PyWindow_DoSetVirtualSize(*args, **kwargs)

    def DoGetSize(*args, **kwargs):
        return _windows_.PyWindow_DoGetSize(*args, **kwargs)

    def DoGetClientSize(*args, **kwargs):
        return _windows_.PyWindow_DoGetClientSize(*args, **kwargs)

    def DoGetPosition(*args, **kwargs):
        return _windows_.PyWindow_DoGetPosition(*args, **kwargs)

    def DoGetVirtualSize(*args, **kwargs):
        return _windows_.PyWindow_DoGetVirtualSize(*args, **kwargs)

    def DoGetBestSize(*args, **kwargs):
        return _windows_.PyWindow_DoGetBestSize(*args, **kwargs)

    def GetDefaultAttributes(*args, **kwargs):
        return _windows_.PyWindow_GetDefaultAttributes(*args, **kwargs)

    def OnInternalIdle(*args, **kwargs):
        return _windows_.PyWindow_OnInternalIdle(*args, **kwargs)

    def base_DoMoveWindow(*args, **kw):
        return PyWindow.DoMoveWindow(*args, **kw)

    base_DoMoveWindow = wx._deprecated(base_DoMoveWindow, 'Please use PyWindow.DoMoveWindow instead.')

    def base_DoSetSize(*args, **kw):
        return PyWindow.DoSetSize(*args, **kw)

    base_DoSetSize = wx._deprecated(base_DoSetSize, 'Please use PyWindow.DoSetSize instead.')

    def base_DoSetClientSize(*args, **kw):
        return PyWindow.DoSetClientSize(*args, **kw)

    base_DoSetClientSize = wx._deprecated(base_DoSetClientSize, 'Please use PyWindow.DoSetClientSize instead.')

    def base_DoSetVirtualSize(*args, **kw):
        return PyWindow.DoSetVirtualSize(*args, **kw)

    base_DoSetVirtualSize = wx._deprecated(base_DoSetVirtualSize, 'Please use PyWindow.DoSetVirtualSize instead.')

    def base_DoGetSize(*args, **kw):
        return PyWindow.DoGetSize(*args, **kw)

    base_DoGetSize = wx._deprecated(base_DoGetSize, 'Please use PyWindow.DoGetSize instead.')

    def base_DoGetClientSize(*args, **kw):
        return PyWindow.DoGetClientSize(*args, **kw)

    base_DoGetClientSize = wx._deprecated(base_DoGetClientSize, 'Please use PyWindow.DoGetClientSize instead.')

    def base_DoGetPosition(*args, **kw):
        return PyWindow.DoGetPosition(*args, **kw)

    base_DoGetPosition = wx._deprecated(base_DoGetPosition, 'Please use PyWindow.DoGetPosition instead.')

    def base_DoGetVirtualSize(*args, **kw):
        return PyWindow.DoGetVirtualSize(*args, **kw)

    base_DoGetVirtualSize = wx._deprecated(base_DoGetVirtualSize, 'Please use PyWindow.DoGetVirtualSize instead.')

    def base_DoGetBestSize(*args, **kw):
        return PyWindow.DoGetBestSize(*args, **kw)

    base_DoGetBestSize = wx._deprecated(base_DoGetBestSize, 'Please use PyWindow.DoGetBestSize instead.')

    def base_InitDialog(*args, **kw):
        return PyWindow.InitDialog(*args, **kw)

    base_InitDialog = wx._deprecated(base_InitDialog, 'Please use PyWindow.InitDialog instead.')

    def base_TransferDataToWindow(*args, **kw):
        return PyWindow.TransferDataToWindow(*args, **kw)

    base_TransferDataToWindow = wx._deprecated(base_TransferDataToWindow, 'Please use PyWindow.TransferDataToWindow instead.')

    def base_TransferDataFromWindow(*args, **kw):
        return PyWindow.TransferDataFromWindow(*args, **kw)

    base_TransferDataFromWindow = wx._deprecated(base_TransferDataFromWindow, 'Please use PyWindow.TransferDataFromWindow instead.')

    def base_Validate(*args, **kw):
        return PyWindow.Validate(*args, **kw)

    base_Validate = wx._deprecated(base_Validate, 'Please use PyWindow.Validate instead.')

    def base_AcceptsFocus(*args, **kw):
        return PyWindow.AcceptsFocus(*args, **kw)

    base_AcceptsFocus = wx._deprecated(base_AcceptsFocus, 'Please use PyWindow.AcceptsFocus instead.')

    def base_AcceptsFocusFromKeyboard(*args, **kw):
        return PyWindow.AcceptsFocusFromKeyboard(*args, **kw)

    base_AcceptsFocusFromKeyboard = wx._deprecated(base_AcceptsFocusFromKeyboard, 'Please use PyWindow.AcceptsFocusFromKeyboard instead.')

    def base_GetMaxSize(*args, **kw):
        return PyWindow.GetMaxSize(*args, **kw)

    base_GetMaxSize = wx._deprecated(base_GetMaxSize, 'Please use PyWindow.GetMaxSize instead.')

    def base_Enable(*args, **kw):
        return PyWindow.Enable(*args, **kw)

    base_Enable = wx._deprecated(base_Enable, 'Please use PyWindow.Enable instead.')

    def base_AddChild(*args, **kw):
        return PyWindow.AddChild(*args, **kw)

    base_AddChild = wx._deprecated(base_AddChild, 'Please use PyWindow.AddChild instead.')

    def base_RemoveChild(*args, **kw):
        return PyWindow.RemoveChild(*args, **kw)

    base_RemoveChild = wx._deprecated(base_RemoveChild, 'Please use PyWindow.RemoveChild instead.')

    def base_ShouldInheritColours(*args, **kw):
        return PyWindow.ShouldInheritColours(*args, **kw)

    base_ShouldInheritColours = wx._deprecated(base_ShouldInheritColours, 'Please use PyWindow.ShouldInheritColours instead.')

    def base_GetDefaultAttributes(*args, **kw):
        return PyWindow.GetDefaultAttributes(*args, **kw)

    base_GetDefaultAttributes = wx._deprecated(base_GetDefaultAttributes, 'Please use PyWindow.GetDefaultAttributes instead.')

    def base_OnInternalIdle(*args, **kw):
        return PyWindow.OnInternalIdle(*args, **kw)

    base_OnInternalIdle = wx._deprecated(base_OnInternalIdle, 'Please use PyWindow.OnInternalIdle instead.')


_windows_.PyWindow_swigregister(PyWindow)

def PrePyWindow(*args, **kwargs):
    val = _windows_.new_PrePyWindow(*args, **kwargs)
    return val


class PyPanel(Panel):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.PyPanel_swiginit(self, _windows_.new_PyPanel(*args, **kwargs))
        self._setOORInfo(self)
        PyPanel._setCallbackInfo(self, self, PyPanel)
        return

    def _setCallbackInfo(*args, **kwargs):
        return _windows_.PyPanel__setCallbackInfo(*args, **kwargs)

    SetBestSize = wx.Window.SetInitialSize

    def DoEraseBackground(*args, **kwargs):
        return _windows_.PyPanel_DoEraseBackground(*args, **kwargs)

    def DoMoveWindow(*args, **kwargs):
        return _windows_.PyPanel_DoMoveWindow(*args, **kwargs)

    def DoSetSize(*args, **kwargs):
        return _windows_.PyPanel_DoSetSize(*args, **kwargs)

    def DoSetClientSize(*args, **kwargs):
        return _windows_.PyPanel_DoSetClientSize(*args, **kwargs)

    def DoSetVirtualSize(*args, **kwargs):
        return _windows_.PyPanel_DoSetVirtualSize(*args, **kwargs)

    def DoGetSize(*args, **kwargs):
        return _windows_.PyPanel_DoGetSize(*args, **kwargs)

    def DoGetClientSize(*args, **kwargs):
        return _windows_.PyPanel_DoGetClientSize(*args, **kwargs)

    def DoGetPosition(*args, **kwargs):
        return _windows_.PyPanel_DoGetPosition(*args, **kwargs)

    def DoGetVirtualSize(*args, **kwargs):
        return _windows_.PyPanel_DoGetVirtualSize(*args, **kwargs)

    def DoGetBestSize(*args, **kwargs):
        return _windows_.PyPanel_DoGetBestSize(*args, **kwargs)

    def GetDefaultAttributes(*args, **kwargs):
        return _windows_.PyPanel_GetDefaultAttributes(*args, **kwargs)

    def OnInternalIdle(*args, **kwargs):
        return _windows_.PyPanel_OnInternalIdle(*args, **kwargs)

    def base_DoMoveWindow(*args, **kw):
        return PyPanel.DoMoveWindow(*args, **kw)

    base_DoMoveWindow = wx._deprecated(base_DoMoveWindow, 'Please use PyPanel.DoMoveWindow instead.')

    def base_DoSetSize(*args, **kw):
        return PyPanel.DoSetSize(*args, **kw)

    base_DoSetSize = wx._deprecated(base_DoSetSize, 'Please use PyPanel.DoSetSize instead.')

    def base_DoSetClientSize(*args, **kw):
        return PyPanel.DoSetClientSize(*args, **kw)

    base_DoSetClientSize = wx._deprecated(base_DoSetClientSize, 'Please use PyPanel.DoSetClientSize instead.')

    def base_DoSetVirtualSize(*args, **kw):
        return PyPanel.DoSetVirtualSize(*args, **kw)

    base_DoSetVirtualSize = wx._deprecated(base_DoSetVirtualSize, 'Please use PyPanel.DoSetVirtualSize instead.')

    def base_DoGetSize(*args, **kw):
        return PyPanel.DoGetSize(*args, **kw)

    base_DoGetSize = wx._deprecated(base_DoGetSize, 'Please use PyPanel.DoGetSize instead.')

    def base_DoGetClientSize(*args, **kw):
        return PyPanel.DoGetClientSize(*args, **kw)

    base_DoGetClientSize = wx._deprecated(base_DoGetClientSize, 'Please use PyPanel.DoGetClientSize instead.')

    def base_DoGetPosition(*args, **kw):
        return PyPanel.DoGetPosition(*args, **kw)

    base_DoGetPosition = wx._deprecated(base_DoGetPosition, 'Please use PyPanel.DoGetPosition instead.')

    def base_DoGetVirtualSize(*args, **kw):
        return PyPanel.DoGetVirtualSize(*args, **kw)

    base_DoGetVirtualSize = wx._deprecated(base_DoGetVirtualSize, 'Please use PyPanel.DoGetVirtualSize instead.')

    def base_DoGetBestSize(*args, **kw):
        return PyPanel.DoGetBestSize(*args, **kw)

    base_DoGetBestSize = wx._deprecated(base_DoGetBestSize, 'Please use PyPanel.DoGetBestSize instead.')

    def base_InitDialog(*args, **kw):
        return PyPanel.InitDialog(*args, **kw)

    base_InitDialog = wx._deprecated(base_InitDialog, 'Please use PyPanel.InitDialog instead.')

    def base_TransferDataToWindow(*args, **kw):
        return PyPanel.TransferDataToWindow(*args, **kw)

    base_TransferDataToWindow = wx._deprecated(base_TransferDataToWindow, 'Please use PyPanel.TransferDataToWindow instead.')

    def base_TransferDataFromWindow(*args, **kw):
        return PyPanel.TransferDataFromWindow(*args, **kw)

    base_TransferDataFromWindow = wx._deprecated(base_TransferDataFromWindow, 'Please use PyPanel.TransferDataFromWindow instead.')

    def base_Validate(*args, **kw):
        return PyPanel.Validate(*args, **kw)

    base_Validate = wx._deprecated(base_Validate, 'Please use PyPanel.Validate instead.')

    def base_AcceptsFocus(*args, **kw):
        return PyPanel.AcceptsFocus(*args, **kw)

    base_AcceptsFocus = wx._deprecated(base_AcceptsFocus, 'Please use PyPanel.AcceptsFocus instead.')

    def base_AcceptsFocusFromKeyboard(*args, **kw):
        return PyPanel.AcceptsFocusFromKeyboard(*args, **kw)

    base_AcceptsFocusFromKeyboard = wx._deprecated(base_AcceptsFocusFromKeyboard, 'Please use PyPanel.AcceptsFocusFromKeyboard instead.')

    def base_GetMaxSize(*args, **kw):
        return PyPanel.GetMaxSize(*args, **kw)

    base_GetMaxSize = wx._deprecated(base_GetMaxSize, 'Please use PyPanel.GetMaxSize instead.')

    def base_Enable(*args, **kw):
        return PyPanel.Enable(*args, **kw)

    base_Enable = wx._deprecated(base_Enable, 'Please use PyPanel.Enable instead.')

    def base_AddChild(*args, **kw):
        return PyPanel.AddChild(*args, **kw)

    base_AddChild = wx._deprecated(base_AddChild, 'Please use PyPanel.AddChild instead.')

    def base_RemoveChild(*args, **kw):
        return PyPanel.RemoveChild(*args, **kw)

    base_RemoveChild = wx._deprecated(base_RemoveChild, 'Please use PyPanel.RemoveChild instead.')

    def base_ShouldInheritColours(*args, **kw):
        return PyPanel.ShouldInheritColours(*args, **kw)

    base_ShouldInheritColours = wx._deprecated(base_ShouldInheritColours, 'Please use PyPanel.ShouldInheritColours instead.')

    def base_GetDefaultAttributes(*args, **kw):
        return PyPanel.GetDefaultAttributes(*args, **kw)

    base_GetDefaultAttributes = wx._deprecated(base_GetDefaultAttributes, 'Please use PyPanel.GetDefaultAttributes instead.')

    def base_OnInternalIdle(*args, **kw):
        return PyPanel.OnInternalIdle(*args, **kw)

    base_OnInternalIdle = wx._deprecated(base_OnInternalIdle, 'Please use PyPanel.OnInternalIdle instead.')


_windows_.PyPanel_swigregister(PyPanel)

def PrePyPanel(*args, **kwargs):
    val = _windows_.new_PrePyPanel(*args, **kwargs)
    return val


class PyScrolledWindow(ScrolledWindow):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.PyScrolledWindow_swiginit(self, _windows_.new_PyScrolledWindow(*args, **kwargs))
        self._setOORInfo(self)
        PyScrolledWindow._setCallbackInfo(self, self, PyScrolledWindow)
        return

    def _setCallbackInfo(*args, **kwargs):
        return _windows_.PyScrolledWindow__setCallbackInfo(*args, **kwargs)

    SetBestSize = wx.Window.SetInitialSize

    def DoEraseBackground(*args, **kwargs):
        return _windows_.PyScrolledWindow_DoEraseBackground(*args, **kwargs)

    def DoMoveWindow(*args, **kwargs):
        return _windows_.PyScrolledWindow_DoMoveWindow(*args, **kwargs)

    def DoSetSize(*args, **kwargs):
        return _windows_.PyScrolledWindow_DoSetSize(*args, **kwargs)

    def DoSetClientSize(*args, **kwargs):
        return _windows_.PyScrolledWindow_DoSetClientSize(*args, **kwargs)

    def DoSetVirtualSize(*args, **kwargs):
        return _windows_.PyScrolledWindow_DoSetVirtualSize(*args, **kwargs)

    def DoGetSize(*args, **kwargs):
        return _windows_.PyScrolledWindow_DoGetSize(*args, **kwargs)

    def DoGetClientSize(*args, **kwargs):
        return _windows_.PyScrolledWindow_DoGetClientSize(*args, **kwargs)

    def DoGetPosition(*args, **kwargs):
        return _windows_.PyScrolledWindow_DoGetPosition(*args, **kwargs)

    def DoGetVirtualSize(*args, **kwargs):
        return _windows_.PyScrolledWindow_DoGetVirtualSize(*args, **kwargs)

    def DoGetBestSize(*args, **kwargs):
        return _windows_.PyScrolledWindow_DoGetBestSize(*args, **kwargs)

    def GetDefaultAttributes(*args, **kwargs):
        return _windows_.PyScrolledWindow_GetDefaultAttributes(*args, **kwargs)

    def OnInternalIdle(*args, **kwargs):
        return _windows_.PyScrolledWindow_OnInternalIdle(*args, **kwargs)

    def base_DoMoveWindow(*args, **kw):
        return PyScrolledWindow.DoMoveWindow(*args, **kw)

    base_DoMoveWindow = wx._deprecated(base_DoMoveWindow, 'Please use PyScrolledWindow.DoMoveWindow instead.')

    def base_DoSetSize(*args, **kw):
        return PyScrolledWindow.DoSetSize(*args, **kw)

    base_DoSetSize = wx._deprecated(base_DoSetSize, 'Please use PyScrolledWindow.DoSetSize instead.')

    def base_DoSetClientSize(*args, **kw):
        return PyScrolledWindow.DoSetClientSize(*args, **kw)

    base_DoSetClientSize = wx._deprecated(base_DoSetClientSize, 'Please use PyScrolledWindow.DoSetClientSize instead.')

    def base_DoSetVirtualSize(*args, **kw):
        return PyScrolledWindow.DoSetVirtualSize(*args, **kw)

    base_DoSetVirtualSize = wx._deprecated(base_DoSetVirtualSize, 'Please use PyScrolledWindow.DoSetVirtualSize instead.')

    def base_DoGetSize(*args, **kw):
        return PyScrolledWindow.DoGetSize(*args, **kw)

    base_DoGetSize = wx._deprecated(base_DoGetSize, 'Please use PyScrolledWindow.DoGetSize instead.')

    def base_DoGetClientSize(*args, **kw):
        return PyScrolledWindow.DoGetClientSize(*args, **kw)

    base_DoGetClientSize = wx._deprecated(base_DoGetClientSize, 'Please use PyScrolledWindow.DoGetClientSize instead.')

    def base_DoGetPosition(*args, **kw):
        return PyScrolledWindow.DoGetPosition(*args, **kw)

    base_DoGetPosition = wx._deprecated(base_DoGetPosition, 'Please use PyScrolledWindow.DoGetPosition instead.')

    def base_DoGetVirtualSize(*args, **kw):
        return PyScrolledWindow.DoGetVirtualSize(*args, **kw)

    base_DoGetVirtualSize = wx._deprecated(base_DoGetVirtualSize, 'Please use PyScrolledWindow.DoGetVirtualSize instead.')

    def base_DoGetBestSize(*args, **kw):
        return PyScrolledWindow.DoGetBestSize(*args, **kw)

    base_DoGetBestSize = wx._deprecated(base_DoGetBestSize, 'Please use PyScrolledWindow.DoGetBestSize instead.')

    def base_InitDialog(*args, **kw):
        return PyScrolledWindow.InitDialog(*args, **kw)

    base_InitDialog = wx._deprecated(base_InitDialog, 'Please use PyScrolledWindow.InitDialog instead.')

    def base_TransferDataToWindow(*args, **kw):
        return PyScrolledWindow.TransferDataToWindow(*args, **kw)

    base_TransferDataToWindow = wx._deprecated(base_TransferDataToWindow, 'Please use PyScrolledWindow.TransferDataToWindow instead.')

    def base_TransferDataFromWindow(*args, **kw):
        return PyScrolledWindow.TransferDataFromWindow(*args, **kw)

    base_TransferDataFromWindow = wx._deprecated(base_TransferDataFromWindow, 'Please use PyScrolledWindow.TransferDataFromWindow instead.')

    def base_Validate(*args, **kw):
        return PyScrolledWindow.Validate(*args, **kw)

    base_Validate = wx._deprecated(base_Validate, 'Please use PyScrolledWindow.Validate instead.')

    def base_AcceptsFocus(*args, **kw):
        return PyScrolledWindow.AcceptsFocus(*args, **kw)

    base_AcceptsFocus = wx._deprecated(base_AcceptsFocus, 'Please use PyScrolledWindow.AcceptsFocus instead.')

    def base_AcceptsFocusFromKeyboard(*args, **kw):
        return PyScrolledWindow.AcceptsFocusFromKeyboard(*args, **kw)

    base_AcceptsFocusFromKeyboard = wx._deprecated(base_AcceptsFocusFromKeyboard, 'Please use PyScrolledWindow.AcceptsFocusFromKeyboard instead.')

    def base_GetMaxSize(*args, **kw):
        return PyScrolledWindow.GetMaxSize(*args, **kw)

    base_GetMaxSize = wx._deprecated(base_GetMaxSize, 'Please use PyScrolledWindow.GetMaxSize instead.')

    def base_Enable(*args, **kw):
        return PyScrolledWindow.Enable(*args, **kw)

    base_Enable = wx._deprecated(base_Enable, 'Please use PyScrolledWindow.Enable instead.')

    def base_AddChild(*args, **kw):
        return PyScrolledWindow.AddChild(*args, **kw)

    base_AddChild = wx._deprecated(base_AddChild, 'Please use PyScrolledWindow.AddChild instead.')

    def base_RemoveChild(*args, **kw):
        return PyScrolledWindow.RemoveChild(*args, **kw)

    base_RemoveChild = wx._deprecated(base_RemoveChild, 'Please use PyScrolledWindow.RemoveChild instead.')

    def base_ShouldInheritColours(*args, **kw):
        return PyScrolledWindow.ShouldInheritColours(*args, **kw)

    base_ShouldInheritColours = wx._deprecated(base_ShouldInheritColours, 'Please use PyScrolledWindow.ShouldInheritColours instead.')

    def base_GetDefaultAttributes(*args, **kw):
        return PyScrolledWindow.GetDefaultAttributes(*args, **kw)

    base_GetDefaultAttributes = wx._deprecated(base_GetDefaultAttributes, 'Please use PyScrolledWindow.GetDefaultAttributes instead.')

    def base_OnInternalIdle(*args, **kw):
        return PyScrolledWindow.OnInternalIdle(*args, **kw)

    base_OnInternalIdle = wx._deprecated(base_OnInternalIdle, 'Please use PyScrolledWindow.OnInternalIdle instead.')


_windows_.PyScrolledWindow_swigregister(PyScrolledWindow)

def PrePyScrolledWindow(*args, **kwargs):
    val = _windows_.new_PrePyScrolledWindow(*args, **kwargs)
    return val


PRINT_MODE_NONE = _windows_.PRINT_MODE_NONE
PRINT_MODE_PREVIEW = _windows_.PRINT_MODE_PREVIEW
PRINT_MODE_FILE = _windows_.PRINT_MODE_FILE
PRINT_MODE_PRINTER = _windows_.PRINT_MODE_PRINTER
PRINT_MODE_STREAM = _windows_.PRINT_MODE_STREAM
PRINTBIN_DEFAULT = _windows_.PRINTBIN_DEFAULT
PRINTBIN_ONLYONE = _windows_.PRINTBIN_ONLYONE
PRINTBIN_LOWER = _windows_.PRINTBIN_LOWER
PRINTBIN_MIDDLE = _windows_.PRINTBIN_MIDDLE
PRINTBIN_MANUAL = _windows_.PRINTBIN_MANUAL
PRINTBIN_ENVELOPE = _windows_.PRINTBIN_ENVELOPE
PRINTBIN_ENVMANUAL = _windows_.PRINTBIN_ENVMANUAL
PRINTBIN_AUTO = _windows_.PRINTBIN_AUTO
PRINTBIN_TRACTOR = _windows_.PRINTBIN_TRACTOR
PRINTBIN_SMALLFMT = _windows_.PRINTBIN_SMALLFMT
PRINTBIN_LARGEFMT = _windows_.PRINTBIN_LARGEFMT
PRINTBIN_LARGECAPACITY = _windows_.PRINTBIN_LARGECAPACITY
PRINTBIN_CASSETTE = _windows_.PRINTBIN_CASSETTE
PRINTBIN_FORMSOURCE = _windows_.PRINTBIN_FORMSOURCE
PRINTBIN_USER = _windows_.PRINTBIN_USER

class PrintData(_core.Object):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args):
        _windows_.PrintData_swiginit(self, _windows_.new_PrintData(*args))
        return

    __swig_destroy__ = _windows_.delete_PrintData
    __del__ = lambda self: None

    def GetNoCopies(*args, **kwargs):
        return _windows_.PrintData_GetNoCopies(*args, **kwargs)

    def GetCollate(*args, **kwargs):
        return _windows_.PrintData_GetCollate(*args, **kwargs)

    def GetOrientation(*args, **kwargs):
        return _windows_.PrintData_GetOrientation(*args, **kwargs)

    def IsOrientationReversed(*args, **kwargs):
        return _windows_.PrintData_IsOrientationReversed(*args, **kwargs)

    def IsOk(*args, **kwargs):
        return _windows_.PrintData_IsOk(*args, **kwargs)

    Ok = IsOk

    def GetPrinterName(*args, **kwargs):
        return _windows_.PrintData_GetPrinterName(*args, **kwargs)

    def GetColour(*args, **kwargs):
        return _windows_.PrintData_GetColour(*args, **kwargs)

    def GetDuplex(*args, **kwargs):
        return _windows_.PrintData_GetDuplex(*args, **kwargs)

    def GetPaperId(*args, **kwargs):
        return _windows_.PrintData_GetPaperId(*args, **kwargs)

    def GetPaperSize(*args, **kwargs):
        return _windows_.PrintData_GetPaperSize(*args, **kwargs)

    def GetQuality(*args, **kwargs):
        return _windows_.PrintData_GetQuality(*args, **kwargs)

    def GetBin(*args, **kwargs):
        return _windows_.PrintData_GetBin(*args, **kwargs)

    def GetPrintMode(*args, **kwargs):
        return _windows_.PrintData_GetPrintMode(*args, **kwargs)

    def GetMedia(*args, **kwargs):
        return _windows_.PrintData_GetMedia(*args, **kwargs)

    def SetNoCopies(*args, **kwargs):
        return _windows_.PrintData_SetNoCopies(*args, **kwargs)

    def SetCollate(*args, **kwargs):
        return _windows_.PrintData_SetCollate(*args, **kwargs)

    def SetOrientation(*args, **kwargs):
        return _windows_.PrintData_SetOrientation(*args, **kwargs)

    def SetOrientationReversed(*args, **kwargs):
        return _windows_.PrintData_SetOrientationReversed(*args, **kwargs)

    def SetPrinterName(*args, **kwargs):
        return _windows_.PrintData_SetPrinterName(*args, **kwargs)

    def SetColour(*args, **kwargs):
        return _windows_.PrintData_SetColour(*args, **kwargs)

    def SetDuplex(*args, **kwargs):
        return _windows_.PrintData_SetDuplex(*args, **kwargs)

    def SetPaperId(*args, **kwargs):
        return _windows_.PrintData_SetPaperId(*args, **kwargs)

    def SetPaperSize(*args, **kwargs):
        return _windows_.PrintData_SetPaperSize(*args, **kwargs)

    def SetQuality(*args, **kwargs):
        return _windows_.PrintData_SetQuality(*args, **kwargs)

    def SetBin(*args, **kwargs):
        return _windows_.PrintData_SetBin(*args, **kwargs)

    def SetPrintMode(*args, **kwargs):
        return _windows_.PrintData_SetPrintMode(*args, **kwargs)

    def SetMedia(*args, **kwargs):
        return _windows_.PrintData_SetMedia(*args, **kwargs)

    def GetFilename(*args, **kwargs):
        return _windows_.PrintData_GetFilename(*args, **kwargs)

    def SetFilename(*args, **kwargs):
        return _windows_.PrintData_SetFilename(*args, **kwargs)

    def __nonzero__(self):
        return self.IsOk()

    def GetPrivData(*args, **kwargs):
        return _windows_.PrintData_GetPrivData(*args, **kwargs)

    def SetPrivData(*args, **kwargs):
        return _windows_.PrintData_SetPrivData(*args, **kwargs)

    Bin = property(GetBin, SetBin, doc='See `GetBin` and `SetBin`')
    Collate = property(GetCollate, SetCollate, doc='See `GetCollate` and `SetCollate`')
    Colour = property(GetColour, SetColour, doc='See `GetColour` and `SetColour`')
    Duplex = property(GetDuplex, SetDuplex, doc='See `GetDuplex` and `SetDuplex`')
    Filename = property(GetFilename, SetFilename, doc='See `GetFilename` and `SetFilename`')
    NoCopies = property(GetNoCopies, SetNoCopies, doc='See `GetNoCopies` and `SetNoCopies`')
    Orientation = property(GetOrientation, SetOrientation, doc='See `GetOrientation` and `SetOrientation`')
    PaperId = property(GetPaperId, SetPaperId, doc='See `GetPaperId` and `SetPaperId`')
    PaperSize = property(GetPaperSize, SetPaperSize, doc='See `GetPaperSize` and `SetPaperSize`')
    PrintMode = property(GetPrintMode, SetPrintMode, doc='See `GetPrintMode` and `SetPrintMode`')
    PrinterName = property(GetPrinterName, SetPrinterName, doc='See `GetPrinterName` and `SetPrinterName`')
    PrivData = property(GetPrivData, SetPrivData, doc='See `GetPrivData` and `SetPrivData`')
    Quality = property(GetQuality, SetQuality, doc='See `GetQuality` and `SetQuality`')


_windows_.PrintData_swigregister(PrintData)
PrintoutTitleStr = cvar.PrintoutTitleStr
PreviewCanvasNameStr = cvar.PreviewCanvasNameStr

class PageSetupDialogData(_core.Object):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args):
        _windows_.PageSetupDialogData_swiginit(self, _windows_.new_PageSetupDialogData(*args))
        return

    __swig_destroy__ = _windows_.delete_PageSetupDialogData
    __del__ = lambda self: None

    def EnableHelp(*args, **kwargs):
        return _windows_.PageSetupDialogData_EnableHelp(*args, **kwargs)

    def EnableMargins(*args, **kwargs):
        return _windows_.PageSetupDialogData_EnableMargins(*args, **kwargs)

    def EnableOrientation(*args, **kwargs):
        return _windows_.PageSetupDialogData_EnableOrientation(*args, **kwargs)

    def EnablePaper(*args, **kwargs):
        return _windows_.PageSetupDialogData_EnablePaper(*args, **kwargs)

    def EnablePrinter(*args, **kwargs):
        return _windows_.PageSetupDialogData_EnablePrinter(*args, **kwargs)

    def GetDefaultMinMargins(*args, **kwargs):
        return _windows_.PageSetupDialogData_GetDefaultMinMargins(*args, **kwargs)

    def GetEnableMargins(*args, **kwargs):
        return _windows_.PageSetupDialogData_GetEnableMargins(*args, **kwargs)

    def GetEnableOrientation(*args, **kwargs):
        return _windows_.PageSetupDialogData_GetEnableOrientation(*args, **kwargs)

    def GetEnablePaper(*args, **kwargs):
        return _windows_.PageSetupDialogData_GetEnablePaper(*args, **kwargs)

    def GetEnablePrinter(*args, **kwargs):
        return _windows_.PageSetupDialogData_GetEnablePrinter(*args, **kwargs)

    def GetEnableHelp(*args, **kwargs):
        return _windows_.PageSetupDialogData_GetEnableHelp(*args, **kwargs)

    def GetDefaultInfo(*args, **kwargs):
        return _windows_.PageSetupDialogData_GetDefaultInfo(*args, **kwargs)

    def GetMarginTopLeft(*args, **kwargs):
        return _windows_.PageSetupDialogData_GetMarginTopLeft(*args, **kwargs)

    def GetMarginBottomRight(*args, **kwargs):
        return _windows_.PageSetupDialogData_GetMarginBottomRight(*args, **kwargs)

    def GetMinMarginTopLeft(*args, **kwargs):
        return _windows_.PageSetupDialogData_GetMinMarginTopLeft(*args, **kwargs)

    def GetMinMarginBottomRight(*args, **kwargs):
        return _windows_.PageSetupDialogData_GetMinMarginBottomRight(*args, **kwargs)

    def GetPaperId(*args, **kwargs):
        return _windows_.PageSetupDialogData_GetPaperId(*args, **kwargs)

    def GetPaperSize(*args, **kwargs):
        return _windows_.PageSetupDialogData_GetPaperSize(*args, **kwargs)

    def GetPrintData(*args, **kwargs):
        return _windows_.PageSetupDialogData_GetPrintData(*args, **kwargs)

    def IsOk(*args, **kwargs):
        return _windows_.PageSetupDialogData_IsOk(*args, **kwargs)

    Ok = IsOk

    def SetDefaultInfo(*args, **kwargs):
        return _windows_.PageSetupDialogData_SetDefaultInfo(*args, **kwargs)

    def SetDefaultMinMargins(*args, **kwargs):
        return _windows_.PageSetupDialogData_SetDefaultMinMargins(*args, **kwargs)

    def SetMarginTopLeft(*args, **kwargs):
        return _windows_.PageSetupDialogData_SetMarginTopLeft(*args, **kwargs)

    def SetMarginBottomRight(*args, **kwargs):
        return _windows_.PageSetupDialogData_SetMarginBottomRight(*args, **kwargs)

    def SetMinMarginTopLeft(*args, **kwargs):
        return _windows_.PageSetupDialogData_SetMinMarginTopLeft(*args, **kwargs)

    def SetMinMarginBottomRight(*args, **kwargs):
        return _windows_.PageSetupDialogData_SetMinMarginBottomRight(*args, **kwargs)

    def SetPaperId(*args, **kwargs):
        return _windows_.PageSetupDialogData_SetPaperId(*args, **kwargs)

    def SetPaperSize(*args, **kwargs):
        return _windows_.PageSetupDialogData_SetPaperSize(*args, **kwargs)

    def SetPrintData(*args, **kwargs):
        return _windows_.PageSetupDialogData_SetPrintData(*args, **kwargs)

    def CalculateIdFromPaperSize(*args, **kwargs):
        return _windows_.PageSetupDialogData_CalculateIdFromPaperSize(*args, **kwargs)

    def CalculatePaperSizeFromId(*args, **kwargs):
        return _windows_.PageSetupDialogData_CalculatePaperSizeFromId(*args, **kwargs)

    def __nonzero__(self):
        return self.IsOk()

    DefaultInfo = property(GetDefaultInfo, SetDefaultInfo, doc='See `GetDefaultInfo` and `SetDefaultInfo`')
    DefaultMinMargins = property(GetDefaultMinMargins, SetDefaultMinMargins, doc='See `GetDefaultMinMargins` and `SetDefaultMinMargins`')
    MarginBottomRight = property(GetMarginBottomRight, SetMarginBottomRight, doc='See `GetMarginBottomRight` and `SetMarginBottomRight`')
    MarginTopLeft = property(GetMarginTopLeft, SetMarginTopLeft, doc='See `GetMarginTopLeft` and `SetMarginTopLeft`')
    MinMarginBottomRight = property(GetMinMarginBottomRight, SetMinMarginBottomRight, doc='See `GetMinMarginBottomRight` and `SetMinMarginBottomRight`')
    MinMarginTopLeft = property(GetMinMarginTopLeft, SetMinMarginTopLeft, doc='See `GetMinMarginTopLeft` and `SetMinMarginTopLeft`')
    PaperId = property(GetPaperId, SetPaperId, doc='See `GetPaperId` and `SetPaperId`')
    PaperSize = property(GetPaperSize, SetPaperSize, doc='See `GetPaperSize` and `SetPaperSize`')
    PrintData = property(GetPrintData, SetPrintData, doc='See `GetPrintData` and `SetPrintData`')


_windows_.PageSetupDialogData_swigregister(PageSetupDialogData)

class PageSetupDialog(_core.Object):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.PageSetupDialog_swiginit(self, _windows_.new_PageSetupDialog(*args, **kwargs))
        return

    __swig_destroy__ = _windows_.delete_PageSetupDialog
    __del__ = lambda self: None

    def GetPageSetupData(*args, **kwargs):
        return _windows_.PageSetupDialog_GetPageSetupData(*args, **kwargs)

    def GetPageSetupDialogData(*args, **kwargs):
        return _windows_.PageSetupDialog_GetPageSetupDialogData(*args, **kwargs)

    def ShowModal(*args, **kwargs):
        return _windows_.PageSetupDialog_ShowModal(*args, **kwargs)

    def Destroy(self):
        return

    PageSetupData = property(GetPageSetupData, doc='See `GetPageSetupData`')
    PageSetupDialogData = property(GetPageSetupDialogData, doc='See `GetPageSetupDialogData`')


_windows_.PageSetupDialog_swigregister(PageSetupDialog)

class PrintDialogData(_core.Object):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args):
        _windows_.PrintDialogData_swiginit(self, _windows_.new_PrintDialogData(*args))
        return

    __swig_destroy__ = _windows_.delete_PrintDialogData
    __del__ = lambda self: None

    def GetFromPage(*args, **kwargs):
        return _windows_.PrintDialogData_GetFromPage(*args, **kwargs)

    def GetToPage(*args, **kwargs):
        return _windows_.PrintDialogData_GetToPage(*args, **kwargs)

    def GetMinPage(*args, **kwargs):
        return _windows_.PrintDialogData_GetMinPage(*args, **kwargs)

    def GetMaxPage(*args, **kwargs):
        return _windows_.PrintDialogData_GetMaxPage(*args, **kwargs)

    def GetNoCopies(*args, **kwargs):
        return _windows_.PrintDialogData_GetNoCopies(*args, **kwargs)

    def GetAllPages(*args, **kwargs):
        return _windows_.PrintDialogData_GetAllPages(*args, **kwargs)

    def GetSelection(*args, **kwargs):
        return _windows_.PrintDialogData_GetSelection(*args, **kwargs)

    def GetCollate(*args, **kwargs):
        return _windows_.PrintDialogData_GetCollate(*args, **kwargs)

    def GetPrintToFile(*args, **kwargs):
        return _windows_.PrintDialogData_GetPrintToFile(*args, **kwargs)

    def SetFromPage(*args, **kwargs):
        return _windows_.PrintDialogData_SetFromPage(*args, **kwargs)

    def SetToPage(*args, **kwargs):
        return _windows_.PrintDialogData_SetToPage(*args, **kwargs)

    def SetMinPage(*args, **kwargs):
        return _windows_.PrintDialogData_SetMinPage(*args, **kwargs)

    def SetMaxPage(*args, **kwargs):
        return _windows_.PrintDialogData_SetMaxPage(*args, **kwargs)

    def SetNoCopies(*args, **kwargs):
        return _windows_.PrintDialogData_SetNoCopies(*args, **kwargs)

    def SetAllPages(*args, **kwargs):
        return _windows_.PrintDialogData_SetAllPages(*args, **kwargs)

    def SetSelection(*args, **kwargs):
        return _windows_.PrintDialogData_SetSelection(*args, **kwargs)

    def SetCollate(*args, **kwargs):
        return _windows_.PrintDialogData_SetCollate(*args, **kwargs)

    def SetPrintToFile(*args, **kwargs):
        return _windows_.PrintDialogData_SetPrintToFile(*args, **kwargs)

    def EnablePrintToFile(*args, **kwargs):
        return _windows_.PrintDialogData_EnablePrintToFile(*args, **kwargs)

    def EnableSelection(*args, **kwargs):
        return _windows_.PrintDialogData_EnableSelection(*args, **kwargs)

    def EnablePageNumbers(*args, **kwargs):
        return _windows_.PrintDialogData_EnablePageNumbers(*args, **kwargs)

    def EnableHelp(*args, **kwargs):
        return _windows_.PrintDialogData_EnableHelp(*args, **kwargs)

    def GetEnablePrintToFile(*args, **kwargs):
        return _windows_.PrintDialogData_GetEnablePrintToFile(*args, **kwargs)

    def GetEnableSelection(*args, **kwargs):
        return _windows_.PrintDialogData_GetEnableSelection(*args, **kwargs)

    def GetEnablePageNumbers(*args, **kwargs):
        return _windows_.PrintDialogData_GetEnablePageNumbers(*args, **kwargs)

    def GetEnableHelp(*args, **kwargs):
        return _windows_.PrintDialogData_GetEnableHelp(*args, **kwargs)

    def IsOk(*args, **kwargs):
        return _windows_.PrintDialogData_IsOk(*args, **kwargs)

    Ok = IsOk

    def GetPrintData(*args, **kwargs):
        return _windows_.PrintDialogData_GetPrintData(*args, **kwargs)

    def SetPrintData(*args, **kwargs):
        return _windows_.PrintDialogData_SetPrintData(*args, **kwargs)

    def __nonzero__(self):
        return self.IsOk()

    AllPages = property(GetAllPages, SetAllPages, doc='See `GetAllPages` and `SetAllPages`')
    Collate = property(GetCollate, SetCollate, doc='See `GetCollate` and `SetCollate`')
    FromPage = property(GetFromPage, SetFromPage, doc='See `GetFromPage` and `SetFromPage`')
    MaxPage = property(GetMaxPage, SetMaxPage, doc='See `GetMaxPage` and `SetMaxPage`')
    MinPage = property(GetMinPage, SetMinPage, doc='See `GetMinPage` and `SetMinPage`')
    NoCopies = property(GetNoCopies, SetNoCopies, doc='See `GetNoCopies` and `SetNoCopies`')
    PrintData = property(GetPrintData, SetPrintData, doc='See `GetPrintData` and `SetPrintData`')
    PrintToFile = property(GetPrintToFile, SetPrintToFile, doc='See `GetPrintToFile` and `SetPrintToFile`')
    Selection = property(GetSelection, SetSelection, doc='See `GetSelection` and `SetSelection`')
    ToPage = property(GetToPage, SetToPage, doc='See `GetToPage` and `SetToPage`')


_windows_.PrintDialogData_swigregister(PrintDialogData)

class PrintDialog(_core.Object):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.PrintDialog_swiginit(self, _windows_.new_PrintDialog(*args, **kwargs))
        return

    __swig_destroy__ = _windows_.delete_PrintDialog
    __del__ = lambda self: None

    def ShowModal(*args, **kwargs):
        return _windows_.PrintDialog_ShowModal(*args, **kwargs)

    def GetPrintDialogData(*args, **kwargs):
        return _windows_.PrintDialog_GetPrintDialogData(*args, **kwargs)

    def GetPrintData(*args, **kwargs):
        return _windows_.PrintDialog_GetPrintData(*args, **kwargs)

    def GetPrintDC(*args, **kwargs):
        return _windows_.PrintDialog_GetPrintDC(*args, **kwargs)

    def Destroy(self):
        return

    PrintDC = property(GetPrintDC, doc='See `GetPrintDC`')
    PrintData = property(GetPrintData, doc='See `GetPrintData`')
    PrintDialogData = property(GetPrintDialogData, doc='See `GetPrintDialogData`')


_windows_.PrintDialog_swigregister(PrintDialog)
PRINTER_NO_ERROR = _windows_.PRINTER_NO_ERROR
PRINTER_CANCELLED = _windows_.PRINTER_CANCELLED
PRINTER_ERROR = _windows_.PRINTER_ERROR

class Printer(_core.Object):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.Printer_swiginit(self, _windows_.new_Printer(*args, **kwargs))
        return

    __swig_destroy__ = _windows_.delete_Printer
    __del__ = lambda self: None

    def CreateAbortWindow(*args, **kwargs):
        return _windows_.Printer_CreateAbortWindow(*args, **kwargs)

    def ReportError(*args, **kwargs):
        return _windows_.Printer_ReportError(*args, **kwargs)

    def Setup(*args, **kwargs):
        return _windows_.Printer_Setup(*args, **kwargs)

    def Print(*args, **kwargs):
        return _windows_.Printer_Print(*args, **kwargs)

    def PrintDialog(*args, **kwargs):
        return _windows_.Printer_PrintDialog(*args, **kwargs)

    def GetPrintDialogData(*args, **kwargs):
        return _windows_.Printer_GetPrintDialogData(*args, **kwargs)

    def GetAbort(*args, **kwargs):
        return _windows_.Printer_GetAbort(*args, **kwargs)

    def GetLastError(*args, **kwargs):
        return _windows_.Printer_GetLastError(*args, **kwargs)

    GetLastError = staticmethod(GetLastError)
    Abort = property(GetAbort, doc='See `GetAbort`')
    PrintDialogData = property(GetPrintDialogData, doc='See `GetPrintDialogData`')


_windows_.Printer_swigregister(Printer)

def Printer_GetLastError(*args):
    return _windows_.Printer_GetLastError(*args)


class Printout(_core.Object):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.Printout_swiginit(self, _windows_.new_Printout(*args, **kwargs))
        Printout._setCallbackInfo(self, self, Printout)
        return

    __swig_destroy__ = _windows_.delete_Printout
    __del__ = lambda self: None

    def _setCallbackInfo(*args, **kwargs):
        return _windows_.Printout__setCallbackInfo(*args, **kwargs)

    def GetTitle(*args, **kwargs):
        return _windows_.Printout_GetTitle(*args, **kwargs)

    def GetDC(*args, **kwargs):
        return _windows_.Printout_GetDC(*args, **kwargs)

    def SetDC(*args, **kwargs):
        return _windows_.Printout_SetDC(*args, **kwargs)

    def FitThisSizeToPaper(*args, **kwargs):
        return _windows_.Printout_FitThisSizeToPaper(*args, **kwargs)

    def FitThisSizeToPage(*args, **kwargs):
        return _windows_.Printout_FitThisSizeToPage(*args, **kwargs)

    def FitThisSizeToPageMargins(*args, **kwargs):
        return _windows_.Printout_FitThisSizeToPageMargins(*args, **kwargs)

    def MapScreenSizeToPaper(*args, **kwargs):
        return _windows_.Printout_MapScreenSizeToPaper(*args, **kwargs)

    def MapScreenSizeToPage(*args, **kwargs):
        return _windows_.Printout_MapScreenSizeToPage(*args, **kwargs)

    def MapScreenSizeToPageMargins(*args, **kwargs):
        return _windows_.Printout_MapScreenSizeToPageMargins(*args, **kwargs)

    def MapScreenSizeToDevice(*args, **kwargs):
        return _windows_.Printout_MapScreenSizeToDevice(*args, **kwargs)

    def GetLogicalPaperRect(*args, **kwargs):
        return _windows_.Printout_GetLogicalPaperRect(*args, **kwargs)

    def GetLogicalPageRect(*args, **kwargs):
        return _windows_.Printout_GetLogicalPageRect(*args, **kwargs)

    def GetLogicalPageMarginsRect(*args, **kwargs):
        return _windows_.Printout_GetLogicalPageMarginsRect(*args, **kwargs)

    def SetLogicalOrigin(*args, **kwargs):
        return _windows_.Printout_SetLogicalOrigin(*args, **kwargs)

    def OffsetLogicalOrigin(*args, **kwargs):
        return _windows_.Printout_OffsetLogicalOrigin(*args, **kwargs)

    def SetPageSizePixels(*args, **kwargs):
        return _windows_.Printout_SetPageSizePixels(*args, **kwargs)

    def GetPageSizePixels(*args, **kwargs):
        return _windows_.Printout_GetPageSizePixels(*args, **kwargs)

    def SetPageSizeMM(*args, **kwargs):
        return _windows_.Printout_SetPageSizeMM(*args, **kwargs)

    def GetPageSizeMM(*args, **kwargs):
        return _windows_.Printout_GetPageSizeMM(*args, **kwargs)

    def SetPPIScreen(*args, **kwargs):
        return _windows_.Printout_SetPPIScreen(*args, **kwargs)

    def GetPPIScreen(*args, **kwargs):
        return _windows_.Printout_GetPPIScreen(*args, **kwargs)

    def SetPPIPrinter(*args, **kwargs):
        return _windows_.Printout_SetPPIPrinter(*args, **kwargs)

    def GetPPIPrinter(*args, **kwargs):
        return _windows_.Printout_GetPPIPrinter(*args, **kwargs)

    def SetPaperRectPixels(*args, **kwargs):
        return _windows_.Printout_SetPaperRectPixels(*args, **kwargs)

    def GetPaperRectPixels(*args, **kwargs):
        return _windows_.Printout_GetPaperRectPixels(*args, **kwargs)

    def IsPreview(*args, **kwargs):
        return _windows_.Printout_IsPreview(*args, **kwargs)

    def SetIsPreview(*args, **kwargs):
        return _windows_.Printout_SetIsPreview(*args, **kwargs)

    def OnBeginDocument(*args, **kwargs):
        return _windows_.Printout_OnBeginDocument(*args, **kwargs)

    def OnEndDocument(*args, **kwargs):
        return _windows_.Printout_OnEndDocument(*args, **kwargs)

    def OnBeginPrinting(*args, **kwargs):
        return _windows_.Printout_OnBeginPrinting(*args, **kwargs)

    def OnEndPrinting(*args, **kwargs):
        return _windows_.Printout_OnEndPrinting(*args, **kwargs)

    def OnPreparePrinting(*args, **kwargs):
        return _windows_.Printout_OnPreparePrinting(*args, **kwargs)

    def HasPage(*args, **kwargs):
        return _windows_.Printout_HasPage(*args, **kwargs)

    def GetPageInfo(*args, **kwargs):
        return _windows_.Printout_GetPageInfo(*args, **kwargs)

    def base_OnBeginDocument(*args, **kw):
        return Printout.OnBeginDocument(*args, **kw)

    base_OnBeginDocument = wx._deprecated(base_OnBeginDocument, 'Please use Printout.OnBeginDocument instead.')

    def base_OnEndDocument(*args, **kw):
        return Printout.OnEndDocument(*args, **kw)

    base_OnEndDocument = wx._deprecated(base_OnEndDocument, 'Please use Printout.OnEndDocument instead.')

    def base_OnBeginPrinting(*args, **kw):
        return Printout.OnBeginPrinting(*args, **kw)

    base_OnBeginPrinting = wx._deprecated(base_OnBeginPrinting, 'Please use Printout.OnBeginPrinting instead.')

    def base_OnEndPrinting(*args, **kw):
        return Printout.OnEndPrinting(*args, **kw)

    base_OnEndPrinting = wx._deprecated(base_OnEndPrinting, 'Please use Printout.OnEndPrinting instead.')

    def base_OnPreparePrinting(*args, **kw):
        return Printout.OnPreparePrinting(*args, **kw)

    base_OnPreparePrinting = wx._deprecated(base_OnPreparePrinting, 'Please use Printout.OnPreparePrinting instead.')

    def base_GetPageInfo(*args, **kw):
        return Printout.GetPageInfo(*args, **kw)

    base_GetPageInfo = wx._deprecated(base_GetPageInfo, 'Please use Printout.GetPageInfo instead.')
    DC = property(GetDC, SetDC, doc='See `GetDC` and `SetDC`')
    PPIPrinter = property(GetPPIPrinter, SetPPIPrinter, doc='See `GetPPIPrinter` and `SetPPIPrinter`')
    PPIScreen = property(GetPPIScreen, SetPPIScreen, doc='See `GetPPIScreen` and `SetPPIScreen`')
    PageSizeMM = property(GetPageSizeMM, SetPageSizeMM, doc='See `GetPageSizeMM` and `SetPageSizeMM`')
    PageSizePixels = property(GetPageSizePixels, SetPageSizePixels, doc='See `GetPageSizePixels` and `SetPageSizePixels`')
    Title = property(GetTitle, doc='See `GetTitle`')


_windows_.Printout_swigregister(Printout)

class PreviewCanvas(ScrolledWindow):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.PreviewCanvas_swiginit(self, _windows_.new_PreviewCanvas(*args, **kwargs))
        self._setOORInfo(self)
        return


_windows_.PreviewCanvas_swigregister(PreviewCanvas)

class PreviewFrame(Frame):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.PreviewFrame_swiginit(self, _windows_.new_PreviewFrame(*args, **kwargs))
        self._setOORInfo(self)
        return

    def Initialize(*args, **kwargs):
        return _windows_.PreviewFrame_Initialize(*args, **kwargs)

    def CreateControlBar(*args, **kwargs):
        return _windows_.PreviewFrame_CreateControlBar(*args, **kwargs)

    def CreateCanvas(*args, **kwargs):
        return _windows_.PreviewFrame_CreateCanvas(*args, **kwargs)

    def GetControlBar(*args, **kwargs):
        return _windows_.PreviewFrame_GetControlBar(*args, **kwargs)

    ControlBar = property(GetControlBar, doc='See `GetControlBar`')


_windows_.PreviewFrame_swigregister(PreviewFrame)
PREVIEW_PRINT = _windows_.PREVIEW_PRINT
PREVIEW_PREVIOUS = _windows_.PREVIEW_PREVIOUS
PREVIEW_NEXT = _windows_.PREVIEW_NEXT
PREVIEW_ZOOM = _windows_.PREVIEW_ZOOM
PREVIEW_FIRST = _windows_.PREVIEW_FIRST
PREVIEW_LAST = _windows_.PREVIEW_LAST
PREVIEW_GOTO = _windows_.PREVIEW_GOTO
PREVIEW_DEFAULT = _windows_.PREVIEW_DEFAULT
ID_PREVIEW_CLOSE = _windows_.ID_PREVIEW_CLOSE
ID_PREVIEW_NEXT = _windows_.ID_PREVIEW_NEXT
ID_PREVIEW_PREVIOUS = _windows_.ID_PREVIEW_PREVIOUS
ID_PREVIEW_PRINT = _windows_.ID_PREVIEW_PRINT
ID_PREVIEW_ZOOM = _windows_.ID_PREVIEW_ZOOM
ID_PREVIEW_FIRST = _windows_.ID_PREVIEW_FIRST
ID_PREVIEW_LAST = _windows_.ID_PREVIEW_LAST
ID_PREVIEW_GOTO = _windows_.ID_PREVIEW_GOTO

class PreviewControlBar(Panel):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.PreviewControlBar_swiginit(self, _windows_.new_PreviewControlBar(*args, **kwargs))
        self._setOORInfo(self)
        return

    def GetZoomControl(*args, **kwargs):
        return _windows_.PreviewControlBar_GetZoomControl(*args, **kwargs)

    def SetZoomControl(*args, **kwargs):
        return _windows_.PreviewControlBar_SetZoomControl(*args, **kwargs)

    def GetPrintPreview(*args, **kwargs):
        return _windows_.PreviewControlBar_GetPrintPreview(*args, **kwargs)

    def OnNext(*args, **kwargs):
        return _windows_.PreviewControlBar_OnNext(*args, **kwargs)

    def OnPrevious(*args, **kwargs):
        return _windows_.PreviewControlBar_OnPrevious(*args, **kwargs)

    def OnFirst(*args, **kwargs):
        return _windows_.PreviewControlBar_OnFirst(*args, **kwargs)

    def OnLast(*args, **kwargs):
        return _windows_.PreviewControlBar_OnLast(*args, **kwargs)

    def OnGoto(*args, **kwargs):
        return _windows_.PreviewControlBar_OnGoto(*args, **kwargs)

    PrintPreview = property(GetPrintPreview, doc='See `GetPrintPreview`')
    ZoomControl = property(GetZoomControl, SetZoomControl, doc='See `GetZoomControl` and `SetZoomControl`')


_windows_.PreviewControlBar_swigregister(PreviewControlBar)

class PrintPreview(_core.Object):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args):
        _windows_.PrintPreview_swiginit(self, _windows_.new_PrintPreview(*args))
        return

    __swig_destroy__ = _windows_.delete_PrintPreview
    __del__ = lambda self: None

    def SetCurrentPage(*args, **kwargs):
        return _windows_.PrintPreview_SetCurrentPage(*args, **kwargs)

    def GetCurrentPage(*args, **kwargs):
        return _windows_.PrintPreview_GetCurrentPage(*args, **kwargs)

    def SetPrintout(*args, **kwargs):
        return _windows_.PrintPreview_SetPrintout(*args, **kwargs)

    def GetPrintout(*args, **kwargs):
        return _windows_.PrintPreview_GetPrintout(*args, **kwargs)

    def GetPrintoutForPrinting(*args, **kwargs):
        return _windows_.PrintPreview_GetPrintoutForPrinting(*args, **kwargs)

    def SetFrame(*args, **kwargs):
        return _windows_.PrintPreview_SetFrame(*args, **kwargs)

    def SetCanvas(*args, **kwargs):
        return _windows_.PrintPreview_SetCanvas(*args, **kwargs)

    def GetFrame(*args, **kwargs):
        return _windows_.PrintPreview_GetFrame(*args, **kwargs)

    def GetCanvas(*args, **kwargs):
        return _windows_.PrintPreview_GetCanvas(*args, **kwargs)

    def PaintPage(*args, **kwargs):
        return _windows_.PrintPreview_PaintPage(*args, **kwargs)

    def DrawBlankPage(*args, **kwargs):
        return _windows_.PrintPreview_DrawBlankPage(*args, **kwargs)

    def RenderPage(*args, **kwargs):
        return _windows_.PrintPreview_RenderPage(*args, **kwargs)

    def AdjustScrollbars(*args, **kwargs):
        return _windows_.PrintPreview_AdjustScrollbars(*args, **kwargs)

    def GetPrintDialogData(*args, **kwargs):
        return _windows_.PrintPreview_GetPrintDialogData(*args, **kwargs)

    def SetZoom(*args, **kwargs):
        return _windows_.PrintPreview_SetZoom(*args, **kwargs)

    def GetZoom(*args, **kwargs):
        return _windows_.PrintPreview_GetZoom(*args, **kwargs)

    def GetMaxPage(*args, **kwargs):
        return _windows_.PrintPreview_GetMaxPage(*args, **kwargs)

    def GetMinPage(*args, **kwargs):
        return _windows_.PrintPreview_GetMinPage(*args, **kwargs)

    def IsOk(*args, **kwargs):
        return _windows_.PrintPreview_IsOk(*args, **kwargs)

    Ok = IsOk

    def SetOk(*args, **kwargs):
        return _windows_.PrintPreview_SetOk(*args, **kwargs)

    def Print(*args, **kwargs):
        return _windows_.PrintPreview_Print(*args, **kwargs)

    def DetermineScaling(*args, **kwargs):
        return _windows_.PrintPreview_DetermineScaling(*args, **kwargs)

    def __nonzero__(self):
        return self.IsOk()

    Canvas = property(GetCanvas, SetCanvas, doc='See `GetCanvas` and `SetCanvas`')
    CurrentPage = property(GetCurrentPage, SetCurrentPage, doc='See `GetCurrentPage` and `SetCurrentPage`')
    Frame = property(GetFrame, SetFrame, doc='See `GetFrame` and `SetFrame`')
    MaxPage = property(GetMaxPage, doc='See `GetMaxPage`')
    MinPage = property(GetMinPage, doc='See `GetMinPage`')
    PrintDialogData = property(GetPrintDialogData, doc='See `GetPrintDialogData`')
    Printout = property(GetPrintout, SetPrintout, doc='See `GetPrintout` and `SetPrintout`')
    PrintoutForPrinting = property(GetPrintoutForPrinting, doc='See `GetPrintoutForPrinting`')
    Zoom = property(GetZoom, SetZoom, doc='See `GetZoom` and `SetZoom`')


_windows_.PrintPreview_swigregister(PrintPreview)

class PyPrintPreview(PrintPreview):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args):
        _windows_.PyPrintPreview_swiginit(self, _windows_.new_PyPrintPreview(*args))
        PyPrintPreview._setCallbackInfo(self, self, PyPrintPreview)
        return

    def _setCallbackInfo(*args, **kwargs):
        return _windows_.PyPrintPreview__setCallbackInfo(*args, **kwargs)

    def base_SetCurrentPage(*args, **kw):
        return PyPrintPreview.SetCurrentPage(*args, **kw)

    base_SetCurrentPage = wx._deprecated(base_SetCurrentPage, 'Please use PyPrintPreview.SetCurrentPage instead.')

    def base_PaintPage(*args, **kw):
        return PyPrintPreview.PaintPage(*args, **kw)

    base_PaintPage = wx._deprecated(base_PaintPage, 'Please use PyPrintPreview.PaintPage instead.')

    def base_DrawBlankPage(*args, **kw):
        return PyPrintPreview.DrawBlankPage(*args, **kw)

    base_DrawBlankPage = wx._deprecated(base_DrawBlankPage, 'Please use PyPrintPreview.DrawBlankPage instead.')

    def base_RenderPage(*args, **kw):
        return PyPrintPreview.RenderPage(*args, **kw)

    base_RenderPage = wx._deprecated(base_RenderPage, 'Please use PyPrintPreview.RenderPage instead.')

    def base_SetZoom(*args, **kw):
        return PyPrintPreview.SetZoom(*args, **kw)

    base_SetZoom = wx._deprecated(base_SetZoom, 'Please use PyPrintPreview.SetZoom instead.')

    def base_Print(*args, **kw):
        return PyPrintPreview.Print(*args, **kw)

    base_Print = wx._deprecated(base_Print, 'Please use PyPrintPreview.Print instead.')

    def base_DetermineScaling(*args, **kw):
        return PyPrintPreview.DetermineScaling(*args, **kw)

    base_DetermineScaling = wx._deprecated(base_DetermineScaling, 'Please use PyPrintPreview.DetermineScaling instead.')


_windows_.PyPrintPreview_swigregister(PyPrintPreview)

class PyPreviewFrame(PreviewFrame):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.PyPreviewFrame_swiginit(self, _windows_.new_PyPreviewFrame(*args, **kwargs))
        self._setOORInfo(self)
        PyPreviewFrame._setCallbackInfo(self, self, PyPreviewFrame)
        return

    def _setCallbackInfo(*args, **kwargs):
        return _windows_.PyPreviewFrame__setCallbackInfo(*args, **kwargs)

    def SetPreviewCanvas(*args, **kwargs):
        return _windows_.PyPreviewFrame_SetPreviewCanvas(*args, **kwargs)

    def SetControlBar(*args, **kwargs):
        return _windows_.PyPreviewFrame_SetControlBar(*args, **kwargs)

    def Initialize(*args, **kwargs):
        return _windows_.PyPreviewFrame_Initialize(*args, **kwargs)

    def CreateCanvas(*args, **kwargs):
        return _windows_.PyPreviewFrame_CreateCanvas(*args, **kwargs)

    def CreateControlBar(*args, **kwargs):
        return _windows_.PyPreviewFrame_CreateControlBar(*args, **kwargs)

    def base_Initialize(*args, **kw):
        return PyPreviewFrame.Initialize(*args, **kw)

    base_Initialize = wx._deprecated(base_Initialize, 'Please use PyPreviewFrame.Initialize instead.')

    def base_CreateCanvas(*args, **kw):
        return PyPreviewFrame.CreateCanvas(*args, **kw)

    base_CreateCanvas = wx._deprecated(base_CreateCanvas, 'Please use PyPreviewFrame.CreateCanvas instead.')

    def base_CreateControlBar(*args, **kw):
        return PyPreviewFrame.CreateControlBar(*args, **kw)

    base_CreateControlBar = wx._deprecated(base_CreateControlBar, 'Please use PyPreviewFrame.CreateControlBar instead.')


_windows_.PyPreviewFrame_swigregister(PyPreviewFrame)

class PyPreviewControlBar(PreviewControlBar):
    thisown = property((lambda x: x.this.own()), (lambda x, v: x.this.own(v)), doc='The membership flag')
    __repr__ = _swig_repr

    def __init__(self, *args, **kwargs):
        _windows_.PyPreviewControlBar_swiginit(self, _windows_.new_PyPreviewControlBar(*args, **kwargs))
        self._setOORInfo(self)
        PyPreviewControlBar._setCallbackInfo(self, self, PyPreviewControlBar)
        return

    def _setCallbackInfo(*args, **kwargs):
        return _windows_.PyPreviewControlBar__setCallbackInfo(*args, **kwargs)

    def SetPrintPreview(*args, **kwargs):
        return _windows_.PyPreviewControlBar_SetPrintPreview(*args, **kwargs)

    def CreateButtons(*args, **kwargs):
        return _windows_.PyPreviewControlBar_CreateButtons(*args, **kwargs)

    def SetZoomControl(*args, **kwargs):
        return _windows_.PyPreviewControlBar_SetZoomControl(*args, **kwargs)

    def base_CreateButtons(*args, **kw):
        return PreviewControlBar.CreateButtons(*args, **kw)

    base_CreateButtons = wx._deprecated(base_CreateButtons, 'Please use PreviewControlBar.CreateButtons instead.')

    def base_SetZoomControl(*args, **kw):
        return PreviewControlBar.SetZoomControl(*args, **kw)

    base_SetZoomControl = wx._deprecated(base_SetZoomControl, 'Please use PreviewControlBar.SetZoomControl instead.')


_windows_.PyPreviewControlBar_swigregister(PyPreviewControlBar)
return

# okay decompiling TextTools/wx/_windows.pyo
