# Price Tracker — Project Context

> Documento de handoff técnico para agentes de desenvolvimento.
>
> Snapshot atualizado em **17 de novembro de 2026**. O código, o schema Prisma,
> as migrations, os testes e as configurações atuais são a fonte de verdade.
> Documentos históricos em `docs/` podem descrever estados anteriores e são
> citados apenas quando ajudam a explicar uma decisão.

## 1. Project Overview

O **Price Tracker** é uma aplicação de portfólio para pesquisar produtos e
comparar o preço atual com o histórico persistido. O sistema responde à
pergunta:

> O preço atual está baixo, normal ou alto em relação às observações já
> coletadas?

O projeto começou como um agregador multi-provider para Amazon Brasil e Mercado
Livre. Hoje ele possui providers, matching determinístico, persistência
PostgreSQL, histórico append-only, analytics, uma Read API REST e um frontend
MVP.

O problema de negócio não é apenas descobrir o menor preço de uma busca. O
objetivo é preservar contexto temporal, distinguir produto canônico de oferta,
mostrar ofertas ativas e deixar claro quando o histórico ainda é insuficiente.

O projeto não é um e-commerce tradicional: não há checkout, pagamento, carrinho,
conta de usuário ou recomendação personalizada. Links de oferta levam à loja
externa; o Price Tracker é um comparador e um leitor de histórico.

Princípios importantes:

- consultar o catálogo persistido é diferente de executar uma coleta externa;
- uma oferta não é o mesmo que um produto canônico;
- observações de preço são fatos imutáveis;
- providers externos ficam isolados por contratos, schemas e mappers;
- falha de um provider não deve apagar resultados válidos de outro;
- nenhuma classificação ou preço deve ser inventado quando não há evidência.

## 2. Current Production Status

URLs públicas verificadas:

- Web: [https://price-tracker-web-ruddy.vercel.app](https://price-tracker-web-ruddy.vercel.app)
- API: [https://price-tracker-api-vmhg.onrender.com](https://price-tracker-api-vmhg.onrender.com)

Arquitetura publicada:

```text
Browser
  ↓
Vercel (apps/web)
  ↓ HTTPS + CORS explícito
Render (Read API, Docker)
  ↓ pooled DATABASE_URL
Neon PostgreSQL
```

Estado conhecido:

- frontend: Vercel, projeto Next.js, Root Directory `apps/web`;
- API: Render Web Service Docker, Node 22, escuta em `0.0.0.0` e usa
  `process.env.PORT`;
- banco: Neon PostgreSQL, runtime com URL pooled e migrations com URL direta;
- Prisma: 7.10.1, `@prisma/adapter-pg` e `pg`;
- scheduler em produção: desligado com `COLLECTION_SCHEDULER_ENABLED=false`;
- a API Read não exige `SCAVIO_API_KEY` quando o scheduler está desligado;
- `CORS_ORIGIN` do Render está configurado para a origem pública da Vercel, não
  para `*`; o desenvolvimento local continua usando `http://localhost:3000`;
- `GET /health` respondeu `200` com `status: "ok"` e `database: "ok"`;
- a busca pública `iphone 15` respondeu `200` com `total: 78` na validação
  de 11 de novembro de 2026;
- produto, offers, history e analytics foram carregados pelo frontend público;
- o plano gratuito do Render pode suspender a instância. O primeiro request
  após inatividade pode sofrer cold start de dezenas de segundos; o frontend
  possui estados de loading e erro, mas não há keep-alive implementado;
- nenhuma coleta externa deve ser executada pela navegação da Web.

Não há secrets neste arquivo. URLs Neon, tokens e chaves ficam somente em
variáveis privadas do provedor ou em `.env` ignorado pelo Git.

## 3. Technology Stack

### Backend

- Node.js 22 (`.nvmrc` contém `22`; `engines` limita a `>=22 <23`);
- TypeScript 5.9.3;
- API HTTP nativa `node:http`;
- Prisma 7.10.1 com generator `prisma-client`;
- `@prisma/adapter-pg` 7.10.1 e `pg` 8.23.1;
- PostgreSQL 16;
- Zod 4.6.7 para configuração e payloads externos;
- `fetch` nativo para HTTP externo;
- Vitest 3.2.7 para testes;
- `embedded-postgres` é dependência de desenvolvimento para testes PostgreSQL
  isolados quando os binários locais estão disponíveis.

### Frontend

- Next.js 16.4.6 com App Router;
- React 19.3.1 e React DOM 19.3.1;
- TypeScript;
- Tailwind CSS 3.4.17;
- Recharts 2.15.x;
- Vitest, Testing Library, jsdom e `@testing-library/jest-dom`;
- build explicitamente com Webpack (`next build --webpack`), não Turbopack.

### Infraestrutura

- npm workspaces;
- Docker e Docker Compose;
- PostgreSQL local em `postgres:16-alpine`;
- Neon PostgreSQL para produção;
- Render para a API;
- Vercel para a Web;
- GitHub Actions em `.github/workflows/ci.yml`;
- GitHub é o repositório de origem (`Marc0l4/price-tracker`).

## 4. Repository Structure

Árvore relevante atual:

```text
price-tracker/
├── apps/
│   ├── api/
│   │   ├── prisma/
│   │   │   ├── migrations/
│   │   │   └── schema.prisma
│   │   ├── src/
│   │   │   ├── collection/
│   │   │   ├── http/
│   │   │   ├── infrastructure/database/
│   │   │   ├── integrations/
│   │   │   ├── matching/
│   │   │   ├── persistence/
│   │   │   ├── read/
│   │   │   ├── services/
│   │   │   ├── shared/
│   │   │   ├── types/
│   │   │   └── index.ts
│   │   ├── tests/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsconfig.build.json
│   └── web/
│       ├── app/
│       │   ├── products/[id]/
│       │   ├── globals.css
│       │   ├── home-page.tsx
│       │   ├── layout.tsx
│       │   ├── page.tsx
│       │   └── search-state-provider.tsx
│       ├── components/
│       ├── lib/api/
│       ├── lib/types/
│       ├── tests/
│       ├── Dockerfile
│       ├── next.config.ts
│       ├── package.json
│       └── tailwind.config.ts
├── .github/workflows/ci.yml
├── docker-compose.yml
├── docker-compose.prod.yml
├── prisma.config.ts
├── package.json
├── package-lock.json
├── README.md
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DECISIONS.md
│   └── PROJECT_CONTEXT.md
└── PROJECT_CONTEXT.md
```

Responsabilidades principais:

- `apps/api/src/integrations`: contrato, providers, schemas externos, clients e
  limiter Scavio;
- `apps/api/src/services`: agregação genérica de providers;
- `apps/api/src/matching`: normalização textual e grupos temporários;
- `apps/api/src/persistence`: decisões de canonicalização, transações, offers,
  observações e lifecycle;
- `apps/api/src/collection`: CollectionRun, scheduler, CLI e recuperação;
- `apps/api/src/read`: consultas read-only, analytics e histórico;
- `apps/web/lib/api`: único ponto de acesso HTTP da Web;
- `apps/web/components`: UI reutilizável sem conhecimento de Prisma ou Scavio;
- `docs`: histórico arquitetural, não substitui o código atual.

## 5. Monorepo / Workspace Architecture

O package raiz é privado, usa `type: "module"` e declara `workspaces: ["apps/*"]`.
Dependências são instaladas na raiz com `npm install`/`npm ci`; scripts de cada
app também podem ser chamados pelo workspace.

Os comandos raiz delegam para os workspaces:

- `npm run build:api` → build de `@price-tracker/api`;
- `npm run build:web` → build de `@price-tracker/web`;
- `npm run test:api` e `npm run test:web`;
- `npm run dev:api` → Read API;
- `npm run dev` → Web;
- `npm run collect -- "query"` → CLI de coleta.

A API e a Web não compartilham tipos por pacote. A Web tem tipos HTTP próprios
em `apps/web/lib/types/api.ts` e não importa Prisma nem código interno da API.

O Render usa o contexto raiz e `apps/api/Dockerfile`. A Vercel publica somente
`apps/web`; o build configurado é `cd ../.. && npm run build --workspace=@price-tracker/web`.
Essa configuração é necessária porque o repositório é um workspace único.

## 6. Backend Architecture

### Entrypoints

- `apps/api/src/http/read-api.main.ts`: bootstrap da Read API;
- `apps/api/src/collection/collect.cli.ts`: bootstrap da coleta manual;
- `apps/api/src/index.ts`: composition helpers para providers, busca,
  orchestrator e scheduler.

Ambos os entrypoints fazem:

```text
loadProjectEnv()
  ↓
parse de configuração
  ↓
createPrismaClient(databaseUrl)
  ↓
composition de serviços
  ↓
execução
```

`loadProjectEnv()` carrega `.env` na raiz e `apps/api/.env`, sem imprimir seus
valores. A ordem é importante: clients Scavio e o Prisma devem ser compostos
depois do bootstrap de ambiente.

### Read request

```text
HTTP node:http
  → validação de path/query
  → ProductQueryService ou PriceHistoryService
  → repository de leitura
  → Prisma tagged SQL / queries
  → PostgreSQL/Neon
  → JSON com Decimal como string
```

Erros conhecidos viram `ReadApiError` sanitizado. Erros inesperados viram
`500 { error: { code: "internal_error", message: "Erro interno ao consultar dados." } }`.
Stack trace, SQL, URLs de banco e secrets não são enviados ao cliente.

### Collection request

```text
CLI ou scheduler
  → CollectionOrchestrator
  → ProductSearchService.searchDetailed
  → providers em paralelo
  → limiter Scavio por chave, quando aplicável
  → schemas Zod e mappers
  → ProductMatchingService
  → ProductPersistenceService
  → PostgreSQL
```

O scheduler não conhece providers, Scavio ou Prisma; ele chama somente a porta
de execução agendada do orchestrator.

## 7. HTTP API

A API é read-only e aceita somente `GET` e `OPTIONS` (para CORS). Não existe
endpoint de escrita ou coleta HTTP.

| Método | Path | Parâmetros | Comportamento |
| --- | --- | --- | --- |
| `GET` | `/health` | nenhum | Executa `SELECT 1`; retorna `200` com `status: ok` e `database: ok`, ou `503` degradado. |
| `GET` | `/products` | `query` obrigatório, `page` default 1, `limit` default 20/max 100, `currency` default BRL, `sort=history\|price` | Busca somente `CanonicalProduct` persistido, ordena antes da paginação e retorna `page`, `limit`, `total`, `items`. |
| `GET` | `/products/:id` | UUID | Detalhe do produto, providers, imagem e ofertas ativas resumidas. |
| `GET` | `/products/:id/offers` | `currency` opcional | Ofertas ativas e `bestOffers`, uma menor oferta por moeda. |
| `GET` | `/products/:id/history` | `period=30d\|90d\|180d\|all` ou `from` + `to`, `currency` | Série raw ou buckets agregados. `period` não pode ser combinado com `from/to`. |
| `GET` | `/products/:id/analytics` | mesmos filtros de history | Preço atual, menor, maior, média, percentual, observações e classificação. |
| `GET` | `/offers/:id/history` | mesmos filtros de history | Observações da oferta específica. |
| `OPTIONS` | qualquer rota | headers CORS | Responde `204` com origem, métodos e headers permitidos. |

Validações relevantes:

- UUID inválido → `400 invalid_uuid`;
- query ausente/vazia → `400 invalid_query`;
- page/limit inválidos → `400 invalid_page`/`invalid_limit`;
- currency deve ser três letras maiúsculas;
- período e intervalo customizado são mutuamente exclusivos;
- produto/oferta inexistente → `404 product_not_found` ou `offer_not_found`;
- rota/método não suportado → `404 route_not_found`;
- banco indisponível no health → `503`, sem detalhes internos.

## 8. Search Behavior

A busca consulta primeiro o catálogo. A coleta sob demanda existe no código, mas
fica desativada por padrão por `ON_DEMAND_COLLECTION_ENABLED=false`; por isso a
produção atual continua somente leitura até receber configuração e migration
explícitas.

O fluxo é:

1. a query passa por trim, compactação de espaços e lowercase (`pt-BR`) da
   mesma forma que `TrackedSearch`;
2. `ProductReadRepository` faz `contains`/`ILIKE` em `CanonicalProduct.name`,
   `brand` e `model`;
3. uma query SQL calcula preço atual mínimo por produto e cobertura de histórico;
4. se a feature estiver ligada, `OnDemandProductSearchService` verifica a
   `TrackedSearch` e seu `lastCollectedAt` antes de decidir por uma coleta;
5. dentro de `ON_DEMAND_COLLECTION_TTL_MINUTES` (default 360), a resposta vem
   somente do banco, inclusive quando o resultado válido é vazio;
6. query inédita, falha anterior ou TTL expirado podem usar o
   `CollectionOrchestrator`, que persiste e depois relê o catálogo;
7. a ordenação global ocorre no PostgreSQL antes de `OFFSET/LIMIT`, e a Web
   recebe Decimal como string com quatro casas.

Produto sem histórico pode aparecer no catálogo se sua identidade existir; nesse
caso `currentPrice` e `currency` são `null`. A UI exibe “Preço indisponível”,
nunca `R$ 0,00`.

O caminho on-demand não duplica providers, matching, persistência, métricas ou
lifecycle. Ele usa `CollectionRun`/`ProviderCollectionRun` normais e conserva
o mesmo `collectionKey`/histórico append-only. Duas instâncias coordenam a mesma
query com `pg_advisory_xact_lock` curto ao criar/observar uma run `running`; a
segunda aguarda o resultado persistido em vez de chamar providers novamente.

O rate limit só se aplica à **nova coleta**: leituras recentes nunca consomem
quota. Os contadores persistentes `OnDemandRateLimit` usam uma chave SHA-256 do
endereço do cliente e janela fixa. `ON_DEMAND_TRUST_PROXY` só deve ser `true`
atrás de proxy confiável (Render), quando o primeiro `X-Forwarded-For` é o IP
do cliente. O limite default é 3 novas coletas em 10 minutos; o excesso recebe
`429 on_demand_rate_limited` e `Retry-After`. Falha completa recebe `502`
sanitizado; sucesso parcial preserva os resultados persistidos do provider que
funcionou.

O frontend mantém query, página, sort e resultados em memória no
`SearchStateProvider`. A URL não é usada como fonte persistente de busca; ao
carregar `/?q=...`, a implementação atual limpa a query da URL. F5 reinicia o
estado. Navegar para detalhe e retornar pelo link mantém o provider montado no
fluxo normal da sessão.

## 9. Providers / External Integrations

O contrato comum está em `ProductProvider`:

```ts
interface ProductProvider {
  readonly name: string;
  searchProducts(query: string): Promise<NormalizedProduct[]>;
}
```

`ProductSearchService` recebe uma lista de providers e executa todos com
`Promise.all`. Cada resultado registra `startedAt`, `finishedAt`, `durationMs`,
`success`/`failed`, produtos ou `ProviderError` sanitizado. O agregado usa
`flatMap` e preserva `providerErrors`; uma falha não elimina os produtos de
outro provider.

Providers atuais:

- `AmazonProvider` → `AmazonSearchClient` → `ScavioAmazonClient` por padrão;
- `MercadoLivreProvider` → `MercadoLivreSearchClient` →
  `ScavioMercadoLivreClient` por padrão;
- `OfficialMercadoLivreClient` existe como cliente experimental alternativo,
  preparado para OAuth, mas não é o client default do provider.

Cada client externo valida payload com Zod e traduz para um item interno neutro
antes de o provider chamar o mapper. O domínio não recebe payload Scavio.

Erros possíveis de provider:

```text
configuration_error | http_error | network_error | timeout | invalid_response
```

HTTP status é preservado na mensagem sanitizada (`HTTP 402`, `HTTP 429`, etc.),
mas a classificação continua `http_error`. Timeout usa `AbortController`; o
timeout Amazon é configurável e defaulta em 15 segundos, Mercado Livre Scavio
usa 10 segundos no client atual.

## 10. Scavio Integration

Scavio é infraestrutura externa, não identidade de domínio. O campo
`NormalizedOffer.provider` é `amazon` ou `mercadolivre`; não é `scavio`.

Endpoints usados pelos clients:

- Amazon Brasil: `POST https://api.scavio.dev/api/v1/amazon/search` com
  `{ query, country: "br" }`;
- Mercado Livre Brasil: `POST https://api.scavio.dev/api/v1/mercadolibre/search`
  com `{ country: "br", query }`.

Autenticação vem de `SCAVIO_API_KEY`, lida depois do bootstrap de ambiente e
passada explicitamente pela composition root em execução normal. A chave nunca
deve aparecer em logs, fixtures, erros, README ou este arquivo.

O plano usado durante a implementação permitia uma chamada simultânea por
chave. `scavioRequestLimiter` é um singleton em memória com fila por chave:

- Amazon e Mercado Livre continuam sendo disparados em paralelo pelo serviço;
- operações Scavio que usam a mesma chave esperam sua vez;
- timeout começa quando a operação recebe a vez;
- `finally` libera a fila mesmo em erro;
- a proteção vale somente dentro de um processo Node;
- múltiplas réplicas exigiriam coordenação distribuída futura.

Por quota e custo, testes automatizados usam mocks/fetches falsos e fixtures.
Não executar Scavio em `npm test`, CI, build ou validação comum. Uma coleta
manual real só deve ocorrer com autorização explícita e uma query controlada.

## 11. Product Normalization

Tipos em `apps/api/src/types/normalized-product.ts`:

```ts
type Availability = "available" | "unavailable" | "unknown";

interface NormalizedOffer {
  externalOfferId: string;
  price: number;
  currency: string;
  shipping?: { isFree?: boolean };
  productUrl: string;
  provider: string;
  storeName?: string;
  availability: Availability;
}

interface NormalizedProduct {
  externalId: string;
  name: string;
  brand?: string;
  model?: string;
  gtin?: string;
  imageUrl?: string;
  offers: NormalizedOffer[];
}
```

Amazon usa ASIN como `externalId` e como `externalOfferId` quando possui preço.
Mercado Livre separa `product_id`/`item_id` quando vem de Scavio; sem
`product_id`, o item usa `item_id` como identidade provisória. O preço e moeda
ausentes preservam o produto com `offers: []`; não há preço artificial.

O mapper Mercado Livre pode preencher marca, modelo, GTIN, imagem, vendedor,
frete grátis e disponibilidade derivada de quantidade quando usa payload
oficial. O mapper Scavio atual preenche o que o payload intermediário oferece e
marca disponibilidade como `unknown`.

## 12. Product Matching

`ProductMatcher` recebe apenas `NormalizedProduct`. Não conhece providers,
Scavio, Prisma ou payload externo. `ProductMatchingService` agrupa produtos em
uma única execução; os IDs `group-1`, `group-2`, etc. são locais e não são IDs
persistentes.

### Normalização e evidências

- texto: lowercase, remoção de acentos, pontuação substituída por espaço e
  espaços compactados;
- `128GB` e `128 GB` tornam-se equivalentes;
- marcas inferidas pelo campo `brand` ou, inicialmente, por Apple/Samsung no
  título;
- cores conhecidas incluem português/inglês para preto, azul, branco, verde,
  vermelho, rosa, dourado, prata, cinza, roxo, midnight e starlight;
- versões conhecidas: Pro, Pro Max, Max, Plus, Mini, FE, Ultra, Slim, Lite e SE;
- gerações numéricas são extraídas em português/inglês;
- kits/acessórios usam marcadores kit, bundle, combo, pack, conjunto, capa,
  carregador, película, suporte e case;
- condição reconhecida: novo/new, usado/used, seminovo e recondicionado;
- capacidades reconhecidas: 64/128/256/512/1024 GB e 1 TB; 1 TB e 1024 GB
  são equivalentes;
- RAM é separada quando há contexto `RAM`; armazenamento é separado por
  `SSD`, `storage`, `armazenamento` ou `ROM`;
- tamanho de tela em polegadas é extraído, mas não é inferido quando ausente;
- GTIN só vale se tiver 8, 12, 13 ou 14 dígitos e dígito verificador válido.

### Score e conflitos

Pontuação implementada:

| Evidência | Pontos |
| --- | ---: |
| GTIN válido igual | 100 |
| marca igual | 20 |
| modelo essencial igual | 40 |
| capacidade igual | 30 |
| RAM igual | 15 |
| cor igual | 10 |
| tamanho igual | 20 |
| nome essencial equivalente | 20 |

Conflitos críticos vencem pontuação: GTIN diferente, marca diferente,
capacidade/RAM/cor/tamanho diferentes, versão diferente, kit/acessório
diferente, condição diferente ou qualificador textual diferente.

Sem GTIN igual, o match exige modelo essencial igual, evidência completa de
variantes (`positiveVariantEvidence` sem `partialVariantEvidence`) e score
mínimo de 70. GTIN igual pode sustentar o match mesmo quando outras evidências
estão ausentes, mas conflitos ainda impedem `matched`.

Confiança:

- `high` quando há GTIN igual, ou score pelo menos 100 com capacidade e cor
  presentes nos dois lados;
- `medium` quando há match sem a evidência de alta confiança;
- `low` quando não há match.

O agrupamento exige que o novo produto corresponda a **todos** os membros do
grupo. Isso evita união transitiva de variantes incompatíveis. Produtos da mesma
origem são consolidados quando external ID/offer ID coincidem, unindo ofertas
sem duplicar a mesma oferta.

## 13. Persistence Model

O schema está em `apps/api/prisma/schema.prisma`.

### CanonicalProduct

Identidade canônica exibida pela Read API. Campos: `id`, `name`, `brand`,
`model`, `gtin`, `matchStatus`, timestamps. Possui muitos
`ProviderProduct`. `matchStatus` é `confirmed`, `provisional` ou
`review_required`.

### ProviderProduct

Identidade do produto em uma origem: `provider`, `externalId`, nome, marca,
modelo, GTIN, imagem, `canonicalProductId`, `matchStatus`, `lastObservedAt` e
timestamps. Unique `(provider, externalId)` impede duplicação externa; índice
canonical acelera leitura.

### Offer

Oferta comercial específica: `providerProductId`, `provider`,
`externalOfferId`, `storeName`, `productUrl`, `availability`, `isActive`,
`lastSeenAt`, `lastCheckedAt` e timestamps. Unique `(provider,
externalOfferId)`. Possui observações e escopos de TrackedSearch.

### PriceObservation

Fato de preço: `offerId`, `price Decimal(19,4)`, `currency VARCHAR(3)`,
`shippingAmount`, `shippingIsFree`, `collectedAt`, `collectionKey`, `createdAt`.
Unique `(offerId, collectionKey)`. Não possui UPDATE/DELETE permitido pelo
trigger PostgreSQL.

### TrackedSearch

Query monitorada, única por texto normalizado, com `active`, `lastCollectedAt` e
timestamps. Índice `active` apoia o scheduler.

### CollectionRun

Execução lógica de uma query: `id`, `collectionKey` unique, `trackedSearchId`,
query, status, trigger, `attempt`, timestamps, duração, contagens de produtos,
grupos persistidos/falhos e `errorCode`.

### ProviderCollectionRun

Estado de cada provider em uma CollectionRun: provider, attempt, status,
timestamps, duração, resultCount e errorCode. Unique `(collectionRunId,
provider, attempt)`.

### TrackedSearchOffer

Presença de uma Offer dentro de uma query monitorada. Chave composta
`(trackedSearchId, offerId)`, `isActive`, `lastSeenAt`, `lastCheckedAt` e
`createdAt`. Permite lifecycle por escopo sem inativar uma oferta ainda vista em
outra busca.

### Constraints importantes

- strings de identidade não vazias;
- `confirmed` exige canonical associado;
- preço positivo;
- frete não negativo;
- moeda em três letras maiúsculas;
- collectionKey não vazia;
- FKs usam `RESTRICT` para preservar fatos e relações históricas, exceto
  ProviderProduct → CanonicalProduct com `SET NULL`.

## 14. Price History

Uma observação é criada quando `ProductPersistenceService` persiste uma oferta
válida dentro de um grupo e chama `PriceObservationRepository.record`.

`collectionKey` é a identidade da execução lógica:

- nova CollectionRun → novo UUID e nova key;
- retry da mesma run → mesma key e `attempt` incrementado;
- retry idempotente não duplica observação;
- o mesmo preço em nova CollectionRun cria nova observação, pois a key é nova;
- retry com dados diferentes para a mesma key falha em vez de sobrescrever o
  fato original.

O preço é convertido para `Prisma.Decimal`; a API o serializa como string com
quatro casas. Timestamps são `timestamptz(3)` e representam o instante de
coleta. Histórico de uma oferta pode continuar visível mesmo depois de ela
ficar inativa.

O trigger criado na migration inicial rejeita qualquer UPDATE ou DELETE em
`PriceObservation` com `PriceObservation is immutable`. Testes isolados usam
TRUNCATE somente no banco de teste.

Períodos da Read API:

- `30d`, `90d`, `180d`: janela relativa a `now`;
- `all`: sem filtro temporal;
- alternativa: `from` e `to` ISO/datas, ambos obrigatórios e inclusivos.

Até 500 observações, a resposta é `granularity: raw`, com um ponto por
observação e timestamp completo. Acima disso, o repository agrega por dia, ou
por semana quando o intervalo ultrapassa 180 dias, preservando min, max, média,
último preço e contagem do bucket.

## 15. Analytics

`PriceHistoryService` consulta `PriceAnalyticsRepository`.

- preço atual: menor preço entre as ofertas **ativas**, considerando a última
  observação de cada oferta;
- menor/maior/média: agregados de todas as observações dentro do intervalo,
  inclusive de offers inativas;
- `lowestPriceAt`: timestamp da observação de menor preço;
- primeira/última observação: extremos temporais do agregado;
- `percentFromAverage`: `(current - average) / average * 100`, arredondado a duas
  casas, somente quando há classificação válida;
- `observationCount`: quantidade de observações no intervalo e currency;
- `bestOffers`: primeira oferta ativa por moeda depois de ordenar currency/preço.

Analytics não converte moedas e não mistura BRL com USD. O default HTTP é BRL,
mas a moeda é sempre explícita na consulta e resposta.

## 16. Classification Rules

Regras exatas atuais em `PriceHistoryService`:

```text
se não há preço atual, média, média é zero ou observationCount < 2:
    insufficient_data
senão se current <= average * 0.95:
    low
senão se current >= average * 1.05:
    high
senão:
    normal
```

Portanto, zero ou uma observação válida é `insufficient_data`; duas ou mais
permitem `low`, `normal` ou `high`. A Web não recalcula a regra; apenas traduz:

| API | UI |
| --- | --- |
| `low` | Preço baixo |
| `normal` | Preço normal |
| `high` | Preço alto |
| `insufficient_data` | Histórico insuficiente |

## 17. Collection Pipeline

Fluxo atual:

```text
npm run collect -- "iphone 15"
ou timer do scheduler
        ↓
TrackedSearchRepository.ensure/findActive
        ↓
CollectionRunRepository.start/restart
        ↓
ProviderCollectionRun rows
        ↓
ProductSearchService.searchDetailed
        ↓
AmazonProvider + MercadoLivreProvider
        ↓
Zod → item interno → NormalizedProduct
        ↓
ProductMatchingService.group
        ↓
ProductPersistenceService.persist
        ↓
canonical/provider/offer/observation/lifecycle
        ↓
CollectionRun.finish
```

Uma falha externa é capturada pelo `ProductSearchService`; providers bem-sucedidos
continuam com seus produtos. O orchestrator marca a run como:

- `completed`: todos os providers responderam completamente e persistência não
  teve falhas;
- `partial`: pelo menos um provider foi bem-sucedido, mas outro falhou ou uma
  unidade de persistência falhou;
- `failed`: nenhum provider foi bem-sucedido, ou timeout global/orchestrator
  impediu resultados úteis.

Falha de persistência é isolada por grupo: cada grupo usa uma transação própria,
para que outros grupos válidos continuem.

## 18. Collection Runs

`CollectionRunRepository.start` usa um UUID como `id` e como `collectionKey`.
`startedAt` permanece fixo em retry; `attemptStartedAt` mede a tentativa atual.

`ProviderCollectionRun` é criado para todos os providers antes da busca. Ao
final, cada linha registra `success`/`failed`, duração, contagem e código de
erro. O conceito de resposta completa é estrito: a promise do adapter precisa
resolver após HTTP válido, JSON/schema válidos e processamento integral. Timeout,
HTTP error, parsing/schema inválido e resposta incompleta nunca entram em
`successfulProviders`.

O timeout global defaulta em 30 segundos (`COLLECTION_TIMEOUT_MS`). Quando ele
vence, providers ainda running são finalizados como failed/timeout; resultados
que chegarem depois não são persistidos por aquela execução.

Recovery classifica CollectionRuns antigas em `running` como `failed` com
`errorCode: interrupted` quando ultrapassam `COLLECTION_STALE_RUN_MINUTES`.
Scheduler e CLI chamam recovery no bootstrap.

## 19. Offer Lifecycle

O lifecycle é atualizado somente para providers marcados como resposta completa.

- offer reaparecida: `Offer.isActive=true`, timestamps avançados;
- offer ausente após resposta completa: pode ser marcada inativa;
- provider falhou/timeout/schema inválido: nenhuma ausência desse provider é
  usada para inativar;
- item sem oferta (`offers: []`): o ProviderProduct é protegido contra inativação
  indevida durante aquela resposta, mas não inventa preço;
- com `TrackedSearchOffer`, presença é controlada por query; a Offer global só
  fica ativa se ainda existir algum escopo ativo.

Advisory locks PostgreSQL por provider protegem o lifecycle concorrente no banco.
Locks em memória do orchestrator evitam overlap da mesma TrackedSearch no mesmo
processo; não protegem duas instâncias.

## 20. Prisma 7 Architecture

O código atual usa Prisma 7.10.1, não Prisma 6.

- generator: `prisma-client`;
- output: `apps/api/src/generated/prisma` (gerado, não versionado);
- `moduleFormat = "esm"` e import extensions `.js`;
- schema não contém URL de datasource;
- `prisma.config.ts` aponta schema/migrations e prefere
  `DIRECT_DATABASE_URL` para operações CLI;
- runtime chama `createPrismaClient(databaseUrl)`;
- factory cria exatamente um `pg.Pool`, um `PrismaPg` e um `PrismaClient`;
- pool usa `connectionTimeoutMillis: 5000`;
- a factory é dona do lifecycle e fecha Prisma e pool uma vez;
- graceful shutdown fecha scheduler, HTTP server, Prisma e pool.

Repositories recebem o client ou transaction client; não criam pools próprios.
Raw SQL usa `Prisma.sql`/tagged templates e parâmetros. Não voltar ao client
implícito antigo sem uma razão arquitetural comprovada.

## 21. Database Connections

### `DATABASE_URL`

Runtime da API e conexão local. Em produção Neon é a URL pooled com TLS, por
exemplo conceitual:

```text
postgresql://USER:PASSWORD@HOST/DB?sslmode=require
```

Não copiar uma URL real para este arquivo.

### `DIRECT_DATABASE_URL`

URL direta, não pooled, usada pelo Prisma CLI, migrations e operações de dump/
restore. No runtime da API, a factory recebe `DATABASE_URL`.

### Desenvolvimento

`docker-compose.yml` publica:

```text
host: localhost:5433
container: postgres:5432
database: price_tracker_dev
user: price_tracker_dev
```

CI usa PostgreSQL de service container em `localhost:5432`. Não trocar
automaticamente a porta local para 5432: outro PostgreSQL pode ocupá-la.

## 22. Migrations

As cinco migrations oficiais, em ordem, são:

1. `20261108210000_init`: CanonicalProduct, ProviderProduct, Offer,
   PriceObservation, índices, FKs e trigger append-only;
2. `20261109150000_persistence_hardening`: lifecycle de Offer,
   `lastObservedAt`, checks de identidade/preço/moeda/collectionKey;
3. `20261109170000_collection_orchestration`: enums e tabelas
   TrackedSearch, CollectionRun, ProviderCollectionRun e TrackedSearchOffer;
4. `20261109190000_read_analytics_indexes`: índice composto para offers ativas
   por ProviderProduct.
5. `20261117090000_on_demand_collection`: contador persistente de quota por
   cliente/janela para coleta sob demanda.

Produção usa somente:

```bash
npm run db:migrate
# internamente: prisma --config ../../prisma.config.ts migrate deploy
```

Não usar `db push` para substituir migrations, não resetar Neon e não editar
migrations históricas. Uma migration nova deve ser incremental, justificada e
testada em banco isolado.

## 23. Frontend Architecture

O App Router possui duas páginas:

- `/` → `apps/web/app/page.tsx` e `HomePage`;
- `/products/[id]` → `ProductPage`.

`layout.tsx` adiciona metadata, idioma `pt-BR`, CSS global e
`SearchStateProvider`.

Componentes principais:

- `AppHeader`: logo textual e ícone de gráfico descendente;
- `ProductCard`: imagem, nome, marca/modelo, preço atual e matchStatus;
- `ProductImage`: fallback acessível para imagem ausente/quebrada;
- `PriceBadge`: traduz classificação calculada pela API;
- `PriceChart`: Recharts para pontos raw/buckets;
- `OffersList`: ofertas ativas, melhor preço e link externo seguro.

`lib/api/client.ts` centraliza base URL, fetch, parsing e erro HTTP. `products.ts`
define as chamadas de catálogo, detalhe, offers, analytics e history.

## 24. Home / Search UX

A Home apresenta proposta curta, campo com label acessível, loading/skeleton,
erro amigável, estado vazio e resultados persistidos.

Submit:

1. trim da query;
2. query vazia não dispara request;
3. estado recebe `activeQuery`, página 1 e sort atual;
4. `searchProducts` chama `/products?query=...&page=...&limit=20&sort=...`;
5. resposta mostra contagem, cards, seletor de sort e paginação;
6. troca de página faz scroll suave até resultados, respeitando
   `prefers-reduced-motion`.

O frontend diferencia loading de erro e oferece retry. Não há infinite scroll.
F5 limpa o estado em memória; a implementação atual não persiste a busca em
localStorage/sessionStorage.

## 25. Search State

`SearchStateProvider` guarda:

```text
query
activeQuery
page
sort: history | price
result
```

O provider fica no layout raiz, então o detalhe pode voltar para `/` sem perder
o estado durante a sessão normal. A implementação não serializa esse estado na
URL nem em storage persistente; links compartilháveis com `?q=` não são a fonte
de verdade atual.

## 26. Sorting

`sort=history`:

1. produtos com preço atual primeiro;
2. maior número de `collectionKey` distintas primeiro;
3. menor preço atual;
4. nome;
5. ID.

`sort=price`:

1. produtos com preço atual primeiro;
2. menor preço atual;
3. nome;
4. ID.

O histórico é contado por coleta lógica, não por quantidade bruta de offers, e
a ordenação ocorre no SQL antes do `OFFSET/LIMIT`. Produtos sem preço ficam no
final. Não há Elasticsearch ou índice full-text neste milestone.

## 27. Product Detail Page

A página consulta em paralelo:

- `GET /products/:id`;
- `GET /products/:id/offers`;
- `GET /products/:id/analytics?period=...`;
- `GET /products/:id/history?period=...`.

Exibe imagem, nome, marca/modelo, preço atual, percentual em relação à média,
badge de classificação, cinco cards de resumo, gráfico e ofertas ativas.

Se o backend informa `review_required`, a Web mostra aviso discreto sobre
validação de ofertas. Produto inexistente tem tela amigável de 404; erro de
carregamento não expõe stack, SQL ou detalhes internos.

## 28. History Chart

`PriceChart` usa Recharts `LineChart` e mantém strings Decimal até a fronteira
visual. `chartData` ordena por timestamp e cria uma coordenada categórica única
`${periodStart}-${index}`; isso preserva observações no mesmo dia/instante sem
colapsá-las pelo rótulo de data.

Para dados raw, a linha principal usa `lastPrice`. Se várias observações
compartilham um dia, o tooltip usa data/hora. Para buckets, a linha principal
usa o último preço e linhas tracejadas mostram mínimo/máximo; tooltip também
mostra média e contagem.

Períodos disponíveis na UI: 30 dias, 90 dias, 180 dias e todo período. Estado
vazio mostra mensagem de histórico insuficiente sem afirmar que o produto não
existe.

## 29. UI / Design System

A identidade visual é de comparador de preços, não de dashboard administrativo
ou e-commerce.

- azul institucional `#0F2A5F`/`#2563EB` para marca e ações;
- verde somente semântico para preço baixo/melhor oferta;
- vermelho para preço alto;
- âmbar para revisão ou histórico insuficiente;
- superfícies claras, bordas suaves e sombras discretas;
- tipografia sans-serif com títulos compactos e fortes;
- foco visível, labels, headings, alt e links semânticos;
- layouts desktop/mobile com breakpoints simples;
- ícone do cabeçalho é um gráfico descendente com recuperação parcial e seta,
  não um raio.

## 30. Environment Variables

| Variável | Usada por | Finalidade | Obrigatória | Escopo |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | API/runtime, CI | PostgreSQL pooled/runtime ou local | sim | privada |
| `DIRECT_DATABASE_URL` | Prisma CLI | URL direta Neon para migrations/dump | produção/CLI | privada |
| `SCAVIO_API_KEY` | collection clients | autenticação Scavio | somente coleta | secreta |
| `SCAVIO_AMAZON_TIMEOUT_MS` | Amazon client | timeout Amazon, default 15000 | não | privada |
| `MERCADOLIVRE_ACCESS_TOKEN` | OfficialMercadoLivreClient | OAuth futuro/alternativo | não | secreta |
| `PORT` | API | prioridade de porta da plataforma | Render | privada |
| `API_PORT` | API/Compose | fallback local da API, default 3001 | não | privada |
| `READ_API_PORT` | API | fallback legado depois de API_PORT | não | privada |
| `CORS_ORIGIN` | API | uma origem HTTP permitida | não, default localhost | não secreta |
| `WEB_ORIGIN` | API | fallback de CORS | não | não secreta |
| `COLLECTION_SCHEDULER_ENABLED` | API | liga scheduler | não, default false | privada |
| `COLLECTION_INTERVAL_MINUTES` | scheduler | intervalo, default 30 | não | privada |
| `COLLECTION_TIMEOUT_MS` | orchestrator | timeout global, default 30000 | não | privada |
| `COLLECTION_STALE_RUN_MINUTES` | recovery | idade para interrupted, default 60 | não | privada |
| `ON_DEMAND_COLLECTION_ENABLED` | Read API | liga coleta sob demanda; default false | não | privada |
| `ON_DEMAND_COLLECTION_TTL_MINUTES` | Read API | reuso de coleta válida; default 360 | não | privada |
| `ON_DEMAND_RATE_LIMIT_MAX` | Read API | novas coletas por janela/IP; default 3 | não | privada |
| `ON_DEMAND_RATE_LIMIT_WINDOW_MINUTES` | Read API | janela fixa do limite; default 10 | não | privada |
| `ON_DEMAND_TRUST_PROXY` | Read API | confia em X-Forwarded-For; default false | não | privada |
| `NEXT_PUBLIC_API_BASE_URL` | Web | URL pública da Read API embutida no build | sim | pública |
| `TEST_DATABASE_URL` | testes API | banco/schema explicitamente de teste | não | teste |
| `TEST_POSTGRES_BIN` | testes API | binários PostgreSQL locais opcionais | não | teste |

Exemplos sem valores reais estão em `.env.example`, `apps/api/.env.example` e
`apps/web/.env.example`. Nunca colocar `DATABASE_URL`, `DIRECT_DATABASE_URL`,
`SCAVIO_API_KEY` ou token em `NEXT_PUBLIC_*`.

## 31. Local Development

PowerShell, a partir da raiz:

```powershell
npm install
Copy-Item .env.example .env
Copy-Item apps/web/.env.example apps/web/.env.local
npm run db:up
npm run db:generate
npm run db:migrate
```

Preencha `SCAVIO_API_KEY` somente se for executar coleta real. Para desenvolver
a Read API e Web em terminais separados:

```powershell
npm run dev:api                 # http://localhost:3001
npm run dev                     # http://localhost:3000
```

Banco vazio é um estado válido: `/products` retorna `200` com `total: 0`.
Migrations não são aplicadas automaticamente pelo `dev:api`; execute
`npm run db:migrate` explicitamente.

## 32. Useful Commands

| Comando | Uso |
| --- | --- |
| `npm install` | instala workspaces |
| `npm run db:up` | sobe PostgreSQL Docker local |
| `npm run db:down` | para Compose local |
| `npm run db:generate` | gera Prisma Client 7 |
| `npm run db:migrate` | `prisma migrate deploy` |
| `npm run dev:api` | Read API via vite-node |
| `npm run dev` | Next dev Web |
| `npm run collect -- "iphone 15"` | coleta manual; exige chave Scavio e banco |
| `npm test` | API e Web; suites PostgreSQL exigem ambiente de teste funcional |
| `npm run test:api` | Vitest API |
| `npm run test:web` | Vitest Web |
| `npm run build:api` | gera Prisma e compila API |
| `npm run build:web` | build Next com Webpack |
| `npm run build` | ambos os builds |
| `docker compose -f docker-compose.prod.yml up --build` | ensaio local do Compose de produção |
| `npm run start:api` | inicia `apps/api/dist/http/read-api.main.js` |

Não existem scripts de lint, worker distribuído, Redis, BullMQ ou deploy
automático no package raiz.

## 33. Local Ports

```text
Web host:          3000
Read API host:     3001
PostgreSQL host:   5433 → container 5432
CI PostgreSQL:     5432
Compose prod API:  host ${API_HOST_PORT:-3001} → container 3001
Compose prod Web:  host ${WEB_HOST_PORT:-3000} → container 3000
```

Render injeta `PORT` (observado como 10000 no healthcheck interno); a API não
hardcode 10000 e escuta `0.0.0.0`. Não usar `localhost` para banco entre
containers: o serviço Compose usa `postgres:5432`.

## 34. Docker

`apps/api/Dockerfile` e `apps/web/Dockerfile` são multi-stage Node 22 Alpine.
O build instala workspaces, gera/compila e a imagem runner contém apenas o
necessário.

`docker-compose.yml` de desenvolvimento contém somente PostgreSQL 16, volume
persistente e healthcheck `pg_isready`, publicando 5433.

`docker-compose.prod.yml` contém:

- PostgreSQL interno;
- `api-migrate`, que executa migrations antes da API;
- `api`, com healthcheck `/health`, CORS e scheduler configuráveis;
- `web`, build-time `NEXT_PUBLIC_API_BASE_URL` e dependência de API saudável.

O Compose de produção não injeta `SCAVIO_API_KEY` automaticamente do `.env`.
Secrets de coleta, se necessários, devem ser fornecidos explicitamente ao
ambiente de deploy. Não versionar `.env.production`.

## 35. CI

`.github/workflows/ci.yml` executa em push e pull request:

1. Ubuntu com service `postgres:16-alpine`;
2. `DATABASE_URL`/`TEST_DATABASE_URL` em banco de teste;
3. Node conforme `.nvmrc` e cache npm;
4. `npm ci`;
5. `npm run db:generate`;
6. `npm run db:migrate`;
7. testes API sem paralelismo de arquivos;
8. testes Web;
9. build API;
10. build Web.

CI não precisa de `SCAVIO_API_KEY` e não deve chamar APIs externas. Providers
usam mocks e fixtures. O banco de CI usa 5432; isso não altera o Compose local
em 5433.

## 36. Testing Strategy

### API sem banco externo

Há testes de configuração, bootstrap de ambiente, shutdown, timeout, providers,
schemas/mappers, limiter, ProductSearchService e ProductMatcher. Os providers
são testados com fetch mockado para HTTP 2xx, não-2xx, timeout, JSON inválido,
schema inválido, rede e chave ausente.

### API com PostgreSQL

Collection, persistence e read API criam um PostgreSQL isolado ou usam
`TEST_DATABASE_URL`, aplicam as cinco migrations e testam lifecycle, matching
persistente, idempotência, append-only, analytics, histórico, paginação, sort,
catálogo vazio e health.

A coleta sob demanda é coberta com providers planejados/mocks: cache dentro do
TTL, query inédita, repetição normalizada, TTL expirado, concorrência entre duas
instâncias, sucesso parcial, falha total, rate limit, feature flag desligada e
resposta HTTP `429` sanitizada. Esses testes não chamam Scavio.

### Web

Há 4 arquivos e 26 testes aprovados na última execução:

- `environment.test.ts`;
- `home-page.test.tsx`;
- `components.test.tsx`;
- `product-page.test.tsx`.

Eles cobrem busca, vazio/erro, paginação/sort, cards, preço indisponível,
analytics/classificação, gráfico, troca de período, offers, melhor oferta,
review_required, produto inexistente e URL externa segura.

### Resultado observado em 12/11/2026

- `npm run build:api`: aprovado;
- `npm run build:web`: aprovado com a permissão necessária para o build criar
  `.next`; sem essa permissão o Windows pode emitir `EPERM` ao criar diretórios
  temporários do Next;
- `npm run test:web`: 26/26 aprovados;
- `npm test`: 83 testes API unit/integration leves aprovados, 68 testes
  PostgreSQL ficaram skipped porque as três suites de banco falharam no setup do
  Schema Engine local. O erro ocorreu antes dos casos, em `prisma migrate deploy`
  do PostgreSQL efêmero. Isso é uma limitação do ambiente desta verificação, não
  uma alteração de lógica feita pelo documento; CI deve fornecer PostgreSQL
  funcional.

Não declarar a suíte completa verde localmente sem corrigir/verificar esse setup
PostgreSQL.

## 37. Production Architecture

```mermaid
flowchart TD
    User[Browser] --> Vercel[Vercel Web\nNext.js apps/web]
    Vercel -->|GET + explicit CORS| Render[Render Read API\nDocker Node 22]
    Render -->|pooled DATABASE_URL| Neon[(Neon PostgreSQL)]
    Render -. scheduler disabled .-> Scheduler[Collection Scheduler]
    Scheduler -. when explicitly enabled .-> Orchestrator[CollectionOrchestrator]
    Orchestrator --> Providers[Amazon + Mercado Livre]
    Providers --> Scavio[Scavio infrastructure]
    Orchestrator --> Neon
```

Na operação atual, Web → API → Neon é o caminho ativo. Scheduler/providers não
são acionados por leitura.

## 38. Vercel

Configuração atual/recomendada:

- Framework Preset: Next.js;
- Root Directory: `apps/web`;
- Node: 22.x;
- Install Command: padrão da Vercel para o workspace importado;
- Build Command: `cd ../.. && npm run build --workspace=@price-tracker/web`;
- Output Directory: padrão do Next.js;
- environment: somente `NEXT_PUBLIC_API_BASE_URL` com URL Render pública;
- URL: `https://price-tracker-web-ruddy.vercel.app`.

Não adicionar DATABASE_URL, DIRECT_DATABASE_URL, SCAVIO_API_KEY ou tokens ao
projeto Vercel. `next.config.ts` usa `output: "standalone"` para Docker, embora
a Vercel também consiga publicar o App Router normalmente.

## 39. Render

O serviço `price-tracker-api` aponta para o repositório GitHub e constrói
`apps/api/Dockerfile` com contexto da raiz. O runner inicia:

```text
node apps/api/dist/http/read-api.main.js
```

O bootstrap usa `PORT ?? API_PORT ?? READ_API_PORT ?? 3001`, escuta
`0.0.0.0`, expõe `/health` e fecha recursos em SIGTERM/SIGINT.

Variáveis privadas esperadas: `DATABASE_URL`, `DIRECT_DATABASE_URL`,
`COLLECTION_SCHEDULER_ENABLED=false`, `CORS_ORIGIN` e `NODE_ENV`. `SCAVIO_API_KEY`
não é necessária para a Read API desligada.

Não configurar coleta automática no Render Free sem uma única instância,
observabilidade e política de quota. O scheduler é opt-in.

## 40. Neon

Neon hospeda o PostgreSQL de produção já migrado e populado. Runtime usa URL
pooled; migrations e operações administrativas usam URL direta. As migrations
oficiais foram aplicadas com `prisma migrate deploy`; não fazer reset.

Ao trocar banco ou projeto Neon:

1. validar `DIRECT_DATABASE_URL` sem mostrar senha;
2. executar `migrate deploy`;
3. comparar counts e relações;
4. testar health, catálogo, detalhe, offers, history e analytics;
5. preservar IDs, timestamps, PriceObservation e trigger append-only.

## 41. Security / Secrets

`.env`, `.env.local`, `.env.production`, dumps, `node_modules`, `.next`,
`dist`, logs e dados de testes estão no `.gitignore` ou devem permanecer fora
do Git.

Nunca commitar:

- `SCAVIO_API_KEY`;
- `MERCADOLIVRE_ACCESS_TOKEN`;
- `DATABASE_URL`/`DIRECT_DATABASE_URL` com senha;
- arquivos `.env` reais;
- dumps PostgreSQL;
- headers Authorization;
- payloads externos que contenham credenciais;
- secrets em `NEXT_PUBLIC_*`;
- stack traces ou SQL em resposta pública.

O log estruturado de coleta registra evento, run, provider, status, duração,
contagens e errorCode. Ele não deve registrar chave, Authorization ou URL de
banco.

URLs externas de ofertas são validadas no frontend por `safeExternalUrl` para
permitir somente `http:`/`https:` e são abertas com `target="_blank"` e
`rel="noopener noreferrer"`.

## 42. Known Production Data

Informação verificável na validação pública de 11/11/2026:

- `GET /products?query=iphone%2015&page=1&limit=20` → `200`, `total: 78`;
- `/health` → `status: ok`, `database: ok`;
- um produto de iPhone 15 exibiu 4 observações, preço atual aproximado de
  R$ 3.779,09, média aproximada de R$ 4.122,02 e classificação `low`;
- a página exibiu ofertas Amazon e Mercado Livre e alternância de 30d/90d/180d/
  todo período.

Counts globais atuais de CanonicalProduct, ProviderProduct, Offer,
PriceObservation, TrackedSearch e CollectionRun não são afirmados aqui sem uma
consulta controlada ao Neon. O próximo agente deve consultar somente com
credenciais autorizadas e nunca copiar a URL de conexão para o documento.

## 43. Important Historical Decisions

- **Provider contract:** o restante da aplicação depende de `ProductProvider`,
  não de payload Mercado Livre/Amazon.
- **Scavio intermediária:** o Mercado Livre oficial apresentou restrições reais
  de acesso/403; o default atual usa Scavio, mas o domínio continua chamando o
  provider de `mercadolivre`.
- **Cliente oficial preservado:** `OfficialMercadoLivreClient` fica isolado e
  preparado para OAuth futuro; não trocar o default sem validar autenticação,
  quota e schema.
- **Limiter compartilhado:** Amazon e Mercado Livre compartilham chave Scavio;
  fila em memória evita concorrência indevida no mesmo processo.
- **Promise.all:** providers independentes são iniciados em paralelo; apenas a
  infraestrutura Scavio serializa sua própria chamada.
- **Append-only:** PriceObservation não é atualizada nem apagada; retry usa a
  mesma collectionKey.
- **Matching determinístico:** não há IA, embeddings ou fuzzy matching; regras
  explícitas são auditáveis e conservadoras.
- **Lifecycle só com resposta completa:** provider falhando não pode inativar
  ausência de ofertas.
- **Ordenação no banco:** busca ordena antes da paginação para não produzir
  páginas inconsistentes.
- **Read API nativa:** `node:http` é suficiente para os endpoints GET atuais;
  não adicionar framework sem necessidade concreta.
- **Prisma 7:** migração foi concluída; manter ESM, generator explícito,
  adapter-pg, pool único e factory central.
- **Node 22/Webpack:** Node 26 não é faixa suportada; Web usa Webpack para
  evitar problemas do Turbopack no ambiente host.
- **Scheduler opt-in:** Render Free serve leitura por padrão; coleta periódica
  exige instância única e não tem lock distribuído.

## 44. Things That Must Not Be Changed Casually

Antes de alterar, entender e testar:

- `prisma.config.ts`, generator/output e `createPrismaClient`: risco de quebrar
  ESM, adapter, pool ou migrations;
- porta local PostgreSQL 5433: mudar para 5432 pode atingir outro banco;
- migrations históricas e trigger append-only: reset pode destruir histórico;
- `collectionKey` e unique `(offerId, collectionKey)`: risco de duplicar ou
  apagar observações;
- identidade `provider` (`amazon`/`mercadolivre`): Scavio não é provider de
  domínio;
- score/regras do matcher: risco de mesclar variantes incompatíveis;
- `successfulProviders` e lifecycle: provider parcial não pode inativar offers;
- sorting SQL antes de paginação: mudar no frontend altera semântica;
- bootstrap `loadProjectEnv()` antes da composition: evita chave ausente capturada
  em module scope;
- `PORT` e bind `0.0.0.0`: necessários no Render;
- CORS explícito e URLs públicas: não usar `*` nem hardcode local em produção;
- SearchState em memória: não adicionar storage/URL sem decidir o contrato de
  navegação;
- Node 22 e Webpack: não migrar para Node/Turbopack por conveniência;
- scheduler single-process e limiter singleton: múltiplas instâncias exigem
  novo desenho operacional;
- frontend nunca deve receber secrets ou duplicar analytics.

## 45. Known Gotchas

- Local PostgreSQL usa 5433; CI usa 5432.
- `DIRECT_DATABASE_URL` deve ser direta; pooled é para runtime Neon.
- `prisma migrate deploy` lê a configuração raiz e pode preferir direct URL.
- Render Free pode demorar para acordar; não interpretar o primeiro timeout como
  falha permanente da API.
- Web precisa de acesso estático a `process.env.NEXT_PUBLIC_API_BASE_URL` para o
  Next embutir o valor no bundle.
- CORS é origem única. Ao mudar o domínio Vercel, atualizar `CORS_ORIGIN` e
  reiniciar Render.
- Com `ON_DEMAND_COLLECTION_ENABLED=false`, Read API não chama providers e uma
  busca vazia em banco é `200 total: 0`.
- Ativar coleta sob demanda sem aplicar a quinta migration causa falha somente
  quando uma query precisar consumir quota; aplicar `prisma migrate deploy`
  antes de ligar a flag.
- `SCAVIO_API_KEY` só é validada quando collection/scheduler é composto; não
  adicionar essa exigência ao bootstrap read-only.
- API e Web podem ocupar 3001/3000 no host; Compose prod permite overrides.
- Prisma Client gerado não deve ser commitado.
- A execução completa local de testes precisa de PostgreSQL efêmero funcional;
  se o Schema Engine falhar no setup, muitas suites aparecem como skipped.
- `npm run build:web` pode exigir permissão para criar `.next` no Windows;
  `EPERM` nesse ponto é operacional, não necessariamente erro de TypeScript.
- Uma collection manual pode criar `TrackedSearch`; a Read API não cadastra
  queries.
- O scheduler não tem lock distribuído e não deve ser habilitado em duas
  instâncias.

## 46. Debugging Guide

### Web abre, mas não carrega produtos

Verificar:

1. `NEXT_PUBLIC_API_BASE_URL` no ambiente Vercel;
2. API pública `/health`;
3. `CORS_ORIGIN` no Render exatamente igual à origem Web;
4. cold start do Render;
5. console do navegador e resposta `/products`.

### API `/health` falha

Verificar:

1. serviço Render live e porta `PORT`;
2. `DATABASE_URL` pooled sem expor valor;
3. TLS/SSL do Neon;
4. migrations aplicadas;
5. logs sanitizados do startup.

### Migrations falham

Verificar `DIRECT_DATABASE_URL`, banco/schema corretos, `_prisma_migrations`,
permissões e se ninguém tentou `db push`/reset em produção.

### Produtos não aparecem

Separar catálogo de coleta:

- catálogo vazio → `200 total: 0` é esperado;
- query sem match em nome/brand/model → nenhum item;
- produto novo não aparece até ser persistido;
- coleta → consultar CollectionRun e ProviderCollectionRun;
- provider falho → verificar errorCode, HTTP status, timeout e quota;
- matching/persistence → verificar grupos, `review_required`, `Offer` e
  `PriceObservation`.

### Provider falha

Verificar somente em ambiente autorizado:

- `SCAVIO_API_KEY` presente após `loadProjectEnv()`;
- endpoint/método/country `br`;
- limiter compartilhado;
- timeout Amazon 15000ms e Mercado Livre 10000ms;
- HTTP 401/402/403/429/5xx;
- schema Zod e shape real;
- nunca imprimir Authorization ou a chave.

### Oferta foi inativada indevidamente

Confirmar se o provider estava em `successfulProviders`, se a resposta foi
completa, se a coleta tinha o mesmo `TrackedSearch` e se o lifecycle scope não
foi confundido com estado global da Offer.

## 47. Development Workflow for Future Agents

1. Ler este `PROJECT_CONTEXT.md`.
2. Ler os arquivos específicos ligados à tarefa.
3. Verificar estado Git e preservar mudanças existentes.
4. Identificar contrato e invariantes afetados.
5. Fazer a menor alteração necessária.
6. Adicionar/ajustar testes sem chamadas Scavio.
7. Rodar testes afetados e a suíte relevante.
8. Rodar build API/Web.
9. Fazer auto-review de segurança, lifecycle, idempotência e concorrência.
10. Verificar migrations antes de qualquer alteração de schema.
11. Não fazer deploy destrutivo, reset, coleta real ou alteração de secrets sem
    autorização explícita.
12. Relatar arquivos, comandos, resultados, limitações e riscos.

## 48. Definition of Done

Uma mudança está pronta quando:

- implementação atende ao contrato existente;
- testes novos/regressão foram adicionados quando há risco;
- testes relevantes passam ou falhas ambientais são explicadas;
- API e Web compilam no runtime suportado;
- nenhum secret foi introduzido;
- env e migration, se aplicáveis, estão documentados;
- histórico/lifecycle/idempotência permanecem protegidos;
- não há regressão conhecida relevante;
- deploy externo só ocorre quando solicitado e validado.

## 49. Current Roadmap

### Completed

- adapters Amazon e Mercado Livre com validação/normalização;
- agregação multi-provider e falhas parciais;
- limiter Scavio por chave;
- matching determinístico e hardening de variantes;
- PostgreSQL + Prisma 7 + migrations;
- persistência, idempotência, histórico append-only e lifecycle;
- CollectionRun, ProviderCollectionRun, TrackedSearch, CLI e scheduler
  single-process opt-in;
- analytics e Read API REST;
- busca paginada com sort por histórico/preço;
- frontend MVP responsivo;
- CI, Docker local/prod e deploy Vercel/Render/Neon.
- coleta sob demanda opt-in com TTL, rate limit PostgreSQL e lock por query.

### Current

- manutenção e validação da aplicação publicada; feature on-demand ainda não
  foi ativada/deployada em produção;
- observabilidade operacional ainda básica;
- testes PostgreSQL dependem de um setup local/CI funcional.

### Next

- endurecer observabilidade e diagnóstico de produção;
- decidir estratégia de execução periódica fora de Render Free, se necessário;
- melhorar navegação compartilhável sem quebrar o estado atual;
- adicionar provider somente após contrato, quota e validação reais.

### Future / Optional

- autenticação, favoritos, alertas e notificações;
- segunda implementação oficial da Amazon;
- lock/coordenação distribuída, fila e workers;
- índice full-text ou busca especializada;
- Product Matching mais avançado, IA ou recomendação;
- domínio customizado e pipeline de deploy mais automatizado.

Não tratar itens Future como funcionalidades já existentes.

## 50. Portfolio Status

O projeto é demonstrável como portfólio porque combina:

- backend TypeScript e REST;
- integração de APIs externas;
- Zod e tratamento de falhas;
- matching explicável;
- PostgreSQL/Prisma 7;
- histórico imutável e analytics;
- frontend Next.js/Tailwind/Recharts;
- Docker, CI, Vercel, Render e Neon;
- decisões arquiteturais documentadas.

A demonstração pública não executa coleta na navegação. Ela mostra catálogo e
histórico já persistidos. O Render Free/cold start e o scheduler desligado são
limitações operacionais conhecidas, não devem ser ocultados.

## 51. Claude Handoff Notes

You are taking over an existing production portfolio project. Do not redesign or
rewrite it by default. Preserve the current architecture and make targeted,
tested changes.

Read first:

1. `PROJECT_CONTEXT.md` (this file);
2. `apps/api/prisma/schema.prisma` and the four migrations;
3. the files directly related to the requested change;
4. `docs/ARCHITECTURE.md` and `docs/DECISIONS.md` only as historical rationale;
5. current tests before changing contracts.

Basic commands:

```powershell
npm install
npm run db:up
npm run db:generate
npm run db:migrate
npm run dev:api
npm run dev
npm run test:web
npm run build:api
npm run build:web
```

The Web is read-only against the Render API. The API reads Neon. Collection is
manual/scheduled infrastructure and requires `SCAVIO_API_KEY`; do not call it in
tests. Never copy production connection strings or secrets into source,
fixtures, logs or documentation.

Keep the following frozen unless a change is explicitly designed and tested:

- Prisma 7 factory/adapter/pool lifecycle;
- migration history and append-only trigger;
- collectionKey idempotency;
- provider identities and ProviderError codes;
- successful-provider lifecycle rule;
- matcher conflict rules;
- SQL ordering before pagination;
- PORT/host bootstrap and explicit CORS;
- frontend API client and public/private environment boundary.

For a new task, state the affected boundary, make a minimal change, add a
regression test, run the affected suite/build, and report any environmental
failure separately from code failure. Do not reset Neon, start two schedulers,
run a real Scavio collection, or redeploy production automatically.

## Final Handoff Answer

**Claude consegue assumir o projeto apenas lendo este arquivo e depois
inspecionando os arquivos indicados?**

Sim. Este arquivo descreve o estado atual, contratos, invariantes, comandos,
deploy e riscos suficientes para começar o trabalho. O agente ainda deve ler os
arquivos específicos da tarefa e validar infraestrutura externa antes de afirmar
que um dado de produção continua atual.
