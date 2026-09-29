# BulkMaker para macOS

Etapa atual: um fluxo visual com pasta de fotos, pasta com referências do resultado desejado, CSV opcional para copy e pasta de saída. O bloco “CLI + IA” abre um terminal integrado na pasta do projeto. O painel lateral direito abre e fecha pela barra superior.

Ao abrir o terminal ou alterar uma entrada, o app atualiza `.bulk-maker/contexto.md` com os caminhos escolhidos e um guia para produzir o lote. No painel, o menu **IA** abre Claude ou Codex já com a instrução para ler esse arquivo. Também é possível abrir outro CLI manualmente; o botão de cópia fornece a instrução inicial. O app ainda não gera o lote por conta própria.

Se você informar os caminhos à IA, ela pode preencher `.bulk-maker/selecao.json` (`photos`, `desired`, `csv`, `output`). O app valida os caminhos e atualiza os blocos automaticamente. Campos não escolhidos ficam `null`.

O bloco **Saída** verifica a pasta escolhida a cada poucos segundos, inclusive subpastas. Ele mostra a contagem de arquivos e imagens, miniaturas dos primeiros resultados e um botão para abrir a pasta no Finder.

No bloco **CLI + IA**, escolha de 1 a 20 variações completas, selecione Claude ou Codex e clique **Gerar com IA**. A CLI roda em segundo plano, sem abrir a lateral do terminal; o bloco mostra execução, conclusão ou erro e permite interromper. As instruções enviadas à IA incluem a quantidade, as pastas e a organização `variacao-01`, `variacao-02` etc. A lateral continua disponível para uso manual.

Requer macOS 26+ e Xcode recente. Para compilar e abrir no Mac:

```sh
zsh native/BulkMaker/run-mac.sh
```

O CSV aceita vírgula ou ponto e vírgula, aspas, campos multilinha e UTF-8 com BOM. Ele é opcional neste fluxo.
