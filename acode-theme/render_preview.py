"""Render a mock Acode/CodeMirror screenshot for the Godot Colors palette.

Purely a design preview: each token is drawn with the exact hex it gets in the
theme, so the palette can be judged before pasting the plugin into Acode.
"""
from PIL import Image, ImageDraw, ImageFont

W, H = 1240, 1010
BG = "#0F0F0F"
GUTTER = "#1A1A1A"
LINENO = "#5C5C5C"
ACTIVE = "#1A1A1A"

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FONTB = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

# ---- palette, grouped by family -------------------------------------------
GOLD_L, GOLD, GOLD_D = "#FFE066", "#FFCC00", "#E0A800"
ORANGE_L, ORANGE = "#FF8B3D", "#FF6600"
BLUE, SKY = "#7870DE", "#82E2F6"
PINK, PINK_L, PINK_D = "#F98BC3", "#FFB8DC", "#E06AA0"
LIME, GREEN_M = "#66FF00", "#99CC99"
TEAL = "#339999"
VIOLET, VIOLET_L = "#9933CC", "#C77DFF"
DIM, WHITE = "#BEBEBE", "#FFFFFF"

K = BLUE        # structure keywords  import / export / const / function
KC = ORANGE     # control keywords    if / return / throw / new
V = GOLD        # variable use
ND = ORANGE_L   # declaration name    const X = ...
FN = SKY        # function / method
P = PINK        # property
S = LIME        # string
N = GOLD_L      # number
T = TEAL        # type / class
DC = DIM        # delimiters, operators, punctuation
C = VIOLET      # comment

CODE = [
    [(C, "# derive key material from env or the tracked file")],
    [(K, "import"), (DC, " "), (V, "crypto"), (DC, " "), (K, "from"), (DC, " "), (S, "'node:crypto'"), (DC, ";")],
    [(K, "import"), (DC, " "), (V, "fs"), (DC, " "), (K, "from"), (DC, " "), (S, "'node:fs'"), (DC, ";")],
    [(K, "import"), (DC, " "), (V, "path"), (DC, " "), (K, "from"), (DC, " "), (S, "'node:path'"), (DC, ";")],
    [(DC, "")],
    [(K, "const"), (DC, " "), (ND, "HERE"), (DC, " = "), (V, "path"), (DC, "."), (FN, "dirname"),
     (DC, "("), (FN, "fileURLToPath"), (DC, "("), (V, "import"), (DC, "."), (P, "meta"), (DC, "."), (P, "url"),
     (DC, "));")],
    [(K, "export"), (DC, " "), (K, "const"), (DC, " "), (ND, "MASTER_ENC"), (DC, " = "), (V, "path"), (DC, "."),
     (FN, "join"), (DC, "("), (ND, "HERE"), (DC, ", "), (S, "'master.json.enc'"), (DC, ");")],
    [(K, "const"), (DC, " "), (ND, "IV_BYTES"), (DC, " = "), (N, "12"), (DC, ";")],
    [(DC, "")],
    [(K, "function"), (DC, " "), (FN, "loadKey"), (DC, "() {")],
    [(K, "  let"), (DC, " "), (ND, "hex"), (DC, " = ("), (V, "process"), (DC, "."), (P, "env"), (DC, "."), (P, "MASTER_JSON_KEY"),
     (DC, " || "), (S, "''"), (DC, ")."), (FN, "trim"), (DC, "();")],
    [(KC, "  if"), (DC, " (!"), (ND, "hex"), (DC, ") {")],
    [(KC, "    throw"), (DC, " "), (KC, "new"), (DC, " "), (T, "Error"), (DC, "("), (S, "'MASTER_JSON_KEY is required'"), (DC, ");")],
    [(DC, "  }")],
    [(KC, "  return"), (DC, " "), (ND, "hex"), (DC, ";")],
    [(DC, "}")],
]

FAMILIES = [
    ("GOLD", [GOLD_L, GOLD, GOLD_D], "numbers / variables / labels"),
    ("ORANGE", [ORANGE_L, ORANGE], "declarations / keywords"),
    ("BLUE", [SKY, BLUE], "functions / structure words"),
    ("PINK", [PINK_L, PINK, PINK_D], "keys / properties"),
    ("GREEN", [LIME, GREEN_M], "strings / escapes"),
    ("TEAL", [TEAL], "types / classes / builtins"),
    ("VIOLET", [VIOLET_L, VIOLET], "constants / comments"),
    ("NEUTRAL", [WHITE, DIM], "text / operators"),
]

FT = ImageFont.truetype(FONT, 25)
FTB = ImageFont.truetype(FONTB, 25)
SM = ImageFont.truetype(FONT, 16)
SMB = ImageFont.truetype(FONTB, 16)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

adv = d.textlength("M", font=FT)
line_h = 40
top = 46
gutter_w = 76

# gutter
d.rectangle([0, 0, gutter_w, H], fill=GUTTER)
d.rectangle([0, top + line_h - 6, gutter_w, top + line_h * 2 - 6], fill=ACTIVE)

x0 = gutter_w + 22
y = top
for i, line in enumerate(CODE, start=1):
    d.text((gutter_w - 20, y), str(i), font=FT, fill=LINENO, anchor="rt")
    if not line or line[0][0] == DC and line[0][1] == "":
        y += line_h
        continue
    x = x0
    for color, text in line:
        d.text((x, y), text, font=FT, fill=color)
        x += d.textlength(text, font=FT)
    y += line_h

# family legend
ly = y + 40
d.line([(0, ly - 22), (W, ly - 22)], fill="#2A2A2A", width=1)
for idx, (name, colors, sub) in enumerate(FAMILIES):
    cx = 34 + (idx % 2) * 600
    cy = ly + (idx // 2) * 62
    d.text((cx, cy), name, font=SMB, fill="#9A9A9A")
    sx = cx + 96
    for c in colors:
        d.rounded_rectangle([sx, cy - 2, sx + 62, cy + 20], radius=5, fill=c)
        sx += 70
    d.text((sx + 8, cy + 2), sub, font=SM, fill="#5A5A5A")

img.save("/home/user/acode-theme/preview.png")
print("saved", img.size)
