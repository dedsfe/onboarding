# The Carousel Maker: site

Página única: headline, sub, email, @ do X e botão para lista de espera. Monet em ASCII como fundo, sem galeria, navegação ou rodapé. HTML, CSS e JavaScript, com um servidor Node e SQLite ou Supabase. Não precisa instalar dependências. Requer Node 22.13 ou posterior com `node:sqlite`.

```sh
cd native/BulkMaker/website
npm start
```

Abra http://localhost:4173. `npm run dev` reinicia o servidor quando ele muda. As inscrições ficam em `data/waitlist.sqlite`, fora da pasta pública e ignoradas pelo Git. O mesmo email não cria duas inscrições. Não há envio automático de emails.

Para exportar a lista, use `npm run --silent export:waitlist > waitlist.csv`. Guarde o CSV fora da pasta `public`.

Para hospedar, use um servidor com Node e armazenamento persistente. Configure `HOST=0.0.0.0`, `PORT` e, se necessário, `DATA_DIR` para o volume persistente e `SITE_ORIGIN` para a origem pública. Uma hospedagem apenas estática não salva inscrições. O servidor limita o cadastro a 10 pedidos por minuto por IP; atrás de um proxy, configure também o limite no proxy, pois o servidor não confia em cabeçalhos de IP enviados pelo cliente.

## Lista de espera no ar (Cloudflare D1)

No Worker publicado, as inscrições vão para o banco D1 `carousel-waitlist` (binding `WAITLIST_DB` em `wrangler.jsonc`,
tabela em `migrations/0001_waitlist.sql`). O mesmo e-mail não entra duas vezes. Ver/exportar a lista:

```sh
npx wrangler d1 execute carousel-waitlist --remote --command "SELECT * FROM waitlist ORDER BY created_at"
```

Em 17/10/2026 o projeto Supabase antigo (`uknarv…supabase.co`) não existia mais, por isso a troca. Se o D1 não
estiver ligado, o Worker volta a usar o Supabase abaixo.

## Supabase

A integração está pronta, mas só é ativada com as credenciais do projeto.

1. Execute `supabase/migrations/202609300001_carousel_waitlist.sql` no SQL Editor do seu projeto.
2. Copie `.env.example` para `.env` e preencha `SUPABASE_URL` e `SUPABASE_SECRET_KEY` (`sb_secret_...`). O backend também aceita `SUPABASE_SERVICE_ROLE_KEY` legado.
3. Reinicie com `npm start`. O terminal informa `cadastros: supabase`.

A chave fica apenas no servidor. A tabela `public.carousel_waitlist` usa RLS e não permite acesso de `anon` ou `authenticated`. O servidor insere email e @ sem o prefixo e ignora emails duplicados. Se o Supabase falhar, o formulário mostra erro e não informa sucesso nem grava num banco local alternativo.

Sem essas variáveis, continua usando SQLite. Configurar apenas URL ou apenas chave interrompe a inicialização para evitar cadastros no banco errado. Registros locais anteriores não são migrados automaticamente. No Supabase, consulte e exporte a lista pelo Table Editor; o comando `export:waitlist` exporta somente o SQLite local.

O site precisa de hospedagem que execute o servidor Node, mesmo usando Supabase. Não há checkout ou envio automático de emails. Para verificar a integração com respostas simuladas e a persistência local, execute `npm test`. O Supabase real deve ser validado depois de aplicar a migration e configurar o projeto.

## Arte e tipografia

Fundo ASCII estático em `public/assets/monet-ascii.svg`, gerado a partir de Claude Monet, *Banks of the Seine, Vétheuil*, 1880, da National Gallery of Art. Créditos preservados no SVG e no código HTML. Obra: https://www.nga.gov/artworks/46652-banks-seine-vetheuil. Política: https://www.nga.gov/artworks/free-images-and-open-access. O fundo não depende de JavaScript.

Título em Gambarino, da Indian Type Foundry / Fontshare, hospedada localmente. Licença distribuída em `public/assets/FONT-LICENSE.txt`. Corpo em fonte nativa do sistema. Na ausência de JavaScript, o fundo ASCII e o formulário continuam funcionando.

## Venda, licença e distribuição (16/10/2026)

O site agora tem landing page, exemplos renderizados pelo motor nativo, mensal/anual, requisitos claros, FAQ,
download e documentos legais em revisão. O visual original (Monet em ASCII e Gambarino local) foi preservado.
O formulário de lista de lançamento continua com SQLite/Supabase e funciona sem JavaScript.

### Configurar a loja de teste

1. Defina os valores **públicos** em `commerce.config.json`: loja/produto, IDs mensal e anual, preços em centavos,
   moeda da loja, subdomínio e suporte. Este é o único arquivo de preços do site. Crie mensal/anual no Lemon Squeezy
   com esses valores, assinatura recorrente, chaves habilitadas e **2 ativações**. O checkout confere produto, preço,
   moeda, periodicidade, modo de teste e limite antes de criar o link. O anual precisa ter desconto sobre 12 mensais.
2. Guarde `LEMON_SQUEEZY_API_KEY` de TESTE no `.env`, somente no servidor. Configure `SITE_ORIGIN` HTTPS.
   O app nunca recebe essa chave. Nenhum segredo, `.env`, banco ou exportação deve ser commitado.
3. Revise os documentos de termos/privacidade/reembolso com o responsável. `legalApproved` e `enabled` começam
   como `false`; enquanto a configuração não estiver pronta, os botões ficam desabilitados e o site usa a lista.
4. Do diretório BulkMaker, execute `python3 scripts/configure-commerce.py --site-origin https://DOMINIO`.
   Isso gera o plist público do app, o endereço de atualização e o xcconfig. Não lê nem copia a API key.
5. Faça uma compra de teste e confira o e-mail do Lemon Squeezy com chave e botão de download. O checkout configura
   `receipt_link_url` e `redirect_url` para `/download`. Confirme também no painel que a emissão de licença está
   habilitada nas duas variantes. O recibo e a licença são enviados pelo provedor, não por um servidor SMTP deste site.

`POST /checkout/monthly` e `/checkout/annual` funcionam por formulário (303) ou JSON (retornam URL).
Não aceitam valor/ID enviado pelo navegador. O padrão é `environment: "test"`; live exige também a variável
`LEMON_ALLOW_LIVE=true`, que só deve ser definida após aprovação do André. O checkout hospedado mantém os dados
do cartão fora do app e deste servidor. A implementação usa os campos legados de preço da variante que a API
mantém por compatibilidade; ao migrar para preços por uso, trocar a verificação para a API de Prices.

`POST /api/license/subscription` recebe chave + instance_id no corpo, valida ambos na API pública e consulta a
assinatura no servidor por loja + order_item_id + cliente. Retorna só status e próxima renovação. Não persiste
chaves nem retorna a chave privada. O app usa esse endpoint opcionalmente: se ele falhar, a validação direta da
licença continua valendo e a renovação pode ser consultada no portal.

### Publicar uma distribuição já verificada

`RELEASES_DIR` aponta para a pasta `publish` produzida por `release-mac.sh`. Ela contém `latest.json`, `appcast.xml`
e `releases/*.dmg`. Os arquivos só são produzidos para publicação depois de assinatura, notarização e stapling.
Não copie `dist/preview` para o servidor. O modo de prévia não gera manifesto nem appcast de publicação.

- `/download` apresenta versão/requisitos e instalação.
- `/download/latest` redireciona para o DMG do manifesto atual, sem cache desse redirecionamento.
- `/api/releases/latest` retorna os dados da versão publicada. Sem versão válida, retorna 503.
- `/appcast.xml` serve o feed assinado pelo Sparkle. `/releases/*.dmg` usa streaming, HEAD e Range para retomada.

Em cada release, suba o DMG versionado primeiro, depois troque appcast e manifesto juntos/atomicamente. Preserve
os DMGs das versões que permanecerem no feed. O site verifica a existência, o tamanho e o marcador de notarização
do manifesto; a assinatura e a integridade são garantidas pelo pipeline/Sparkle, não por re-hash a cada download.
O checksum SHA-256 aparece na página para conferência manual.

### Validação local

`npm test` cobre persistência, checkout de teste, bloqueio de live, divergência de preço/produto/moeda/instâncias,
renovação autenticada, manifesto, rotas HTTP, streaming parcial e formulário. As chamadas de pagamento nesses testes
são simuladas. A compra real de TESTE depende da conta/configuração do André.

Os exemplos `sample-01.jpg` a `sample-03.jpg` foram produzidos pelo `carousel-render` sobre o mesmo Monet de domínio
público já usado no site. São exemplos de saída, sem métricas, depoimentos ou clientes inventados.
