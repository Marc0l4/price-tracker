# Arquitetura — Milestone 1

`ProductSearchService` conhece apenas o contrato `ProductProvider`. Cada provider
é responsável pela chamada HTTP, validação da resposta externa e mapeamento para
o modelo normalizado. Portanto, um novo provider é adicionado como outro adaptador,
sem alterar o serviço de busca nem o formato interno.

Fluxo: `query → ProductSearchService → ProductProvider → HTTP → Zod → mapper → resposta normalizada`.

O resultado de uma busca do Mercado Livre é uma publicação/oferta. Neste primeiro
incremento ela é representada como um produto normalizado provisório com uma oferta.
A futura resolução de produtos canônicos não faz parte deste milestone.

## Milestone 2.1 — Amazon Brasil

`AmazonProvider` depende de `AmazonSearchClient`, que retorna `AmazonSearchItem`.
`ScavioAmazonClient` implementa essa interface: faz a chamada HTTP, valida o
payload externo com Zod e traduz seus campos para o tipo interno Amazon. Um cliente
oficial futuro pode implementar a mesma interface sem alterar o provider, o
serviço de busca ou os tipos de domínio.

Um produto encontrado sem preço ou moeda permanece em `products` com `offers: []`.
Isso significa identidade observada sem oferta válida; não significa preço zero,
indisponibilidade nem equivalência com outro produto. Product Matching deverá
tratar `offers: []` explicitamente.

## Mercado Livre temporariamente via Scavio

`MercadoLivreProvider` recebe `MercadoLivreSearchClient`. O cliente Scavio valida
seu payload com Zod e traduz os campos para `MercadoLivreSearchItem`; o mapper
constrói `NormalizedProduct` com `provider: "mercadolivre"`. A integração direta
com `api.mercadolibre.com` permanece em `OfficialMercadoLivreClient`, experimental.
Uma troca de cliente não altera o serviço agregador ou o contrato de provider.

Os clientes Scavio compartilham `ScavioRequestLimiter`, uma fila em memória por
chave. O serviço agregador continua iniciando providers em paralelo; apenas as
operações Scavio com a mesma chave aguardam sua vez. O timeout de cada cliente
começa quando sua operação recebe a vez. A fila vale por processo; múltiplos
processos exigiriam um limite compartilhado no futuro.

Quando `product_id` existe, ele identifica o produto encontrado; `item_id`
identifica a oferta. Sem `product_id`, usa-se `item_id` como identidade provisória.
Preço ou moeda ausente mantém o produto com `offers: []`. A busca Scavio pode
exibir preço Pix, que não deve ser confundido com o preço regular da ficha.

## Milestone 3 — Product Matching em memória

`matching/` recebe somente `NormalizedProduct[]`, sem acesso aos providers ou
payloads externos. `ProductMatcher` compara pares e retorna score, confiança,
motivos e conflitos; `ProductMatchingService` forma grupos temporários. A inclusão
em um grupo exige match com todos os seus membros, para evitar união transitiva
de variantes incompatíveis. Os IDs de grupo são locais à execução.

Normalização: caixa baixa, acentos e pontuação normalizados, espaços reduzidos,
`128GB` equivalente a `128 GB`, termos em ordem diferente comparados por tokens.
Ruído removido apenas quando conhecido (por exemplo `distribuidor autorizado`).
GTIN é usado apenas com tamanho e dígito verificador válidos. Cores diferentes,
capacidades diferentes, marcas diferentes e modelos/versões diferentes bloqueiam
match. Cor e capacidade presentes em apenas um lado deixam a comparação sem
evidência suficiente, salvo quando um GTIN válido igual sustenta o match.

Score: GTIN igual +100; marca igual +20; modelo essencial igual +40;
capacidade igual +30; cor igual +10; nome essencial equivalente +20. Conflitos
críticos vencem qualquer score. Sem GTIN igual, exige-se modelo essencial igual,
atributos de variante completos e score mínimo de 70. A comparação O(n²) é uma
escolha consciente para poucas dezenas de resultados; não há persistência.

Limitações: a extração inicial reconhece apenas capacidades e cores listadas no
código, e a inferência de marca pelo título cobre Apple e Samsung. Tamanhos de
tela e outras variantes ainda não são extraídos. Ausência de atributo em ambos
os lados não comprova equivalência; o matcher exige evidência suficiente das
demais regras. Os grupos dependem da ordem de entrada quando há pares
incompatíveis ligados por um terceiro item, e seus IDs não são estáveis entre
buscas. Antes de persistir grupos, essas ambiguidades precisarão de revisão.

## Milestone 3.1 — Hardening do matching

O modelo base continua vindo de `model` quando disponível, mas o título sempre
é analisado separadamente. Versões explícitas (Pro, Pro Max, Plus, Max, Mini,
FE, Ultra, Slim, Lite, SE e geração numérica), tamanho em polegadas, marcadores
de kit/acessório e condição são comparados antes de permitir a união. Condição
em apenas um lado é conflito: sem informação da outra fonte não se presume que
seja o mesmo estado. Termos de título ainda não reconhecidos são tratados como
qualificadores quando existe `model` explícito; diferenças bloqueiam a união.
Somente o ruído conhecido `distribuidor autorizado` é removido.

Capacidade de armazenamento e RAM são extraídas separadamente por contexto;
`1TB` e `1024GB` equivalem a `1tb`. Sem contexto, apenas capacidades de
armazenamento da lista limitada são interpretadas. Midnight e Starlight são
cores distintas; Black/Preto e Blue/Azul continuam equivalentes. GTIN aceita
apenas dígitos com espaços/hífens simples e checksum válido.

O score mantém pesos anteriores e acrescenta RAM igual +15 e tamanho igual
+20. Atributos de variante ausentes em ambos não pontuam. Sem GTIN igual,
exige-se modelo base igual, ao menos uma variante positiva (armazenamento, RAM,
cor ou tamanho), nenhuma variante presente em apenas um lado e score >= 70.
`high` sem GTIN exige armazenamento e cor explicitamente iguais, além de score
>= 100; os demais matches são `medium`. `missingEvidence` registra ausências.

O agrupamento ainda exige match com todos os membros e ainda depende da ordem
de entrada em casos ambíguos. Dentro de um grupo, mesmo provider + mesmo
`externalId` ou `externalOfferId` é deduplicado e ofertas distintas são
preservadas. Produtos sem oferta não carregam identidade do provider e não
podem receber essa deduplicação por origem. IDs `group-N` continuam temporários.
As regras são deliberadamente limitadas: outras categorias, condições e cores
podem exigir novos extratores antes de usar grupos como identidade persistente.

## Milestone 4 — Fundação de persistência

`ProductPersistenceService` recebe produtos normalizados com origem explícita
(`provider`) e um contexto de coleta (`collectionKey`, `collectedAt`). A origem
no envelope é necessária para produtos com `offers: []`. O serviço agrupa com
`ProductMatchingService`, usa `PersistenceDecision` para classificar os grupos
e grava cada grupo em uma transação PostgreSQL por meio de quatro repositórios Prisma.
O serviço de busca e o matcher não conhecem Prisma.

`CanonicalProduct` tem UUID gerado no banco e `matchStatus` confirmed,
provisional ou review_required. `ProviderProduct` guarda origem e identidade
externa, pode apontar para um canônico e mantém seu próprio status de vínculo.
`Offer` guarda URL, loja e disponibilidade, sem preço corrente. Cada coleta de
preço vira `PriceObservation` imutável, com Decimal(19,4), moeda, frete quando
disponível e instante de coleta distinto das datas de criação/atualização.

Confirmed exige pelo menos dois providers, GTIN válido igual em todos os
produtos do grupo e nenhuma ambiguidade no lote. Grupos sem essa prova são
provisional. Se um produto combina com outro grupo, se registros existentes
apontam para canônicos diferentes, ou se um canônico confirmado receberia um
novo vínculo sem prova forte, o estado é review_required. Novos itens sob
revisão recebem candidatos canônicos separados; associações existentes não
são fundidas automaticamente. Uma divisão posterior de grupo antes unido
também marca revisão. Revisão não é promovida automaticamente.

Unicidade `(provider, externalId)` identifica ProviderProduct e
`(provider, externalOfferId)` identifica Offer. Uma oferta não é transferida
silenciosamente entre produtos externos. A chave de idempotência da observação
é `(offerId, collectionKey)`: repetir a mesma coleta retorna a observação
anterior; a mesma chave com dados diferentes falha e reverte a transação.
Uma nova `collectionKey` cria nova observação, mesmo se o preço não mudou.
`shippingAmount` fica nulo porque o tipo normalizado ainda não traz valor
numérico de frete; `shippingIsFree` é preservado quando conhecido.
Uma trigger no PostgreSQL rejeita UPDATE e DELETE de observações; as chaves
estrangeiras de Offer e PriceObservation restringem exclusão em cascata do
histórico. O reset dos testes usa TRUNCATE somente no banco isolado.

Os testes de persistência iniciam um PostgreSQL local efêmero, aplicam a
migration real e encerram o banco ao final. Não há chamadas externas. Grupos
e IDs temporários não são persistidos. Limitações: ordem de agrupamento ainda
afeta ambiguidades, a origem de produtos sem oferta deve vir do envelope, e
não há decisão humana ou revisão automática do estado `review_required`.

## Milestone 4.1 — Hardening da persistência

A entrada da persistência é `SourcedProduct[]`, portanto a origem não depende de
`offers[0]`. O contexto contém `collectionKey`, `collectedAt` e a lista explícita
de providers que responderam com sucesso. `collectionKey` identifica uma execução
lógica: retries reutilizam a chave; uma coleta nova recebe outra chave, mesmo se
preço e instante coincidirem. Ela não é derivada somente de timestamp.

O lote é normalizado antes do matching. Duplicatas equivalentes de
`provider + externalId` são consolidadas e suas ofertas distintas são reunidas.
Duplicatas com identidade ou oferta conflitante falham como uma unidade, sem
impedir os outros grupos. Cada grupo lógico é persistido em sua própria transação,
com espera máxima de 5 s e execução máxima de 10 s. O retorno separa `succeeded`,
`failed` e o resultado do lifecycle por provider; sucesso parcial nunca é
apresentado como sucesso total.

Identidades externas são protegidas por advisory locks ordenados. A atualização
de `ProviderProduct` é monotônica por `lastObservedAt`, impedindo uma coleta antiga
concorrente de sobrescrever atributos mais novos. Offers usam upsert atômico e
PriceObservations usam `INSERT ... ON CONFLICT DO NOTHING`; depois de uma colisão
idempotente, os dados existentes são comparados. A constraint
`UNIQUE(offerId, collectionKey)` continua sendo a proteção final.

Toda alteração de atributos de um membro faz o status do canônico ser recalculado
com todos os `ProviderProduct` persistidos, sem chamada externa. Dois ou mais
providers com o mesmo GTIN válido e sem conflito podem ser `confirmed`. Conflito
explícito vira `review_required`; perda de evidência vira `provisional`.
`review_required` é conservador e não é promovido automaticamente. O banco proíbe
`confirmed` sem `canonicalProductId`.

Offer não guarda preço atual. Quando aparece, `isActive = true`, `lastSeenAt`
recebe o instante observado e `lastCheckedAt` registra a coleta mais recente que
avaliou seu estado. Após resposta válida e completa de um provider, ofertas não
vistas ficam inativas; se o provider falhar ou alguma unidade desse provider
falhar na persistência, o lifecycle é ignorado. Coletas antigas não revertem um
estado mais novo. Reaparecimento reativa a oferta. Nenhuma dessas operações apaga
PriceObservation.

`successfulProviders` significa que o lote representa uma resposta completa do
provider dentro da unidade de coleta coordenada pelo chamador. Não se deve misturar
buscas parciais independentes do mesmo provider no mesmo lifecycle; um futuro
scheduler terá de definir essa unidade de escopo antes de chamar a persistência.

Produto com `offers: []` atualiza sua identidade, mas não cria preço zero,
Offer ou PriceObservation. Offers anteriores desse produto ficam protegidas:
ausência de preço não é interpretada como indisponibilidade.

Split e merge são possíveis por reassociação de ProviderProduct; Offer e
PriceObservation permanecem ligados ao produto externo e não são copiados nem
apagados. Canônicos abandonados após merge ficam identificáveis por não possuírem
membros, mas ainda não há limpeza automática. Coletas independentes que nunca
compartilham uma associação externa ainda podem criar canônicos duplicados; não
há chave canônica frágil baseada em nome/modelo.

Moeda fica em cada observação e consultas estatísticas devem agrupar ou filtrar
por `currency`; BRL e USD nunca formam a mesma média, mínimo ou máximo. Não há
conversão cambial. `collectedAt`, `lastSeenAt`, `lastCheckedAt` e
`lastObservedAt` são `TIMESTAMPTZ`; o chamador deve fornecer um `Date` válido
construído a partir de instante com timezone/offset explícito. Datas futuras não
são rejeitadas neste incremento porque tolerância de relógio ainda não foi
definida.

As validações de entrada rejeitam strings vazias, preço não positivo e currency
fora de três letras maiúsculas. CHECK constraints repetem somente invariantes
críticas contra qualquer outro escritor do banco. Prisma fornece tipos e relações;
as regras de lote, lifecycle e canonicalização permanecem no serviço.

Os testes de persistência usam PostgreSQL real. A ordem é: `TEST_DATABASE_URL`
explicitamente apontando para database/schema com nome de teste;
`TEST_POSTGRES_BIN`; binários PostgreSQL instalados; e pacote efêmero como fallback.
Cada execução cria um cluster temporário, aplica `prisma migrate deploy`, testa
constraints, Decimal, trigger, concorrência e transações, e remove o cluster.

## Milestone 5 — Coleta periódica

`TrackedSearch` representa uma query monitorada. Sua query é normalizada (trim,
espaços reduzidos e caixa baixa) e é única; buscas inativas não são executadas.
Uma `CollectionRun` é criada para cada execução de uma query, com trigger
`manual` ou `scheduled`. Seu UUID também é a `collectionKey` oficial usada nas
PriceObservations. Assim, retry da mesma run preserva chave e instante lógico;
uma run nova sempre gera chave nova, mesmo com o mesmo preço.
`startedAt` permanece como instante lógico original, enquanto `attemptStartedAt`
mede a duração da tentativa atual.

`ProviderCollectionRun` registra uma tentativa por provider e por attempt, com
início, fim, duração, quantidade de produtos e código seguro de erro. A run
guarda query, status, contagens de produtos/grupos e duração. `completed` exige
todos os providers bem-sucedidos e persistência sem falhas; `partial` indica
falha de provider ou de algum grupo persistido; `failed` indica que nenhum
provider completou ou o timeout global foi atingido.

Fluxo: `CollectionScheduler → CollectionOrchestrator → ProductSearchService →
providers → ProductMatchingService (métrica) → ProductPersistenceService → banco`.
O scheduler não conhece Prisma, providers, Scavio, matching ou entidades de
preço. O orchestrator usa busca detalhada por provider e só inclui em
`successfulProviders` uma chamada que resolveu integralmente: HTTP e schema
válidos, parsing concluído e sem timeout/erro. Atualmente os providers não têm
paginação; quando ela existir, a chamada só poderá resolver após todas as páginas
serem processadas. Timeout, HTTP não-2xx, schema inválido, parsing ou paginação
incompleta equivalem a falha e nunca habilitam lifecycle.

O lifecycle agora é limitado à query monitorada por `TrackedSearchOffer`. A mesma
Offer pode ser encontrada por mais de uma query; cada escopo mantém sua própria
presença. Uma Offer global só fica inativa quando não está ativa em nenhum escopo
monitorado conhecido. Isso evita que a ausência em `iphone 15` inative uma oferta
que ainda apareceu em `galaxy s24`. Resposta completa com oferta ausente inativa
apenas aquele escopo; falha do provider não muda nenhuma presença.

O scheduler usa `setInterval` configurado por `COLLECTION_INTERVAL_MINUTES`.
Ele protege ticks sobrepostos e o orchestrator protege execução simultânea da
mesma TrackedSearch entre manual e scheduler. TrackedSearches distintas podem
ser executadas no mesmo processo; o limiter Scavio singleton continua serializando
Amazon e Mercado Livre que compartilham chave. Esta proteção é exclusivamente
single-process: duas instâncias da aplicação ainda exigirão lock distribuído.

`COLLECTION_TIMEOUT_MS` limita a etapa de busca da run; os timeouts específicos
dos providers e transações de persistência permanecem suas próprias proteções.
Uma run antiga em `running` pode ser recuperada por `recoverInterruptedRuns`, que
a marca como `failed/interrupted`; scheduler e CLI chamam essa recuperação na
inicialização. O timeout não persiste resultados tardios da busca que expirou.

O comando manual é `npm run collect -- "iphone 15"`. Ele cria ou reutiliza a
TrackedSearch, cria uma CollectionRun manual e produz somente log estruturado
com identificadores, status, duração e contagens; nunca registra credenciais,
headers, payloads externos completos ou DATABASE_URL.

## Milestone 6 — Historical Price Analytics & Read API

`read/` é uma camada somente de leitura: `ProductQueryService` consulta catálogo
canônico e `PriceHistoryService` calcula histórico e analytics sobre PostgreSQL.
Ela não chama providers, scheduler ou serviços de escrita. A API REST usa
`node:http`, mantendo cinco endpoints read-only sem introduzir framework:

- `GET /products?query=&page=&limit=&currency=&sort=history|price`
- `GET /products/:id`
- `GET /products/:id/offers?currency=`
- `GET /products/:id/history?period=30d|90d|180d|all&currency=` ou `from`/`to`
- `GET /products/:id/analytics?period=&currency=`
- `GET /offers/:id/history?period=&currency=`

Preço atual de Offer é sua PriceObservation mais recente. Preço atual do produto
é a menor dessas observações entre Offers ativas na mesma moeda. Offer inativa
fica fora de preço atual e melhor oferta, mas continua integralmente no histórico
e, portanto, pode compor mínimo/máximo/média históricos.

Valores monetários são calculados com Decimal no banco/aplicação e serializados
como strings com quatro casas; a API nunca soma ou calcula média entre moedas.
Analytics e history recebem currency, com BRL como default HTTP. Produto detalhado
expõe Offers ativas por moeda, sem eleger uma melhor Offer entre currencies.

Histórico retorna observações completas enquanto o recorte tiver até 500 pontos,
independentemente do período solicitado; assim uma alteração recente não some ao
ampliar de 30 para 90, 180 dias ou todo o histórico. Acima desse limite, usa
buckets diários até 180 dias e semanais para `all`. Cada bucket contém mínimo,
máximo, média, última observação e quantidade; o gráfico mostra o último preço e
a faixa mínimo/máximo quando houver agregação. `from` e `to` são inclusivos; data
sem horário usa UTC, início do dia para `from` e fim do dia para `to`.

Classificação é interpretativa, não previsão: com ao menos duas observações,
preço atual <= 95% da média é `low`, >= 105% é `high` e o intervalo restante é
`normal`; sem dados, preço atual ou volume suficiente é `insufficient_data`.
As agregações, preço atual e buckets são queries PostgreSQL parametrizadas. O
índice existente `(offerId, collectedAt)` atende séries por Offer; a migration de
leitura adiciona `(providerProductId, isActive)` para Offers atuais. Busca textual
usa `ILIKE`/contains via Prisma e não possui índice full-text nesta fase.

## Milestone 7 — Frontend MVP

```text
Next.js App Router (apps/web)
  → lib/api (base URL, parsing e ApiError)
  → API REST read-only
  → ProductQueryService / PriceHistoryService
  → PostgreSQL
```

As páginas client-side usam uma única camada HTTP e tipos próprios da resposta
REST. A home consulta apenas `GET /products` e preserva query, resultado, página e
ordenação somente na sessão atual. A ordenação ocorre no PostgreSQL antes da
paginação: `history` usa quantidade de `collectionKey` distintas por produto,
depois preço atual; `price` usa menor preço atual. Produtos sem preço ficam no
fim e empates usam nome/identificador. A
página de produto consulta detalhe, analytics, history e offers; analytics e
histórico são recarregados somente quando o período selecionado muda. O frontend
não importa Prisma, não chama providers e não executa matching ou classificação:
apenas traduz o valor de analytics retornado pela API para linguagem amigável.

Recharts recebe valores numéricos somente na fronteira de renderização para
coordenadas; preços continuam strings no client HTTP. Buckets expõem mínimo,
máximo, média e última observação no tooltip. Offers inativas não chegam na rota
de offers atuais e não são mostradas, enquanto o gráfico preserva fatos passados.

## Milestone 8 — UX Polish

- Busca e paginação não são serializadas na URL nem em storage: recarregar a
  Home sempre retorna a `/` com estado vazio.
- O frontend usa tokens leves de estilo, header compartilhado, fallback acessível
  de imagem, cards responsivos e badges textuais de classificação. Essas mudanças
  não alteram os contratos HTTP ou regras de analytics.

## Milestone 9 — CI e preparação de produção

- O bootstrap carrega ambiente antes da composição. A configuração de leitura
  valida `DATABASE_URL`, `API_PORT` e `CORS_ORIGIN`; a de coleta só exige
  `SCAVIO_API_KEY` quando coleta/scheduler é montado.
- A Read API expõe `GET /health`. Ela executa `SELECT 1` e responde `200/ok` ou
  `503/degraded` sem expor detalhes do banco.
- CORS é uma origem explícita (`CORS_ORIGIN`), nunca `*`; headers básicos de
  proteção acompanham respostas JSON.
- A API de produção é JavaScript compilado em `apps/api/dist`. SIGINT/SIGTERM
  interrompem scheduler, fecham HTTP e desconectam Prisma.
- `COLLECTION_SCHEDULER_ENABLED` é falso por padrão. Uma única réplica pode
  habilitá-lo; réplicas de leitura devem mantê-lo desligado.
- CI usa PostgreSQL 16 como service container e executa `prisma migrate deploy`,
  testes e builds sem chave Scavio. Docker separa API, web e migration one-shot.

## Milestone 9.1 — Dependências e limites operacionais

O frontend usa Next.js 16 com React 19 e continua sendo construído como artefato
standalone. Tailwind é transformado por configuração PostCSS explícita no pacote
web. A API usa Zod 4 para validar configuração e payloads externos sem permitir
que formatos de providers cruzem a fronteira de domínio.

Prisma 6 permanece a única dívida de dependência de produção conhecida: a cadeia
de CLI/configuração contém `deepmerge-ts` vulnerável. A camada de execução não
aceita configuração Prisma fornecida por requisições HTTP, mas o upgrade para
Prisma 7 é uma alteração arquitetural separada, pois introduz ESM e adapter de
banco. As migrations e contratos atuais não foram alterados por esta revisão.

## Fronteira de configuração Web e futura migração Prisma 7

O bundle web lê `NEXT_PUBLIC_API_BASE_URL` por acesso estático direto, requisito
para substituição em build pelo Next.js. Objetos de ambiente continuam aceitos
somente como override explícito de teste; nenhuma URL de produção ou Docker é
usada como fallback no navegador.

A futura migração Prisma 7 deve introduzir uma única factory de infraestrutura
para `PrismaPg` e `PrismaClient`. Repositories e domínio continuarão recebendo o
client por injeção e não conhecerão adapter, URL ou pool. A conversão para ESM e
o novo client gerado devem ocorrer no mesmo incremento para não depender de uma
ponte CommonJS não documentada como arquitetura permanente.

## Milestone 9.3 — Prisma 7

- A API foi convertida para ESM/NodeNext sem alterar o frontend. Imports relativos
  da API usam extensão `.js`, compatível com TypeScript em desenvolvimento e com
  o JavaScript emitido para produção.
- `prisma.config.ts` vive na raiz do monorepo, carrega `.env` explicitamente e
  aponta para `apps/api/prisma/schema.prisma` e suas migrations. O schema preserva
  modelos, relações, índices, enums e `Decimal(19,4)`; apenas a URL saiu da
  datasource e o generator mudou para `prisma-client` com output explícito.
- O client é gerado em `apps/api/src/generated/prisma` e não é versionado. Builds,
  CI e setup local executam `prisma generate` antes de consumir esse output.
- `createPrismaClient(databaseUrl)` é a composition root do banco. Ela cria um
  único `pg.Pool`, `PrismaPg` e `PrismaClient`, preserva timeout de conexão de
  cinco segundos e trata `schema` separadamente da connection string do driver.
- A factory é dona do lifecycle: `$disconnect()` encerra o client e, em seguida,
  `pool.end()` encerra o driver. API, collection CLI e cada banco isolado de teste
  possuem seu próprio handle; repositories recebem somente o client.
- A versão de `pg` é unificada para impedir duas identidades de `Pool`, situação
  que faria o adapter deixar de reconhecer o pool externo e criar outro.
- As quatro migrations anteriores continuam imutáveis. `migrate deploy` foi
  validado duas vezes em banco vazio e reconhecido sem pendências no banco
  existente e no migration job do Compose.
