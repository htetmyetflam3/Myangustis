# uncompyle6 version 3.9.3
# Python bytecode version base 2.5 (62131)
# Decompiled from: Python 3.13.5 (main, Aug 10 2026, 12:06:59) [GCC 14.2.0]
# Embedded file name: lib.pyo
# Compiled at: 2009-08-23 16:59:40
import time, glob, re, codecs, sys, os, htmlentitydefs, cPickle
(ZAWGYI, ZAWGYI2009, UNICODE41, UNICODE51, UNICODE511, UNIMM, MYAZEDI, WIN, MMYANMAR1, ACADEMY, KING, GANDAMAR, METRIX, CE, MS, WWIN, KANNAKA, PDF1) = range(18)
FONTLIST = [3, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
FONTDESC = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 
 37]
FONTSIZE = [38, 38, 39, 40, 38, 39, 38, 41, 41, 42, 41, 42, 43, 42, 39, 41, 44, 
 44]
(argv, font, fname, ENC) = (
 (' ').join(sys.argv), UNICODE51, len(sys.argv) > 1 and sys.argv[1] or None, 'utf16')
if `ZAWGYI` in sys.argv or re.search('zawgyi', argv, re.I):
    font = ZAWGYI
if re.search('utf\\-?8', argv, re.I):
    ENC = 'utf8'
OUT = 'output/'
LOG = []

class timer:

    def __init__(_):
        _.start = time.time()
        _.current = _.start
        return

    def timer(_, start=None):
        if start:
            _.current = _.start
        rest = time.time() - _.current
        _.current = time.time()
        return 'in ' + str(round(rest * 1000)) + 'ms'

    def count(_):
        rest = time.time() - _.current
        _.current = time.time()
        return rest


starttime, l = time.time(), timer()

def t2b(arry):
    x = 0
    for i in range(len(arry)):
        x += int(arry[i], 2) << i * 8

    return x


def loadlist(argv, level=10):
    files = []
    for i in range(level):
        files += glob.glob('*/' * i + argv.rsplit('/')[-1])

    print len(files), 'files found'
    return files


def addSlash(txt):
    return re.sub(u'([!"#$%&()'*+,-.\;/:?@\[\]_`{}~])', (lambda x: '\\' + x.group(1)), txt)


def addSlashCSV(txt):
    return re.sub(u'(["'/\-])', (lambda x: '\\' + x.group(1)), txt)


def addSlashSql(txt):
    return re.sub(u'(['])', (lambda x: x.group(1) * 2), txt)


def stripBlank(txt):
    txt = re.sub('[[(/][\\s\\.\\,"\'\\-\\|\\;]*?[])/]', '', txt)
    txt = re.sub('[[(]\\s*(or|usu|esp|often|also)\\s*[])]', '', txt)
    txt = re.sub('\\|E?(FEA|POS|P)\\|', '', txt)
    txt = re.sub(' *([[]()]) *', '\\1', txt)
    return txt


def fopen(fname):
    try:
        codecs.open(fname, 'rb', 'utf16').read(4096)
        fhandle = codecs.open(fname, 'rb', 'utf16')
    except:
        try:
            codecs.open(fname, 'rb', 'utf8').read(4096)
            fhandle = codecs.open(fname, 'rb', 'utf8')
        except:
            codecs.open(fname, 'rb', 'cp1252').read(4096)
            fhandle = codecs.open(fname, 'rb', 'cp1252')

    return fhandle


def fread(fname, l=None):
    try:
        txt = codecs.open(fname, 'rb+', 'utf16').read(l)
    except:
        try:
            txt = codecs.open(fname, 'rb+', 'utf8').read(l)
        except:
            txt = codecs.open(fname, 'rb+', 'cp1252').read(l)

    return txt.replace(u'\u', '')


def fwrite(fname, data, ENC='utf16'):
    if not os.path.exists(OUT):
        os.mkdir(OUT)
    outfile = codecs.open(fname, 'w+', ENC)
    outfile.write(data)
    outfile.close()
    return


def ewrite(fname):
    if not os.path.exists(OUT):
        os.mkdir(OUT)
    fname = os.path.basename(fname).split('.')[0]
    errorfile = codecs.open(fname + '_error.log', 'wb+', 'utf8')
    errorfile.write(('\n').join(LOG))
    errorfile.close()
    return


def percent(val, base):
    return str(round(float(val) / base * 100, 2)) + '%'


def uitem(arry):
    ary, tmp = [], {}
    for x in arry:
        if len(x) == 0:
            continue
        if not tmp.has_key(x):
            ary.append(x)
            tmp[x] = 1

    return ary


def ucount(arry):
    sh = {}
    for x in arry:
        if not sh.has_key(x):
            sh[x] = 1
        else:
            sh[x] += 1

    return sh


def u512511(data):
    data = re.sub(u'\u0x1039([0x1000-0x1021]0x103c?0x1031?)', u'\u0x10040x103a0x1039', data)
    data = re.sub(u'\u0x1000-0x1021](?:0x1039[0x1000-0x1021])?[0x103b-0x103e]*)0x1031', u'\u1', data)
    data = re.sub(u'\u0x1000-0x1021](?:0x1039[0x1000-0x1021])?)0x103c', u'\u1', data)
    return data


def u511251(data):
    data = re.sub(u'\u?0x1031?[0x1000-0x1021])0x10040x103a0x1039', u'\u0x1039\1', data)
    data = re.sub(u'\u[0x1000-0x1021](?:0x1039[0x1000-0x1021])?)', u'\u0x103c', data)
    data = re.sub(u'\u[0x1000-0x1021](?:0x1039[0x1000-0x1021])?[0x103b-0x103e]*)', u'\u0x1031', data)
    return data


def cleanHTML(data):
    data = re.sub('(\r?\n)', ' ', data)
    data = re.sub('\t', ' ', data)
    data = re.sub('^.*?<body', '<body', data)
    data = re.sub('<script.*?</script>', '', data)
    data = re.sub('<style.*?</style>', '', data)
    data = re.sub('<embed.*?</embed>', '', data)
    data = re.sub('<object.*?</object>', '', data)
    data = re.sub('<form.*?</form>', '', data)
    data = re.sub('(?:&nbsp;|&raquo;)', ' ', data)
    data = re.sub(' +', ' ', data)
    data = re.sub('&(\\w+);', (lambda x: unichr(htmlentitydefs.name2codepoint[x.group(1)])), data)
    return data


def dump(uname, data):
    f1 = file(uname, 'wb')
    cPickle.dump(data, f1, -1)
    f1.close()
    return


def load(uname):
    f1 = file(uname, 'rb')
    data = cPickle.load(f1)
    f1.close()
    return data


return

# okay decompiling TextTools/lib.pyo
