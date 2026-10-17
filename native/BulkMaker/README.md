# BulkMaker para macOS

Fluxo visual com fotos, referências, CSV opcional e saída, além de canvas e calendário por projeto. O painel lateral abre Claude, Codex ou zsh no terminal integrado. A aba Postar está oculta e o publicador automático não inicia nesta versão.

O terminal recebe o perfil completo do produto do onboarding em `estado.md`, atualizado ao editar o perfil ou trocar de projeto. Esse contexto é obrigatório nas buscas e na criação. `pesquisar-tiktok` cruza a busca com o nicho e os termos do produto e importa os carrosséis automaticamente no canvas de origem, com @, visualizações, legenda completa, data, URL, métricas e texto editável de cada slide (OCR local). Downloads incompletos e texto não reconhecido são identificados. As instruções do terminal também exigem importar mídias obtidas por outros caminhos, sem esperar um pedido adicional.

O chat executa comandos de terminal e recebe o estado atual em `.bulk-maker/estado.md`. Além dos comandos de renderização e calendário, a ponte `carousel-render --app '<JSON>'` aplica ações na janela principal do app: navegar, selecionar entradas, ajustar variações e estilo, criar/abrir/renomear projetos e listar/editar/organizar/remover itens do canvas. Exemplo: `'{"action":"navigate","page":"canvas"}'`. `'{"action":"status"}'` retorna o projeto, as entradas, o estilo e as ações disponíveis. O guia completo fica em `.bulk-maker/sessao.md`.

A ponte devolve sucesso ou erro após executar, exige licença/teste ativo e recusa pedidos expirados ou enviados antes de uma troca de projeto. No canvas aberto, as edições pelo chat participam de Desfazer/Refazer. Comandos gerais de shell continuam sujeitos às permissões da CLI e do macOS.

Se você informar os caminhos à IA, ela pode preencher `.bulk-maker/selecao.json` (`photos`, `desired`, `csv`, `output`). O app valida os caminhos e atualiza os blocos automaticamente. Campos não escolhidos ficam `null`.

O bloco **Saída** verifica a pasta escolhida a cada poucos segundos, inclusive subpastas. Ele mostra a contagem de arquivos e imagens, miniaturas dos primeiros resultados e um botão para abrir a pasta no Finder.

No bloco **CLI + IA**, escolha de 1 a 20 variações completas, selecione Claude ou Codex e clique **Gerar com IA**. A CLI abre na lateral do terminal para acompanhar e continuar a conversa. As instruções incluem a quantidade, as pastas e a organização `variacao-01`, `variacao-02` etc.

Requer macOS 26+ e Xcode recente. Para compilar e abrir no Mac:

```sh
zsh native/BulkMaker/run-mac.sh
```

O CSV aceita vírgula ou ponto e vírgula, aspas, campos multilinha e UTF-8 com BOM. Ele é opcional neste fluxo.

## Site

A página de lista de espera fica em [`website/`](website/README.md), com headline, sub, email, @ do X e uma pintura da National Gallery of Art em ASCII no fundo. Para abrir, execute `npm start` nessa pasta e acesse http://localhost:4173.
