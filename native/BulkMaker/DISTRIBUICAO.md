# Distribuição do The Carousel Maker

## Configuração pública

Defina os planos em `website/commerce.config.json` e a versão em `VERSION`. Com o domínio escolhido:

```sh
python3 scripts/configure-commerce.py --site-origin https://DOMINIO
```

O comando gera a configuração pública de licença e atualizações para SwiftPM e Xcode. A API key do Lemon Squeezy
é exclusiva do `.env` do servidor. Use teste até o André aprovar live. A chave pública de atualizações já está em
`updates.json`; a privada permanece no Keychain. Não exporte nem coloque a chave privada no site.

## Assinatura Apple

O app de distribuição usa Data Protection Keychain com o grupo `4ZQ8PBTL5U.com.andrefelipe.carouselmaker`.
É necessário um perfil Developer ID válido para esse identificador, com Keychain Sharing autorizado. Configure
o App ID/perfil no Apple Developer ou deixe o Xcode gerir a assinatura para esse App ID. O script SwiftPM recebe
o caminho do perfil por `PROVISIONING_PROFILE`, valida seus entitlements e o embute no app.

O build `.dev` ad-hoc usa um arquivo `0600` em Application Support/The Carousel Maker/Development, separado da
licença de distribuição. Não usa nem tenta migrar o login Keychain antigo. Em produção, todas as consultas ao
Data Protection Keychain têm autenticação interativa desativada. Falha de armazenamento mantém leitura/exportação.

Configure o notarytool uma vez, no Terminal, fora do repositório:

```sh
xcrun notarytool store-credentials carousel-maker --apple-id EMAIL --team-id 4ZQ8PBTL5U
```

O comando da Apple coleta a credencial necessária sem registrá-la no código. Não envie senhas pela conversa.

## Gerar e publicar

```sh
PROVISIONING_PROFILE=/caminho/perfil.provisionprofile zsh release-mac.sh
```

A saída fica em `dist/<versão>-<build>/`: app, ZIP, DMG e pasta `publish`. O script só produz `publish` depois de
notarizar e grampear o app/DMG, verificar a assinatura e gerar o feed EdDSA. O Sparkle e o site devem apontar para
a mesma origem HTTPS. `publish` não sobe sozinho para a internet.

Hospede `website/` com Node e configure `RELEASES_DIR` para a pasta de publicação. Suba os arquivos versionados
antes de trocar `appcast.xml` e `latest.json`. Preserve as versões ainda citadas no feed. O cliente exige assinatura
do feed e do update, inclusive antes da extração. Não é suficiente servir um XML inventado com uma versão maior.

## Teste local do empacotamento

```sh
zsh release-mac.sh --preview
```

Produz app/ZIP/DMG ad-hoc em `dist/preview`, monta o DMG para definir as posições e o fundo e verifica seu checksum.
Não notariza nem cria feed/manifesto de publicação. Não distribuir essa prévia aos clientes.

## Pendências externas de validação

A compra de TESTE, e-mail com chave/DMG e ativação em dois Macs exigem a loja do André. A instalação de uma versão
antiga para uma nova via Sparkle exige domínio, perfil e notarização reais. Até isso existir, estão verificados o
build, as políticas de licença, os contratos HTTP com respostas simuladas, o site em navegador e o DMG local.
Um teste de Keychain da suíte Swift é pulado fora do host assinado: o executável do swift-test não tem o entitlement.

Documentação técnica: [Sparkle](https://sparkle-project.org/documentation/),
[Lemon Squeezy](https://docs.lemonsqueezy.com/api/checkouts/create-checkout),
[Data Protection Keychain](https://developer.apple.com/documentation/security/ksecusedataprotectionkeychain).
