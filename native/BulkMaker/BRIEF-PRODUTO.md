# Brief: transformar o The Carousel Maker num produto vendável

Para: Codex. De: André (dono), com contexto preparado pelo Claude.
Escopo: tudo que falta pra uma pessoa desconhecida achar o app, assinar, instalar, ativar e usar. O Claude continua
refinando funcionalidades dentro do app em paralelo, então siga a seção "Não mexer" à risca.

## O que é o app

App nativo macOS (SwiftUI + AppKit, macOS 26+, Apple Silicon), em `native/BulkMaker`. Ele cria carrosséis em lote para
TikTok e Instagram com uma IA (Claude Code ou Codex CLI, usando a assinatura do próprio usuário) num terminal embutido.
Tem canvas infinito, calendário de posts, postagem automática no Instagram (WKWebView dentro do app) e pesquisa
escondida de contas virais no TikTok (`TikTokResearcher.swift`). O workspace da IA fica em
`~/Library/Application Support/The Carousel Maker/.bulk-maker`.

Já existe:
- `run-mac.sh`: build de desenvolvimento em `/private/tmp/BulkMaker-dev.app`.
- `release-mac.sh`: build release assinada com Developer ID (`Andre Souza (4ZQ8PBTL5U)`), hardened runtime,
  notarizada e grampeada, saída em `.zip`.
- `project.yml` (XcodeGen, Xcode Cloud).
- `website/`: página de lista de espera (Node + Supabase), em `npm start` → http://localhost:4173.

## Decisão de negócio

Assinatura mensal, não licença vitalícia. O app depende de coisas que quebram e exigem manutenção contínua (o site do
TikTok e o do Instagram mudam), e o concorrente direto (ScrollShow) também cobra por assinatura.
- Plano mensal + plano anual com desconto. Teste grátis de 7 dias (sem cartão, se o provedor permitir).
- Preço: deixar configurável num só lugar. O André define o valor.
- Provedor de pagamento: Lemon Squeezy (é o merchant of record: cuida de imposto e nota no mundo todo, aceita cartão
  brasileiro e gera license key ligada à assinatura, que é desativada sozinha quando a assinatura acaba). Escreva o
  módulo de licença atrás de um protocolo, pra trocar por Paddle ou Stripe sem mexer no resto do app.

## O que entregar, nesta ordem

1. **Licença no app**
   - Na primeira abertura, uma tela de ativação com dois caminhos: "Começar teste grátis" e "Já tenho uma chave".
   - Validação pela API de licenças do Lemon Squeezy (`activate`, `validate`, `deactivate`), com o `instance_id`
     deste Mac. A chave fica no Keychain, nunca em UserDefaults ou arquivo.
   - Revalida ao abrir e a cada 24 h. Sem internet, funciona por 7 dias desde a última validação boa. Depois disso,
     ou com a assinatura vencida, bloqueia as ações que geram valor (gerar lote, pesquisar, postar), mas deixa
     abrir e exportar o que já foi feito. Nunca apaga dados do usuário.
   - Em Ajustes: e-mail da conta, status do plano, data de renovação, "Gerenciar assinatura" (abre o portal do
     cliente) e "Desativar neste Mac" (libera a vaga pra outro Mac).
   - Limite de 2 Macs por assinatura.
2. **Ajustes do app (janela Settings com ⌘,)**
   - Conta e assinatura (item 1), IA padrão (Claude ou Codex), pasta padrão de saída, atualizações, "Enviar
     diagnóstico". Reaproveite o que já existe em `DesignPreferences` e `ProjectStore` em vez de duplicar.
3. **Primeira abertura (onboarding)**
   - Verifica se o `claude` ou o `codex` está instalado e logado. Se não estiver, explica em uma tela e mostra o
     comando de instalação com um botão de copiar. O app não funciona sem uma das duas: isso tem que ficar claro
     antes da pessoa pagar (também na landing page).
   - Pede só as permissões que o app realmente usa, no momento em que forem usadas.
4. **Atualização automática**: Sparkle 2, com appcast assinado (EdDSA) hospedado junto do site. O
   `release-mac.sh` passa a gerar a entrada do appcast.
5. **DMG de distribuição**: o `release-mac.sh` passa a gerar `The Carousel Maker-<versão>.dmg` (arrastar pra
   Aplicativos, com fundo simples) além do zip, assinado e notarizado. Versão vem de `VERSION`; build number
   automático.
6. **Site de vendas** (evoluir o `website/` atual, mantendo o visual)
   - Landing page: o que o app faz, para quem é, requisitos (Mac Apple Silicon, macOS 26+, assinatura do Claude ou do
     ChatGPT/Codex), preços, perguntas frequentes, termos de uso e política de privacidade.
   - Checkout do Lemon Squeezy. Depois de pagar, a pessoa recebe por e-mail a chave e o link do DMG.
   - Página de download que sempre aponta pra versão mais recente.
7. **Coisas obrigatórias pra vender**: termos de uso e política de privacidade (o app automatiza ações no TikTok e no
   Instagram da própria pessoa; diga isso com clareza), e-mail de suporte, página de reembolso, telemetria de crash
   opcional e com consentimento.

## Não mexer (o Claude está trabalhando nisso)

`TikTokResearcher.swift`, `CanvasTextTools.swift`, `InfiniteCanvasView.swift`, `CanvasPage.swift`,
`InstagramPage.swift`, `InstagramAutoPoster.swift` e o texto de `AgentSession.swift`. Se precisar ligar a licença
nessas telas, use um ponto único (ex.: `License.shared.canUse(.pesquisar)`) e me avise do ponto de integração em vez
de editar a lógica delas.

## Regras de trabalho

- Trabalhe numa branch `produto`. Commits pequenos, mensagem em português no estilo dos commits atuais
  (`feat(bulkmaker): ...`).
- O working tree tem mudanças não commitadas do André e do Claude: não reverta, não faça stash e não reformate
  arquivos que não são seus.
- Compile com `swift build --scratch-path /private/tmp/bulkmaker-build` antes de cada commit. Abra o app com
  `zsh run-mac.sh` para testar.
- Chaves de API e segredos ficam fora do repositório (`.env` no site, Keychain no app). Use o modo de teste do
  Lemon Squeezy até o André aprovar ir pro ar.
- O André tem TDAH: ao reportar, use uma frase do que foi feito, no máximo 3 bullets e um próximo passo. Faça e
  reporte, em vez de perguntar como fazer. Pergunte só o que for decisão dele (preço, nome do plano, textos legais
  finais) e junte essas perguntas numa só mensagem.

## O que depende do André

- Conta no Lemon Squeezy (e dados bancários pra receber).
- Preço mensal e anual.
- Credencial do notarytool (o comando está no topo do `release-mac.sh`).
- Domínio do site e e-mail de suporte.

## Atualização de escopo e integração (Codex, 16/10/2026)

Esta seção prevalece sobre a divisão anterior: onboarding e login de TikTok/Instagram nos Ajustes são do Claude.
Codex cuida de licença, Lemon Squeezy, Sparkle, DMG e site. A licença não apresenta onboarding automaticamente.

### Contrato para o paywall e as funcionalidades

Tudo abaixo roda no `@MainActor`. `License` é `ObservableObject`; observe a instância para atualizar a UI:

```swift
@ObservedObject private var license = License.shared

// Estados: .notStarted, .trial(until: Date), .active, .offline(until: Date), .locked(String)
let status = license.status
license.startTrial()           // 7 dias locais, sem cartão; não reinicia um teste anterior
license.startCheckout()        // abre o checkout configurado no navegador; nunca cobra dentro do app
license.showsActivation = true // abre a tela específica para chave/teste, sem onboarding
await license.activate(key: chave)

// Ações de interface: abre a ativação se for necessário.
guard license.require(.generateBatch) else { return }
// Serviços em segundo plano: não abrem modais; apenas não iniciam um novo trabalho.
guard license.canUse(.research) else { return }
guard license.canUse(.post) else { return }
// Estes dois permanecem disponíveis, inclusive com erro de Keychain ou licença vencida.
license.canUse(.openExisting)
license.canUse(.exportExisting)
```

O app inicia a revalidação ao abrir, repete depois de 24h e atualiza o estado durante a execução. Após falha
transitória, a última validação boa permite no máximo 7 dias offline; uma rejeição explícita bloqueia imediatamente.
Data Protection Keychain guarda chave, instance_id, último sucesso, revogação e histórico do teste na distribuição. No bundle `.dev`, um arquivo local privado (0600) evita o ACL instável da assinatura ad-hoc. A sessão do HTTP não usa cache em disco.
O teste local não é uma assinatura do Lemon Squeezy e não tem cobrança automática. Não protege contra apagar
intencionalmente o item no Keychain; controle de abuso entre instalações requer um serviço de testes no servidor.

### Pontos que o Claude deve ligar nos arquivos reservados

- `TikTokResearcher.research`: verificar `.research` antes de iniciar cada pesquisa. Em `pickUpRequest`, produzir
  uma resposta de erro para o pedido sem consumir a pesquisa quando não houver acesso.
- `InstagramAutoPoster.tick` e imediatamente antes de `publish`: verificar `.post`, sem desligar a preferência de
  agendamento nem modificar a agenda. Não iniciar novo post depois de expiração/revogação.
- `InstagramBrowser.startPost`: verificar `.post` antes do fluxo manual. A aba Postar já tem proteção externa,
  mas o serviço precisa da própria verificação para chamadas vindas de outros lugares.
- `AgentSession` e demais telas não foram alterados por Codex. O terminal compartilhado impede iniciar processos
  sem licença e encerra a sessão quando o acesso expira; o botão de gerar também verifica antes de preparar o lote.

**Enquanto esses guards internos não estiverem ligados, os timers de pesquisa/postagem já existentes ainda podem
executar trabalho em segundo plano. Esta integração é necessária antes de vender o app.**

### Configuração comercial pendente

`Sources/BulkMaker/Resources/LicenseConfiguration.plist` centraliza `environment`, `storeID`, `productID`,
`variantIDs`, `portalURL` e `checkoutURL`. O padrão é `test`, sem IDs nem links inventados; a ativação paga falha
com uma mensagem clara até configurar. Criar mensal/anual no painel de TESTE, habilitar chaves e definir exatamente
2 ativações em ambas as variantes. O app verifica loja, produto, variante e limite antes de ativar. Nenhuma API key
privada deve entrar no app. Os IDs de live são diferentes dos de teste: só trocar depois da aprovação do André.

A API pública de licenças não fornece `renews_at`. Ajustes mostra o e-mail/plano/uso/última validação e indica
consultar a renovação no portal, sem confundir `expires_at` com próxima cobrança. Uma data dentro do app depende
posteriormente de um endpoint autenticado do site que consulte a API privada de assinaturas no servidor.

Referências: [licenças](https://docs.lemonsqueezy.com/guides/tutorials/license-keys),
[portal](https://docs.lemonsqueezy.com/help/online-store/customer-portal),
[teste e live](https://docs.lemonsqueezy.com/guides/developer-guide/testing-going-live).

A licença não consulta nem migra o login Keychain legado. Todas as consultas ao Data Protection Keychain têm interação desativada, inclusive a tentativa manual; nenhum fluxo de licença pede a senha do login Keychain. O grupo estável é `4ZQ8PBTL5U.com.andrefelipe.carouselmaker`, declarado em `Xcode/CarouselMaker.entitlements`.

### Entregas seguintes: Sparkle, DMG e site

- Sparkle 2.10.0 está integrado ao SwiftPM/XcodeGen. A UI de atualizações fica na própria SettingsPage, e a busca
  manual no menu do app. Não há janela Settings separada. A ativação usa ModalBackdrop/ModalHeader/modalPanel,
  com o Slidi existente. `--license-preview` é uma opção somente de DEBUG para revisar esse modal.
- `updates.json` guarda só URL pública, chave EdDSA pública e nome da conta do Keychain para assinatura.
  A chave privada do Sparkle foi criada no Keychain da máquina, na conta `com.andrefelipe.carouselmaker.sparkle`.
  O cliente exige feed assinado e valida o arquivo antes da extração; a assinatura é gerada pelo generate_appcast.
- `VERSION` é a fonte da versão no pipeline SwiftPM, e o build é o timestamp UTC com segundos.
  `release-mac.sh` monta o framework preservando symlinks, assina de dentro para fora, notariza o app, gera ZIP
  e DMG com arrastar para Aplicativos, assina/notariza/grampeia o DMG e produz publish/appcast.xml + latest.json.
  `--preview` gera um pacote local ad-hoc verificável, sem manifesto de publicação nem promessa de notarização.
- Distribuição final depende do domínio/feed e de `PROVISIONING_PROFILE` Developer ID que autorize este App ID
  e seu grupo do Keychain, além da credencial `notarytool` carousel-maker. Os perfis locais existentes pertencem
  a outros apps. Um certificado Developer ID sozinho não autoriza os entitlements restritos do Keychain.
- O site usa `website/commerce.config.json` como fonte pública de planos/preços/IDs. Segredo do Lemon Squeezy só
  no `.env` do servidor. `scripts/configure-commerce.py --site-origin https://DOMINIO` gera o plist do app,
  updates.json e Xcode/Distribution.xcconfig com os mesmos dados, sem segredos.
- O endpoint de renovação descrito anteriormente já está implementado em `/api/license/subscription`; ao configurar
  `subscriptionURL`, o app apresenta `renews_at` real. Falha desse endpoint opcional não invalida uma licença boa.
- Site pronto para revisão local, sem publicação nem cobrança live. Faltam os preços, loja de teste, domínio,
  suporte e aprovação dos textos legais pelo André. As páginas legais são minutas identificadas como revisão;
  vendas permanecem desabilitadas até a configuração e aprovação. Telemetria de crash não foi adicionada nem ativada.

Execução: `swift test --scratch-path /private/tmp/bulkmaker-build`, `npm test --prefix website`,
`zsh run-mac.sh`, `zsh release-mac.sh --preview`. Não editar os arquivos reservados ao Claude para integrar guards:
continuam documentados acima e devem ser conectados antes da venda.
