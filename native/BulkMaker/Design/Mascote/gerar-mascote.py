#!/usr/bin/env python3
"""Desenha o Slidi, mascote do The Carousel Maker: um post de TikTok em pé, com rosto na tela.
Gera um SVG por expressão (normal, feliz, gerando) e uma folha com as três lado a lado."""
from pathlib import Path

HERE = Path(__file__).parent
CYAN, PINK, INK, WHITE = "#25F4EE", "#FE2C55", "#121218", "#FFFFFF"


def eyes(expression):
    if expression == "feliz":
        # Olhos fechados de alegria: dois arcos ^ ^
        arc = lambda cx: f'<path d="M{cx-26} 300 Q{cx} 262 {cx+26} 300" fill="none" stroke="{WHITE}" stroke-width="11" stroke-linecap="round"/>'
        return arc(255) + arc(345)
    if expression == "gerando":
        # Olhos em anel de carregamento, girando quando animado
        ring = lambda cx: (f'<circle cx="{cx}" cy="292" r="27" fill="none" stroke="{WHITE}" stroke-opacity=".22" stroke-width="10"/>'
                           f'<path d="M{cx} 265 A27 27 0 0 1 {cx+27} 292" fill="none" stroke="{CYAN}" stroke-width="10" stroke-linecap="round"/>')
        return ring(255) + ring(345)
    eye = lambda cx: (f'<ellipse cx="{cx}" cy="292" rx="30" ry="37" fill="{WHITE}"/>'
                      f'<circle cx="{cx+6}" cy="298" r="17" fill="{INK}"/>'
                      f'<circle cx="{cx+12}" cy="289" r="6" fill="{WHITE}"/>')
    return eye(255) + eye(345)


def mouth(expression):
    if expression == "feliz":
        return f'<path d="M270 348 Q300 386 330 348 Z" fill="{PINK}" stroke="{WHITE}" stroke-width="6" stroke-linejoin="round"/>'
    if expression == "gerando":
        return f'<path d="M282 356 Q300 366 318 356" fill="none" stroke="{WHITE}" stroke-width="7" stroke-linecap="round"/>'
    return f'<path d="M276 350 Q300 374 324 350" fill="none" stroke="{WHITE}" stroke-width="7" stroke-linecap="round"/>'


def extras(expression):
    if expression == "gerando":
        # Faíscas de "criando imagem" em volta da cabeça
        spark = lambda x, y, s: (f'<path d="M{x} {y-s} Q{x} {y} {x+s} {y} Q{x} {y} {x} {y+s} Q{x} {y} {x-s} {y} Q{x} {y} {x} {y-s} Z" '
                                 f'fill="{CYAN}"/>')
        return spark(150, 190, 16) + spark(452, 168, 12) + spark(468, 250, 8)
    if expression == "feliz":
        return (f'<path d="M140 210 l10 -26 M122 226 l-26 -8 M150 236 l18 16" stroke="{PINK}" stroke-width="7" stroke-linecap="round"/>')
    return ""


def character(expression, dx=0):
    body = "M224 118 h152 a44 44 0 0 1 44 44 v340 a44 44 0 0 1 -44 44 h-152 a44 44 0 0 1 -44 -44 v-340 a44 44 0 0 1 44 -44 Z"
    return f'''<g transform="translate({dx} 0)">
  <ellipse cx="300" cy="626" rx="120" ry="16" fill="{INK}" opacity=".14"/>
  <!-- pernas -->
  <rect x="246" y="540" width="26" height="64" rx="13" fill="{INK}"/>
  <rect x="328" y="540" width="26" height="64" rx="13" fill="{INK}"/>
  <ellipse cx="252" cy="606" rx="30" ry="15" fill="{INK}"/>
  <ellipse cx="348" cy="606" rx="30" ry="15" fill="{INK}"/>
  <!-- braço esquerdo acenando -->
  <path d="M184 392 Q140 372 128 322" fill="none" stroke="{INK}" stroke-width="22" stroke-linecap="round"/>
  <circle cx="126" cy="312" r="20" fill="{INK}"/>
  <!-- corpo: o post, com o contorno glitch do TikTok -->
  <path d="{body}" transform="translate(-9 -7)" fill="{CYAN}"/>
  <path d="{body}" transform="translate(9 7)" fill="{PINK}"/>
  <path d="{body}" fill="{INK}"/>
  <!-- ilha dinâmica, o "chapéu" -->
  <rect x="264" y="138" width="72" height="20" rx="10" fill="#000"/>
  <!-- abas "Seguindo · Para você" como sobrancelhas -->
  <rect x="226" y="190" width="58" height="8" rx="4" fill="{WHITE}" opacity=".45"/>
  <rect x="300" y="190" width="74" height="8" rx="4" fill="{WHITE}"/>
  <rect x="322" y="204" width="30" height="5" rx="2.5" fill="{WHITE}"/>
  {eyes(expression)}
  <ellipse cx="226" cy="336" rx="15" ry="8" fill="#FF7A98" opacity=".8"/>
  <ellipse cx="374" cy="336" rx="15" ry="8" fill="#FF7A98" opacity=".8"/>
  {mouth(expression)}
  <!-- legenda do post -->
  <rect x="212" y="430" width="128" height="10" rx="5" fill="{WHITE}" opacity=".85"/>
  <rect x="212" y="450" width="84" height="10" rx="5" fill="{WHITE}" opacity=".55"/>
  <!-- bolinhas do carrossel -->
  <rect x="254" y="490" width="30" height="10" rx="5" fill="{WHITE}"/>
  <circle cx="298" cy="495" r="5" fill="{WHITE}" opacity=".45"/>
  <circle cx="316" cy="495" r="5" fill="{WHITE}" opacity=".45"/>
  <circle cx="334" cy="495" r="5" fill="{WHITE}" opacity=".45"/>
  <!-- braço direito segurando o coração do post -->
  <path d="M416 392 Q458 402 470 440" fill="none" stroke="{INK}" stroke-width="22" stroke-linecap="round"/>
  <path d="M474 482 C444 462 430 448 430 432 C430 418 442 410 454 410 C463 410 470 416 474 424 C478 416 485 410 494 410 C506 410 518 418 518 432 C518 448 504 462 474 482 Z"
        fill="{PINK}" stroke="{WHITE}" stroke-width="5" stroke-linejoin="round"/>
  {extras(expression)}
</g>'''


def svg(content, width=600, height=680, background=None):
    bg = f'<rect width="100%" height="100%" fill="{background}"/>' if background else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">{bg}{content}</svg>\n'


for expression in ["normal", "feliz", "gerando"]:
    (HERE / f"slidi-{expression}.svg").write_text(svg(character(expression)))
sheet = "".join(character(e, dx=i * 600) for i, e in enumerate(["normal", "feliz", "gerando"]))
(HERE / "slidi-folha.svg").write_text(svg(sheet, width=1800, background="#F4F1EC"))
print("ok")
