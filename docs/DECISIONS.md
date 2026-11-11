# Decisões — Milestone 1

- Usar workspaces npm para reservar `apps/api` e o futuro `apps/web` sem criar frontend.
- Usar `fetch` nativo do Node.js, injetável no provider para testes.
- Validar a resposta externa com Zod antes de qualquer mapeamento ao domínio.
- Manter identificadores de produto opcionais: só são preenchidos quando recebidos em `attributes`.
- Representar falhas de providers como erros estruturados, permitindo falha parcial entre providers.
- Não criar persistência, autenticação, filas, cache ou agendamentos neste incremento.

## Milestone 2.1

- A fronteira entre cliente externo e provider Amazon usa `AmazonSearchItem`, sem
  tipos do schema Scavio na interface interna.
- Resultados Amazon sem preço ou moeda são preservados como produto com `offers: []`.
- Chave ausente usa `configuration_error`; JSON malformado usa `invalid_response`.
- Os status HTTP não-2xx continuam como `http_error`, com o status na mensagem.
- A validação real da Scavio depende de `SCAVIO_API_KEY` no ambiente; quando ausente,
  os testes usam exclusivamente resposta simulada.

## Mercado Livre via cliente intermediário

- Scavio foi escolhida para busca Mercado Livre Brasil por keyword, reutilizando
  a chave já configurada para Amazon. API.SH foi avaliada como alternativa com
  franquia gratuita maior, mas exigiria outra conta e credencial.
- A integração oficial foi preservada em `OfficialMercadoLivreClient`; o provider
  usa `ScavioMercadoLivreClient` por padrão, por meio de interface neutra.
- Uma chamada real controlada em 8/11/2026 retornou HTTP 200 e 48 resultados para
  `iphone 15`. O campo de imagem observado foi `image`, acrescentado ao schema e
  à tradução; a fixture permanece sintética e reflete esse nome.
- Os dois clientes Scavio compartilham uma chave. No plano gratuito, chamadas
  simultâneas podem receber HTTP 429 por limite de concorrência. Uma fila em
  memória por chave serializa as operações Scavio neste processo e libera a
  próxima mesmo quando uma falha. Uma busca agregada real `iphone 15` retornou
  HTTP 200 nas duas chamadas, 96 produtos e nenhum `providerErrors` ou 429.

## Milestone 3 — Product Matching

- Precisão prevalece sobre cobertura: conflito crítico bloqueia a união.
- Cores e capacidades diferentes representam variantes separadas.
- GTIN com dígito verificador válido tem peso forte; códigos inválidos não
  oferecem evidência de identidade.
- Produto sem oferta ainda participa do matching por sua identidade normalizada.
- Agrupamento temporário exige compatibilidade com todos os membros do grupo,
  evitando cadeias transitivas inseguras.
- Regras determinísticas são auditáveis e suficientes para o primeiro incremento;
  IA, embeddings e fuzzy matching ficam fora do escopo.

## Milestone 3.1 — Hardening

- O título participa da detecção de qualificadores mesmo quando `model` existe.
- Versão, tamanho explícito, kit/acessório e condição incompatíveis bloqueiam
  match, inclusive com score ou GTIN iguais. Condição em um lado só bloqueia.
- RAM e armazenamento são distintos; `1024GB` equivale a `1TB` para armazenamento.
- Atributos ausentes não pontuam nem satisfazem sozinhos a exigência de variante.
- A confiança alta sem GTIN requer cor e armazenamento conhecidos e iguais.
- Duplicatas óbvias no mesmo grupo são unidas sem perder ofertas distintas.
- Ordem de entrada e IDs temporários continuam limitações antes da persistência.

## Milestone 4 — Persistência

- PostgreSQL é o banco principal; Prisma 6 usa `DATABASE_URL` por ambiente.
- UUIDs canônicos são gerados pelo banco, nunca derivados de `group-N`.
- Produto externo e oferta têm unicidade por provider e identificador externo.
- Matching é uma sugestão auditável: GTIN igual e sem ambiguidade permite
  confirmed; demais grupos são provisional ou review_required.
- Ambiguidade conserva dados externos e observações, sem unir novos registros
  automaticamente a uma identidade canônica existente.
- Observações são imutáveis; `(offerId, collectionKey)` torna retry idempotente.
- Trigger bloqueia UPDATE/DELETE de observações e FKs impedem exclusão em
  cascata do histórico em operação normal.
- Valor monetário usa Decimal(19,4); preço atual não é coluna de Offer.
- O envelope `{ provider, product }` identifica a origem de produtos sem oferta
  sem alterar `NormalizedProduct` ou contratos dos providers.
- Testes usam PostgreSQL efêmero e migration real. Agendamento fica fora do escopo.

## Milestone 4.1 — Hardening

- `collectionKey` é a identidade estável da execução lógica; retry reutiliza a
  chave e coleta nova usa outra. Timestamp não substitui essa identidade.
- O contrato de entrada usa `SourcedProduct` e `CollectionContext`; contratos de
  provider, `NormalizedProduct`, `NormalizedOffer` e matching não mudaram.
- Cada grupo lógico usa uma transação de até 10 s, com espera máxima de 5 s. Uma
  falha reverte o grupo, é devolvida de forma sanitizada e não descarta os demais.
- Advisory locks ordenados serializam a mesma identidade externa. `lastObservedAt`
  impede que uma coleta antiga sobrescreva identidade mais nova. Offers usam
  upsert atômico e observações usam conflito idempotente validado.
- A reavaliação de canônico lê todos os membros persistidos. Conflito explícito
  degrada para `review_required`; evidência insuficiente degrada para
  `provisional`; `review_required` permanece até revisão futura.
- Offer possui `isActive`, `lastSeenAt` e `lastCheckedAt`. Somente resposta válida
  e integral do provider pode inativar ausentes; falha do provider ou de uma
  unidade impede a inativação. Reaparecimento reativa.
- Produto sem preço é persistido sem Offer/PriceObservation nova e não inativa
  automaticamente as ofertas anteriores do mesmo produto.
- Duplicatas equivalentes do lote são consolidadas; conflitantes são isoladas e
  diagnosticadas. Comparação estrutural não depende da ordem das propriedades.
- Split/merge reassociam ProviderProduct e preservam ofertas/histórico. Canônicos
  vazios e duplicatas entre coletas independentes permanecem dívida conhecida.
- PriceObservation continua append-only. Estatísticas financeiras devem separar
  currencies; não existe conversão cambial.
- A migration incremental `20261109150000_persistence_hardening` adiciona lifecycle,
  ordenação temporal de identidade e CHECK constraints. A migration inicial não
  foi reescrita.
- O bootstrap de testes prefere binários oficiais locais porque a hidratação/
  inicialização do pacote PostgreSQL embutido mostrou travamentos intermitentes no
  Windows. O fallback embutido foi mantido; URL externa só é aceita se indicar
  explicitamente database/schema de teste.

## Milestone 5 — Coleta periódica

- `CollectionRun.id` é gerado como UUID pela aplicação e também é a
  `collectionKey` persistida. Retry mantém ambos; uma run independente nunca
  reutiliza a chave. `startedAt` não muda no retry; `attemptStartedAt` registra
  a tentativa atual para não alterar o instante da observação idempotente.
- Uma CollectionRun é associada a uma única TrackedSearch para definir escopo,
  lifecycle e diagnóstico sem ambiguidade. A query normalizada é única.
- Provider sucesso significa resposta integral do adapter: a promise resolveu
  após validação e processamento completo. Erro HTTP, timeout, schema/parsing
  inválido ou paginação incompleta permanecem fora de `successfulProviders`.
- `ProviderCollectionRun` conserva uma linha por provider/attempt. A tentativa
  anterior não é sobrescrita por retry.
- Falha de provider e falha parcial de persistência tornam a run `partial` se
  existe qualquer provider bem-sucedido; sem provider bem-sucedido a run é
  `failed`.
- `TrackedSearchOffer` separa presença de uma Offer por query. A Offer global só
  fica inativa quando nenhum escopo monitorado a vê como ativa.
- Scheduler usa timer interno, sem dependência de Prisma ou providers. Locks em
  memória evitam overlap no mesmo processo; não há garantia entre processos.
- Runs antigas em `running` são recuperadas como `failed/interrupted` ao iniciar
  scheduler ou CLI. Não há retry automático agressivo.
- Limiter Scavio singleton continua compartilhado por todas as runs no processo.
- A migration `20261109170000_collection_orchestration` cria runs, provider runs,
  queries monitoradas e escopos de Offer sem modificar migrations anteriores.

## Milestone 6 — Analytics e API de leitura

- A camada read é separada da persistência: repositories especializados fazem
  consultas, ProductQueryService monta catálogo e PriceHistoryService calcula
  analytics. Providers não são acionados para leitura.
- `node:http` foi escolhido para a API REST inicial por ser nativo e suficiente
  para endpoints GET; framework HTTP fica fora até haver necessidade concreta.
- Preços são Decimal internamente e strings com quatro casas na resposta HTTP.
  Currency é explícita; BRL é somente default, nunca uma suposição estrutural.
- Preço atual considera apenas Offers ativas e a última observação de cada uma.
  Histórico inclui Offers inativas para preservar fatos passados.
- Menos de duas observações é `insufficient_data`; low/high usam ±5% da média e
  percentual não é emitido para histórico insuficiente.
- Histórico mantém pontos raw até 500 observações em qualquer período. Acima
  disso, buckets PostgreSQL preservam mínimo, máximo, média e último preço; a UI
  exibe a faixa para não aparentar uma série constante.
- A busca aceita `sort=history|price`. `history` mede `collectionKey` distintas,
  e não observações brutas, para não multiplicar cobertura por oferta. A ordenação
  é global, no banco e antes da paginação; produtos sem preço ficam por último.
- `20261109190000_read_analytics_indexes` adiciona índice composto para Offers
  ativas por ProviderProduct. Busca textual permanece contains/ILIKE, sem
  Elasticsearch ou índice full-text neste milestone.

## Milestone 7 — Frontend MVP

- Next.js App Router foi escolhido para a primeira interface por oferecer rotas,
  React e build de produção sem introduzir outro servidor de UI.
- `lib/api` concentra URL base, parsing JSON e erro HTTP. Tipos de resposta vivem
  no frontend e não importam Prisma ou contratos internos da API.
- A classificação não é recalculada no navegador: o frontend somente traduz o
  valor analítico retornado pelo backend para texto amigável.
- `Intl.NumberFormat` e `Intl.DateTimeFormat` formatam moeda e datas. Valores
  Decimal continuam strings até a biblioteca de gráfico, que requer coordenadas
  numéricas.
- Recharts foi mantido como biblioteca leve para a série de preço. Dados raw e
  buckets usam o mesmo modelo visual; tooltip mostra faixas agregadas quando há
  bucket.
- O browser recebe somente `NEXT_PUBLIC_API_BASE_URL`. A API local usa CORS de
  origem configurável para o ambiente de desenvolvimento; não expõe segredo.

## Milestone 9 — CI, deploy readiness e configuração

- Node.js 22 LTS é a versão suportada (`.nvmrc` e `engines`).
- A configuração permanece leve com Zod e `process.loadEnvFile`, sem framework
  adicional. Credenciais não são lidas em escopo de módulo.
- O scheduler é opt-in e single-process; esta limitação é documentada em vez de
  mascarada com uma solução distribuída prematura.
- O compose de produção não interpola `SCAVIO_API_KEY` a partir do `.env` do
  projeto. Secrets de deploy vivem em `.env.production`, ignorado pelo Git e
  pelas imagens.
- A migration de produção usa `prisma migrate deploy`, em serviço anterior à
  API no Compose e como etapa explícita no CI.

## Milestone 9.1 — Atualização segura de dependências

- Zod foi atualizado de 3.25.76 para 4.6.7. Os schemas de providers e de
  configuração usam APIs estáveis; o helper de ambiente passou a depender apenas
  de `safeParse`, sem tipos internos removidos no Zod 4.
- Next.js foi atualizado de 15.5.29 para 16.4.6 junto de React/React DOM 19.3.1
  e seus tipos. A aplicação já usava App Router sem APIs legadas relevantes. Um
  `postcss.config.mjs` explícito mantém Tailwind 3 processado pelo build do Next.
- O build web nativo no host Windows com Node 26 pode falhar ao criar subprocesso
  do Turbopack; Node 26 está fora da faixa suportada. CI e Docker usam Node 22,
  onde o build standalone foi validado.
- Prisma e `@prisma/client` permanecem pareados em 6.19.3. O audit aponta a
  cadeia `prisma → @prisma/config → deepmerge-ts`; a correção exige Prisma 7,
  cuja migração requer ESM, configuração explícita e adapter PostgreSQL. Ela foi
  isolada como dívida de segurança, sem alterar schema, migrations, Decimal,
  raw SQL, advisory locks ou triggers neste incremento.

## Avaliação Prisma 7 e correção do ambiente local

- A falha Web → API não vinha do banco, CORS ou Prisma. O helper recebia
  `process.env` como objeto e lia `environment.NEXT_PUBLIC_API_BASE_URL`; o Next
  16 não incorporou esse acesso dinâmico no bundle do navegador. O acesso direto
  a `process.env.NEXT_PUBLIC_API_BASE_URL` restaurou a busca e ganhou teste de
  regressão.
- Prisma 7 foi classificado como categoria C: migração arquitetural de alto risco.
  O runtime atual é CommonJS, enquanto a migração oficial envolve ESM, novo
  generator/client, output explícito, `prisma.config.ts` e `@prisma/adapter-pg`.
- Há 23 arquivos de aplicação/teste ligados ao client e 106 imports relativos no
  runtime que precisariam de estratégia ESM consistente. Testes também usam
  datasource override removido no novo construtor. Não foi adotada compatibilidade
  CommonJS incidental contrariando a recomendação oficial.
- Uma migração futura deve centralizar `createPrismaClient(databaseUrl)`, manter
  um pool por processo, preservar timeout de conexão, criar clients isolados por
  banco de teste e validar Decimal, transações, advisory locks e trigger
  append-only antes de remover Prisma 6.

## Milestone 9.3 — executar a migração arquitetural Prisma 7

- Prisma CLI e Client foram atualizados em conjunto para 7.10.1. A dívida antes
  classificada como categoria C foi tratada em incremento exclusivo, sem mudança
  de regra de negócio ou edição de migrations históricas.
- A API passou de CommonJS para ESM com `module`/`moduleResolution` NodeNext. O
  frontend permaneceu funcionalmente inalterado.
- O generator agora é `prisma-client`, com output explícito em
  `src/generated/prisma`. Imports operacionais vêm apenas desse client; não há
  mistura com o antigo client gerado implicitamente em `node_modules`.
- A URL da datasource foi removida do schema e configurada em
  `prisma.config.ts`, sempre obtida do ambiente. Não existe fallback de conexão
  para runtime ou migration.
- O PostgreSQL usa `@prisma/adapter-pg` e `pg`. Uma factory central cria pool,
  adapter e client depois do bootstrap de ambiente. O pool tem timeout de conexão
  explícito e ownership único; graceful shutdown fecha servidor, Prisma e pool.
- `pg` foi unificado em uma única versão porque duas cópias tornam o teste
  `instanceof Pool` do adapter falso e podem criar um segundo pool. Essa condição
  foi encontrada e corrigida durante a auto-revisão.
- Testes PostgreSQL usam a mesma factory com uma URL isolada por banco, em vez do
  datasource override removido no Prisma 7. O comando local da API foi alinhado
  ao CI para não executar os bancos efêmeros em paralelo.
- Raw SQL permanece tagged-template/parametrizado. Transações interativas,
  advisory locks, idempotência por `ON CONFLICT`, `Decimal` e append-only foram
  revalidados pela suíte existente.
- O audit de produção após a migração registra zero vulnerabilidades critical,
  high ou moderate.
