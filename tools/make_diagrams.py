"""Generate the play diagrams (SVG + PNG) for this repo.

Usage: python3 tools/make_diagrams.py
Needs: pip install cairosvg
"""
import math
import os

import cairosvg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "diagrams")

FONT = "DejaVu Sans, Arial, sans-serif"
OFF = dict(fill="#EEEDFE", stroke="#534AB7", text="#3C3489")   # offense
DEF = dict(fill="#FAECE7", stroke="#993C1D", text="#712B13")   # defense
CUT = "#534AB7"
PASS = "#6B6A64"
DEF_MOVE = "#D85A30"
LINES = "#A9A69B"
FLOOR = "#FBF6EC"

CARD_W = 800
SCALE = 2
COURT_X, COURT_Y = 20, 80  # translate before scaling


# ---------- geometry helpers (court coordinates, 380 x 330 space) ----------

def _end_and_tangent(kind, pts):
    """Return end point and unit direction at the end of a path."""
    end = pts[-1]
    prev = pts[-2]
    dx, dy = end[0] - prev[0], end[1] - prev[1]
    n = math.hypot(dx, dy) or 1
    return end, (dx / n, dy / n)


def _path_d(kind, pts, trim=0.0):
    """SVG path data. `trim` shortens the end so a head can sit on the tip."""
    end, (ux, uy) = _end_and_tangent(kind, pts)
    tip = (end[0] - ux * trim, end[1] - uy * trim)
    p = list(pts[:-1]) + [tip]
    if kind == "line":
        return f"M{p[0][0]} {p[0][1]} L{p[1][0]:.1f} {p[1][1]:.1f}"
    if kind == "quad":
        return f"M{p[0][0]} {p[0][1]} Q{p[1][0]} {p[1][1]} {p[2][0]:.1f} {p[2][1]:.1f}"
    if kind == "cubic":
        return (f"M{p[0][0]} {p[0][1]} C{p[1][0]} {p[1][1]} {p[2][0]} {p[2][1]} "
                f"{p[3][0]:.1f} {p[3][1]:.1f}")
    raise ValueError(kind)


def arrow(kind, pts, color, dashed=False, width=1.6):
    """A path with a filled arrowhead (drawn by hand, no SVG markers)."""
    end, (ux, uy) = _end_and_tangent(kind, pts)
    head_len, head_w = 8.0, 4.2
    d = _path_d(kind, pts, trim=head_len * 0.7)
    dash = ' stroke-dasharray="5 4"' if dashed else ""
    bx, by = end[0] - ux * head_len, end[1] - uy * head_len
    px, py = -uy, ux
    head = (f"{end[0]:.1f},{end[1]:.1f} {bx + px * head_w:.1f},{by + py * head_w:.1f} "
            f"{bx - px * head_w:.1f},{by - py * head_w:.1f}")
    return (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}"'
            f' stroke-linecap="round"{dash}/>'
            f'<polygon points="{head}" fill="{color}"/>')


def screen(kind, pts, color=CUT, width=1.6):
    """Standard screen notation: a line ending in a perpendicular bar."""
    end, (ux, uy) = _end_and_tangent(kind, pts)
    px, py = -uy, ux
    bar = 9
    d = _path_d(kind, pts)
    return (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round"/>'
            f'<line x1="{end[0] + px * bar:.1f}" y1="{end[1] + py * bar:.1f}" '
            f'x2="{end[0] - px * bar:.1f}" y2="{end[1] - py * bar:.1f}" '
            f'stroke="{color}" stroke-width="{width + 1}" stroke-linecap="round"/>')


def player(x, y, label, side=OFF, ball=False):
    s = (f'<circle cx="{x}" cy="{y}" r="13" fill="{side["fill"]}" stroke="{side["stroke"]}" stroke-width="1"/>'
         f'<text x="{x}" y="{y + 4.3}" text-anchor="middle" font-family="{FONT}" font-size="12" '
         f'font-weight="bold" fill="{side["text"]}">{label}</text>')
    if ball:
        # small ball marker at the player's shoulder
        s += (f'<circle cx="{x + 12}" cy="{y - 11}" r="5" fill="#EF9F27" stroke="#854F0B" stroke-width="0.8"/>'
              f'<path d="M{x + 7} {y - 11} L{x + 17} {y - 11} M{x + 12} {y - 16} L{x + 12} {y - 6}" '
              f'stroke="#854F0B" stroke-width="0.6"/>')
    return s


def step(x, y, n):
    """Order number in a small circle."""
    return (f'<circle cx="{x}" cy="{y}" r="7.5" fill="#FFFFFF" stroke="#2C2C2A" stroke-width="0.8"/>'
            f'<text x="{x}" y="{y + 3.6}" text-anchor="middle" font-family="{FONT}" font-size="10" '
            f'font-weight="bold" fill="#2C2C2A">{n}</text>')


def note(x, y, text, color="#5F5E5A", anchor="middle"):
    return (f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-family="{FONT}" font-size="10" '
            f'fill="{color}">{text}</text>')


def court():
    return (f'<rect x="20" y="20" width="340" height="290" fill="{FLOOR}" stroke="{LINES}" stroke-width="1"/>'
            f'<rect x="140" y="190" width="100" height="120" fill="#F3EBDB" stroke="{LINES}" stroke-width="1"/>'
            f'<path d="M140 190 A50 50 0 0 1 240 190" fill="none" stroke="{LINES}" stroke-width="1"/>'
            f'<path d="M40 310 L40 250 Q190 60 340 250 L340 310" fill="none" stroke="{LINES}" stroke-width="1"/>'
            f'<line x1="172" y1="300" x2="208" y2="300" stroke="{LINES}" stroke-width="1.5"/>'
            f'<circle cx="190" cy="292" r="6" fill="none" stroke="#D85A30" stroke-width="1.4"/>')


# ---------- card layout ----------

def card(title, subtitle, drawing, lines, legend):
    text_y0 = COURT_Y + 310 * SCALE + 60
    h = text_y0 + 34 * len(lines) + 70
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{CARD_W}" height="{h}" viewBox="0 0 {CARD_W} {h}">',
           f'<rect width="{CARD_W}" height="{h}" fill="#FFFFFF"/>',
           f'<text x="60" y="52" font-family="{FONT}" font-size="30" font-weight="bold" fill="#2C2C2A">{title}</text>',
           f'<text x="740" y="52" text-anchor="end" font-family="{FONT}" font-size="18" fill="#888780">{subtitle}</text>',
           f'<g transform="translate({COURT_X} {COURT_Y}) scale({SCALE})">{court()}{drawing}</g>']
    y = text_y0
    for ln in lines:
        weight = ' font-weight="bold"' if ln.startswith("**") else ""
        ln = ln.strip("*")
        out.append(f'<text x="60" y="{y}" font-family="{FONT}" font-size="20"{weight} fill="#2C2C2A">{ln}</text>')
        y += 34
    out.append(f'<text x="60" y="{y + 16}" font-family="{FONT}" font-size="16" fill="#888780">{legend}</text>')
    out.append("</svg>")
    return "\n".join(out), h


LEGEND = "Сплошная — рывок · пунктир — пас · «Т» — заслон · цифры — порядок"
LEGEND_DEF = "O — атака, X — защита · сплошная — рывок · оранжевый — защита"


# ---------- the plays ----------

def lower_scissors():
    d = arrow("line", [(190, 86), (190, 163)], PASS, dashed=True)
    d += arrow("quad", [(288, 132), (200, 160), (165, 262)], CUT)
    d += arrow("quad", [(92, 132), (180, 160), (215, 262)], CUT)
    d += player(190, 70, "O1", ball=True) + player(190, 178, "O5")
    d += player(300, 125, "O3") + player(80, 125, "O4")
    d += step(178, 124, 1) + step(256, 166, 2) + step(124, 166, 3)
    lines = [
        "**Расстановка: O1 наверху с мячом, O5 на линии штрафного,",
        "**O3 и O4 высоко на крыльях, углы пустые.",
        "1. O1 отдаёт пас на O5.",
        "2. O3 режет по диагонали мимо O5 к кольцу, впритирку.",
        "3. O4 режет следом, за спиной O3. Пути скрещиваются",
        "    между O5 и кольцом, O3 и O5 работают как заслон.",
        "Чтение O5: чаще всего пас в зону на ход под лэй-ап.",
        "Если защита провалилась в зону — O5 бросает или идёт сам.",
    ]
    return card("Нижний скрест", "split cuts / scissors (low)", d, lines, LEGEND)


def upper_scissors():
    d = arrow("line", [(190, 86), (190, 175)], PASS, dashed=True)
    d += arrow("cubic", [(288, 132), (220, 145), (160, 150), (150, 255)], CUT)
    d += arrow("cubic", [(92, 132), (160, 145), (220, 150), (230, 255)], CUT)
    d += player(190, 70, "O1", ball=True) + player(190, 190, "O5")
    d += player(300, 125, "O3") + player(80, 125, "O4")
    d += step(178, 112, 1) + step(242, 126, 2) + step(138, 126, 3)
    lines = [
        "**Та же расстановка, но рывки скрещиваются над O5 —",
        "**между ним и мячом — и уходят в зону по бокам от него.",
        "1. O1 отдаёт пас на O5.",
        "2. O3 режет по диагонали над O5, впритирку.",
        "3. O4 режет следом, за спиной O3.",
        "Чтение O5: защитник отстал — хэндофф пробегающему;",
        "защитник перекрыл сверху — пас на ход в зону;",
        "защитники поменялись — мяч тому, у кого мисматч.",
    ]
    return card("Верхний скрест", "split cuts / scissors (high)", d, lines, LEGEND)


def lower_cross():
    d = screen("line", [(143, 262), (228, 262)])
    d += arrow("quad", [(258, 248), (195, 210), (142, 242)], CUT)
    d += screen("line", [(196, 124), (225, 242)])
    d += arrow("quad", [(232, 250), (300, 232), (318, 172)], CUT)
    d += player(65, 150, "O1", ball=True) + player(190, 110, "O2")
    d += player(128, 262, "O3") + player(264, 262, "O5")
    d += step(170, 276, 1) + step(168, 222, 2) + step(198, 176, 3) + step(304, 250, 4)
    lines = [
        "**Заслон поперёк, а потом заслон самому заслонщику.",
        "1. O3 ставит заслон поперёк зоны для O5.",
        "2. O5 выходит на ближний к мячу блок — пас в низкую стойку.",
        "3. Сразу за этим O2 ставит pin-down самому O3.",
        "4. O3 выходит наверх на крыло под бросок.",
        "Защита занята центровым и не успевает за вторым заслоном.",
        "O1 выбирает: пас O5 в стойку или переводом на O3.",
    ]
    return card("Нижний крест", "screen the screener", d, lines, LEGEND)


def upper_cross():
    d = screen("line", [(146, 183), (230, 183)])
    d += arrow("quad", [(247, 197), (190, 232), (140, 200)], CUT)
    d += arrow("line", [(236, 170), (290, 118)], CUT)
    d += player(65, 150, "O1", ball=True)
    d += player(132, 183, "O4") + player(250, 183, "O3")
    d += step(188, 170, 1) + step(190, 232, 2) + step(272, 152, 3)
    lines = [
        "**Та же идея на уровне линии штрафного (элбоу).",
        "1. O4 ставит заслон поперёк для O3.",
        "2. O3 выходит на ближний к мячу элбоу, получает пас",
        "    лицом к кольцу: бросок, проход или передача.",
        "3. O4 после заслона выходит наверх под бросок.",
        "Если защитник O4 помог на O3 — открыт O4 наверху.",
        "Часто используется как вход в позиционную атаку.",
    ]
    return card("Верхний крест", "elbow cross screen", d, lines, LEGEND)


def pin_down_defense():
    d = arrow("quad", [(335, 278), (330, 200), (244, 192)], CUT)
    d += arrow("line", [(282, 254), (212, 284)], CUT)
    d += arrow("line", [(286, 224), (270, 190)], DEF_MOVE, dashed=True, width=1.3)
    d += arrow("quad", [(326, 258), (300, 214), (232, 210)], DEF_MOVE, dashed=True, width=1.3)
    d += player(65, 150, "O1", ball=True)
    d += player(292, 242, "O3") + player(340, 290, "O2")
    d += player(262, 176, "X3", side=DEF) + player(218, 208, "X2", side=DEF)
    d += note(244, 300, "O3 открыт", color="#A32D2D")
    lines = [
        "**Ошибка: оба защитника уходят за выходящим из угла.",
        "O3 ставит pin-down для O2. Без смены роли такие:",
        "X2 — «lock and trail»: прилипает к бедру O2 и идёт за ним.",
        "X3 — «show and recover»: шаг-полтора, притормозить O2,",
        "    и сразу назад к O3.",
        "Если X3 остаётся на O2 — заслонщик O3 свободен:",
        "ныряет к кольцу (slip) или выходит на бросок (pop).",
        "Лечится: X3 заранее кричит «заслон!», роли чёткие,",
        "а при одинаковом росте — просто смена (switch).",
    ]
    return card("Pin-down на слабой стороне", "защита", d, lines, LEGEND_DEF)


DEF_FADED = dict(fill="#FDF7F4", stroke="#E6BFAF", text="#C69A88")


def elbow_pnr_setup():
    d = screen("quad", [(258, 248), (264, 190), (252, 147)])
    d += arrow("line", [(232, 258), (230, 210)], DEF_MOVE, dashed=True, width=1.3)
    d += player(288, 112, "O1", ball=True) + player(274, 130, "X1", side=DEF)
    d += player(258, 262, "O5") + player(232, 272, "X5", side=DEF)
    d += player(345, 282, "O2") + player(318, 266, "X2", side=DEF)
    d += player(80, 140, "O3") + player(110, 172, "X3", side=DEF)
    d += player(35, 282, "O4") + player(122, 256, "X4", side=DEF)
    d += step(278, 200, 1)
    d += note(238, 151, "заслон", color=CUT, anchor="end")
    lines = [
        "**Атака: четверо снаружи, углы заняты.",
        "O1 — с мячом в правом слоте, над элбоу.",
        "1. O5 выходит с блока и ставит заслон на X1 у элбоу.",
        "O2 — правый угол, O3 — левое крыло, O4 — левый угол.",
        "**Защита:",
        "X1 — на O1, проходит над заслоном или под ним.",
        "X5 — опускается в «дроп» к линии штрафного.",
        "X4 — «нижний»: страхует проход и ролл к кольцу.",
        "X2 и X3 — на шаг в помощь, но готовы к переводу.",
    ]
    return card("Пик-н-ролл: расстановка", "на элбоу", d, lines, LEGEND_DEF)


def elbow_pnr_options():
    d = arrow("quad", [(276, 106), (225, 104), (205, 162)], CUT, width=2)
    d += arrow("quad", [(256, 154), (262, 220), (212, 266)], CUT)
    d += arrow("line", [(262, 150), (306, 178)], CUT)
    d += arrow("line", [(198, 172), (50, 274)], PASS, dashed=True)
    d += arrow("line", [(196, 160), (96, 143)], PASS, dashed=True)
    d += player(279, 137, "X1", side=DEF_FADED) + player(228, 200, "X5", side=DEF_FADED)
    d += player(318, 266, "X2", side=DEF_FADED) + player(110, 174, "X3", side=DEF_FADED)
    d += player(125, 252, "X4", side=DEF_FADED)
    d += player(288, 112, "O1", ball=True) + player(250, 140, "O5")
    d += player(345, 282, "O2") + player(80, 140, "O3") + player(35, 282, "O4")
    d += step(228, 94, 1) + step(270, 230, 2) + step(150, 226, 3)
    d += step(146, 140, 4) + step(314, 160, 5)
    lines = [
        "**После заслона O1 читает защиту:",
        "1. Проход в середину — бросок с отрыва или к кольцу.",
        "2. O5 ныряет к кольцу (ролл) — пас на ролл или лоб.",
        "3. X4 помог на ролл — перевод в левый угол на O4.",
        "4. X3 провалился в помощь — пас на O3 под бросок.",
        "5. X5 в дропе — O5 выходит на бросок (поп), не ныряет.",
        "Если X2 помог на проход — пас в правый угол на O2.",
        "Если X1 закрыл середину (айс) — O1 уходит от заслона",
        "    вдоль лицевой (реджект), O5 ныряет к кольцу.",
    ]
    return card("Пик-н-ролл: опции", "защита бледным", d, lines, LEGEND)


PLAYS = [
    ("01-lower-scissors", lower_scissors),
    ("02-upper-scissors", upper_scissors),
    ("03-lower-cross", lower_cross),
    ("04-upper-cross", upper_cross),
    ("05-pin-down-defense", pin_down_defense),
    ("06-elbow-pnr-setup", elbow_pnr_setup),
    ("07-elbow-pnr-options", elbow_pnr_options),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    cards = {}
    for name, fn in PLAYS:
        svg, h = fn()
        cards[name] = (svg, h)
        with open(os.path.join(OUT, f"{name}.svg"), "w", encoding="utf-8") as f:
            f.write(svg)
        cairosvg.svg2png(bytestring=svg.encode(), write_to=os.path.join(OUT, f"{name}.png"))

    names = [n for n, _ in PLAYS]
    sheet(cards, names[:4], "Кресты и скресты", "all-four-plays")
    sheet(cards, names[5:7], "Пик-н-ролл на элбоу", "elbow-pnr")


def sheet(cards, names, title, filename):
    """Combine several cards into one shareable image, two per row."""
    cell_h = max(cards[n][1] for n in names)
    rows = (len(names) + 1) // 2
    head = 110
    w, h = CARD_W * 2 + 20, head + cell_h * rows + 20
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">',
             f'<rect width="{w}" height="{h}" fill="#F1EFE8"/>',
             f'<text x="{w / 2}" y="70" text-anchor="middle" font-family="{FONT}" font-size="40" '
             f'font-weight="bold" fill="#2C2C2A">{title}</text>']
    for i, n in enumerate(names):
        x = 10 + (i % 2) * CARD_W
        y = head + (i // 2) * cell_h
        inner = "\n".join(cards[n][0].split("\n")[2:-1])
        parts.append(f'<g transform="translate({x} {y})">'
                     f'<rect x="5" y="5" width="{CARD_W - 10}" height="{cell_h - 10}" rx="14" fill="#FFFFFF"/>'
                     f'{inner}</g>')
    parts.append("</svg>")
    svg = "\n".join(parts)
    with open(os.path.join(OUT, f"{filename}.svg"), "w", encoding="utf-8") as f:
        f.write(svg)
    cairosvg.svg2png(bytestring=svg.encode(), write_to=os.path.join(OUT, f"{filename}.png"))


if __name__ == "__main__":
    main()
