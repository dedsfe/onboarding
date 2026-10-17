# Dia: inspeção local do onboarding

Data: 16/10/2026. App inspecionado: `/Applications/Dia.app`, versão 1.53.0, build 88760, bundle `company.thebrowser.dia`.

Inspeção somente de leitura da instalação. Os artefatos derivados foram gravados nesta pasta temporária. Nenhuma preferência, conta, sessão, histórico ou estado de onboarding foi alterado. Não houve instrumentação ou reinicialização do Dia.

## O que foi confirmado

### Dois módulos de introdução coexistem

- `BoostBrowser_OnboardingIntro.bundle`: logotipos, elementos de demonstração, fundo e efeitos sonoros individuais.
- `BoostBrowser_OnboardingIntro2.bundle`: 7 panoramas pintados, 2 camadas de nuvens, um elemento de primeiro plano (`Pole`), máscara elíptica, imagens de navegador e de boas-vindas.
- Cada panorama tem 4096 × 1096 pixels. A máscara possui variantes 818 × 980 e 1636 × 1960. Há imagens claras/escuras do navegador e da tela de boas-vindas.
- Os catálogos destes dois módulos apresentam imagens, vetores e cores, conforme inventários JSON ao lado deste relatório. Não foi localizado um vídeo completo da introdução nestes dois bundles.

Isso confirma a existência dos recursos, mas não determina qual variante está ativa para esta conta ou quais partes são substituídas por configuração remota.

### Composição e transições têm implementação nativa

O executável conserva nomes de tipos e caminhos de origem, embora não exponha o código-fonte Swift. Exemplos encontrados:

- `OnboardingIntroController`, `OnboardingIntroView`, `OnboardingIntroBackdropView`, `OnboardingIntroAnimationView`.
- `OnboardingIntro2Controller`, `OnboardingIntro2ViewModel`, `OnboardingIntro2View`.
- `DesktopToPaperCardStackTransitionView.swift`, `DesktopPaperWindowCardView`, `DesktopWindowPaperView`.
- `OnboardingPaintingWindow`, `ScalableBrandingView`, `DiaWelcomeView`.

Também estão presentes identificadores específicos de animação:

- `onboardingDesktopBorder`, `onboardingDesktopPaper`, `onboardingDesktopBrightness`.
- `captureFramePointsTopLeft`, `excludedApplications`.
- `onboardingBrowserCompanyPresentsBlur`, `onboardingBrowserCompanyPresentsTransform`.
- `onboardingDiaTitleBlur`, `onboardingDiaTitleTransform`.
- `onboardingPaintingBlur`, `onboardingPaintingTransform`.
- Referências a filtros de brilho e desfoque com parâmetros `inputBrightness`, `inputAmount` e `inputRadius`.

AppKit, SwiftUI, QuartzCore e AVFoundation são dependências do executável. Em conjunto com os tipos e recursos, esses indícios sustentam uma composição nativa que controla imagens, janelas, filtros e som. A simples presença das bibliotecas, isoladamente, não provaria que cada uma é usada nesta abertura.

### A trilha e os efeitos são separados

- `BoostBrowser_BoostSoundEffects.bundle/.../onboarding_intro_music.m4a`: 34,806712 segundos, AAC, estéreo, 44,1 kHz.
- O primeiro módulo tem sons separados `presents`, `chroma`, `fanfare`, `latch1…4`, `pop`, `shimmer1…4`.
- Há textos de acessibilidade para pular a animação e silenciar/reativar a música.
- A trilha ter cerca de 35 segundos não prova que a abertura tenha exatamente essa duração.

### A configuração é separada do espetáculo de abertura

Os recursos e nomes de código separam `OnboardingIntro`, `OnboardingIntro2`, `Onboarding`, `Unboxing`, `UnboxingUI` e `AuthFlow`. Há controladores próprios para importação, extensões, personalização, navegador padrão e encerramento.

`Unboxing` contém vídeos curtos claros/escuros de configuração do navegador padrão e de barra de endereço. Isso mostra que o produto combina técnicas conforme a necessidade; encontrar vídeos nessa parte não prova que a abertura seja um filme único.

`UnboxingUI` inclui a fonte `ABCOracle-Light.otf`. A presença do arquivo não determina a fonte de cada texto da introdução.

## Interpretação para o Carousel Maker

A referência mais útil é a continuidade espacial: desktop, cena artística, janela e formulário são tratados como partes de uma passagem, com controle de transformação, desfoque e som. As imagens pintadas são material da cena; o aplicativo controla a apresentação.

Uma solução original para o Carousel Maker pode usar uma pintura já licenciada para o app, conteúdo de carrossel e componentes nativos reais, com uma transição que desemboca no editor. O movimento da pintura e o aparecimento do carrossel podem explicar o produto antes de pedir configuração. Som deve ser opcional; pular e movimento reduzido precisam levar diretamente a um estado utilizável. Esta é uma proposta de direção, não uma tela implementada ou aprovada.

## Limites

- Não foi recuperado o código-fonte original.
- Não foram determinados os tempos, curvas de animação, árvore exata de views ou qual das duas introduções é apresentada nesta conta.
- Não foi concluído que as paisagens usam parallax só por existirem imagens em camadas. É uma hipótese a validar observando a execução.
- Não houve alteração do onboarding do Carousel Maker, que continua sob coordenação do Claude/André.
- Os recursos extraídos são referência local de análise; não foram incorporados ao produto ou ao site.
- O tutorial de George Cartridge encontrado na pesquisa anterior é uma reprodução independente; não é evidência da implementação interna do Dia.

## Evidências nesta pasta

- `camadas-dia.png`: painel com imagens reais extraídas do catálogo usando NSImage e ImageResource.
- `extracted/`: imagens individuais para inspeção.
- `*-asset-catalog.json`: metadados gerados por `/usr/bin/assetutil --info`.
- `asset-names.json`: inventário resumido.
- `binary-onboarding-symbols.txt`, `source-path-evidence.txt`: nomes e caminhos preservados no executável. Caminhos não significam que os arquivos-fonte estejam distribuídos.
- `extract-reference-images.swift`: script usado para ler os recursos da instalação.

A gravação pública de junho de 2025 analisada anteriormente está em `dia-opening-2025.mp4`. Ela representa outra data e não deve ser tomada como registro da versão instalada atual.