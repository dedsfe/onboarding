#!/usr/bin/env python3
"""Desenha o Slidi, mascote do The Carousel Maker: um cartão 9:16 fosco com rosto estilo Grok Bot.
Espelha a SlidiView (Sources/BulkMaker/Slidi.swift) — lá ele anima; aqui fica o quadro parado de cada estado.
Gera um SVG por estado (normal, feliz, gerando, pensando) e uma folha com os quatro sobre fundo grafite."""
from math import cos, pi, sin
from pathlib import Path

HERE = Path(__file__).parent
CYAN, PINK, GRAPHITE = "#25F4EE", "#FE2C55", "#1C1D21"
W, H = 216, 384                  # o cartão; todas as medidas saem da largura, como na SlidiView
CX, TOP = 200, 98                # centro horizontal e topo do cartão num quadro de 400x600
EYE_Y = TOP + 0.43 * H

DEFS = f'''<defs>
  <linearGradient id="corpo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EDEDF2"/><stop offset="1" stop-color="#BDBFC9"/></linearGradient>
  <linearGradient id="borda" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="{CYAN}"/><stop offset=".2" stop-color="{CYAN}" stop-opacity="0"/>
    <stop offset=".8" stop-color="{PINK}" stop-opacity="0"/><stop offset="1" stop-color="{PINK}"/>
  </linearGradient>
  <linearGradient id="tiktok" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{CYAN}"/><stop offset="1" stop-color="{PINK}"/></linearGradient>
  <linearGradient id="olho" gradientUnits="userSpaceOnUse" x1="0" y1="{EYE_Y - 0.2 * W:.1f}" x2="0" y2="{EYE_Y + 0.2 * W:.1f}">
    <stop offset="0" stop-color="#30333D"/><stop offset="1" stop-color="#0A0A0F"/>
  </linearGradient>
  <linearGradient id="reflexo" x1="0" y1="0" x2="0" y2=".25"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <filter id="brilho" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="{0.04 * W:.1f}"/></filter>
  <filter id="macio" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="{0.02 * W:.1f}"/></filter>
  <filter id="bochecha" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="{0.011 * W:.1f}"/></filter>
  <filter id="sombra" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="{0.07 * W:.1f}" stdDeviation="{0.045 * W:.1f}" flood-color="#000" flood-opacity=".45"/></filter>
  <clipPath id="cartao"><rect x="{CX - W / 2}" y="{TOP}" width="{W}" height="{H}" rx="{0.3 * W:.1f}"/></clipPath>
</defs>'''


def card(tag, **attrs):
    extra = " ".join(f'{k.replace("_", "-")}="{v}"' for k, v in attrs.items())
    return f'<{tag} x="{CX - W / 2}" y="{TOP}" width="{W}" height="{H}" rx="{0.3 * W:.1f}" {extra}/>'


def body():
    inset = 0.005 * W
    return f'''
  <!-- luz ciano/rosa vazando no fundo -->
  {card("rect", fill="none", stroke="url(#borda)", stroke_width=f"{0.04 * W:.1f}", filter="url(#brilho)", opacity=".3")}
  <!-- corpo fosco, luz de cima, sombra projetada -->
  {card("rect", fill="url(#corpo)", filter="url(#sombra)")}
  <g clip-path="url(#cartao)">
    <!-- sombra interna embaixo, luz interna em cima -->
    <g transform="translate(0 {-0.04 * W:.1f})">{card("rect", fill="none", stroke="#000", stroke_opacity=".32", stroke_width=f"{0.14 * W:.1f}", filter="url(#brilho)")}</g>
    <g transform="translate(0 {0.025 * W:.1f})">{card("rect", fill="none", stroke="#fff", stroke_opacity=".8", stroke_width=f"{0.04 * W:.1f}", filter="url(#macio)")}</g>
    <!-- borda TikTok como luz lateral -->
    {card("rect", fill="none", stroke="url(#borda)", stroke_width=f"{0.07 * W:.1f}", filter="url(#macio)", opacity=".5")}
    <!-- brilho especular no topo -->
    <ellipse cx="{CX}" cy="{TOP + H / 2 - 0.6 * W:.1f}" rx="{0.35 * W:.1f}" ry="{0.13 * W:.1f}" fill="#fff" opacity=".6" filter="url(#brilho)"/>
  </g>
  <rect x="{CX - W / 2 + inset:.1f}" y="{TOP + inset:.1f}" width="{W - 2 * inset:.1f}" height="{H - 2 * inset:.1f}" rx="{0.3 * W - inset:.1f}"
        fill="none" stroke="url(#reflexo)" stroke-width="{0.01 * W:.1f}"/>'''


def eye(state, ex):
    """ex: centro do olho. Cada olho é um traço de ponta redonda, como o EyeShape da SlidiView."""
    y, u = EYE_Y, W
    if state == "feliz":
        a, b = 0.085 * u, y + 0.035 * u
        return f'<path d="M{ex - a:.1f} {b:.1f} A{a:.1f} {a:.1f} 0 0 1 {ex + a:.1f} {b:.1f}" fill="none" stroke="url(#olho)" stroke-width="{0.07 * u:.1f}" stroke-linecap="round"/>'
    if state == "gerando":
        r = 0.075 * u
        start, end = -0.62 * pi, -0.02 * pi
        return (f'<circle cx="{ex:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="none" stroke="url(#olho)" stroke-width="{0.05 * u:.1f}"/>'
                f'<path d="M{ex + r * cos(start):.1f} {y + r * sin(start):.1f} A{r:.1f} {r:.1f} 0 0 1 {ex + r * cos(end):.1f} {y + r * sin(end):.1f}" '
                f'fill="none" stroke="url(#tiktok)" stroke-width="{0.05 * u:.1f}" stroke-linecap="round"/>')
    if state == "pensando":
        x, y0, y1, thick, glint = ex + 0.05 * u, y - 0.1 * u, y, 0.14 * u, (0.08, -0.08)
    else:
        x, y0, y1, thick, glint = ex, y - 0.075 * u, y + 0.075 * u, 0.15 * u, (0.03, -0.06)
    return (f'<path d="M{x:.1f} {y0:.1f} L{x:.1f} {y1:.1f}" stroke="url(#olho)" stroke-width="{thick:.1f}" stroke-linecap="round"/>'
            f'<circle cx="{ex + glint[0] * u:.1f}" cy="{y + glint[1] * u:.1f}" r="{0.021 * u:.1f}" fill="#fff" opacity=".95"/>')


def face(state):
    dx = 0.02 * W if state == "pensando" else 0
    cheek = ".55" if state == "feliz" else ".32"
    parts = []
    for side in (-1, 1):
        parts.append(f'<ellipse cx="{CX + dx + side * 0.3 * W:.1f}" cy="{EYE_Y + 0.15 * W:.1f}" rx="{0.075 * W:.1f}" ry="{0.0375 * W:.1f}" '
                     f'fill="#FF7A99" opacity="{cheek}" filter="url(#bochecha)"/>')
        parts.append(eye(state, CX + dx + side * 0.19 * W))
    return "\n  ".join(parts)


def dots(state):
    size, gap, lit = 0.052 * W, 0.038 * W, 0.13 * W
    x, y = CX - (lit + 3 * size + 3 * gap) / 2, TOP + 0.875 * H - size / 2
    fill = "url(#tiktok)" if state == "gerando" else "#121217"
    out = [f'<rect x="{x:.1f}" y="{y:.1f}" width="{lit:.1f}" height="{size:.1f}" rx="{size / 2:.1f}" fill="{fill}" opacity="{1 if state == "gerando" else .78}"/>']
    x += lit + gap
    for _ in range(3):
        out.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{size:.1f}" height="{size:.1f}" rx="{size / 2:.1f}" fill="#121217" opacity=".16"/>')
        x += size + gap
    return "".join(out)


def character(state, dx=0):
    return f'''<g transform="translate({dx} 0)">{body()}
  {face(state)}
  {dots(state)}
</g>'''


def svg(content, width=400, height=600, background=None):
    bg = f'<rect width="100%" height="100%" fill="{background}"/>' if background else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">\n{DEFS}\n{bg}{content}</svg>\n'


STATES = ["normal", "feliz", "gerando", "pensando"]
for state in STATES:
    (HERE / f"slidi-{state}.svg").write_text(svg(character(state)))
sheet = "".join(character(s, dx=i * 400) for i, s in enumerate(STATES))
(HERE / "slidi-folha.svg").write_text(svg(sheet, width=1600, background=GRAPHITE))
print("ok")
