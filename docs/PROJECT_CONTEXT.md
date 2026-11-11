# Price Tracker — Project Context for Codex

> Documento de handoff do projeto. Este arquivo registra as decisões tomadas até **5 de novembro de 2026**.  
> Use-o como contexto inicial; não presuma que funcionalidades planejadas já foram implementadas.

## 1. Visão do produto

**Price Tracker** é uma plataforma de pesquisa e acompanhamento de preços. O usuário pesquisa um produto e consulta sua evolução histórica para entender se o preço atual está alto, normal ou abaixo dos valores observados anteriormente.

A proposta de valor central não é apenas responder **“quanto custa agora?”**, mas ajudar a responder:

**“Este é um bom momento para comprar ou vale a pena esperar?”**

- Mercado inicial: Brasil.
- Idioma inicial: português.
- Abrangência desejada: produtos em geral, de diferentes categorias.
- Objetivo imediato: projeto de portfólio e aprendizado técnico.
- Possibilidade futura: transformar em produto público/comercial, mas monetização não é prioridade do MVP.
- Diferencial principal: histórico de preços e interpretação transparente desse histórico.

## 2. Objetivos de aprendizado

Um dos objetivos centrais do projeto é aprender a integrar diferentes APIs externas em uma única aplicação.

O desenvolvimento deve permitir praticar:
- Consumo de APIs HTTP.
- Query strings, parâmetros, paginação e filtros.
- Autenticação e gestão segura de credenciais.
- Tratamento de erros, timeouts, limites de requisição e indisponibilidade.
- Validação de respostas externas.
- Normalização de dados com formatos diferentes.
- Integração simultânea de múltiplos provedores.
- Persistência de ofertas e observações históricas.
- Testes automatizados de integrações.

**Metodologia desejada:** híbrida. Explicar as decisões, implementar passo a passo e propor pequenos desafios para o usuário. Não simplesmente gerar toda a solução sem explicar. O usuário quer compreender o código e ganhar autonomia para integrar APIs desconhecidas usando a documentação oficial.

## 3. Escopo funcional planejado

### Núcleo do MVP
1. Pesquisar produtos.
2. Consultar uma ou mais fontes externas.
3. Normalizar resultados para um modelo interno comum.
4. Identificar produtos equivalentes com cuidado (modelo, variante, capacidade, GTIN/EAN quando disponível).
5. Associar ofertas de lojas diferentes ao mesmo produto canônico.
6. Registrar observações de preço ao longo do tempo.
7. Exibir página do produto com gráfico histórico.
8. Calcular indicadores básicos: menor, maior e média no período disponível.

### Funcionalidades posteriores
- Alertas de preço-alvo.
- Favoritos e contas de usuário.
- Notificações por e-mail ou WhatsApp.
- Mais provedores e lojas.
- Painel administrativo de fontes, produtos, ofertas e falhas de coleta.
- Análises mais sofisticadas e recomendações de compra.

Não ampliar o MVP com todas essas funcionalidades de uma vez. Priorizar uma integração confiável e um histórico correto.

## 4. Stack tecnológica proposta

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js + React + TypeScript |
| Backend | Node.js + TypeScript |
| API interna | REST |
| Banco de dados | PostgreSQL |
| ORM | Prisma |
| Estilização | Tailwind CSS |
| Gráficos | Recharts |
| Validação | Zod |
| Testes | Vitest + Supertest |
| Infraestrutura local | Docker |
| HTTP inicial | `fetch` nativo do Node.js |
| Filas/agendamento futuro | Redis + BullMQ, se necessário |

A stack é uma proposta acordada, não uma implementação já existente. Começar pelo backend integrador; não criar frontend ou banco antes de validar a primeira consulta externa, a menos que haja uma razão técnica clara.

## 5. Arquitetura de integrações: Provider Adapter

A integração de provedores é um dos pilares arquiteturais.

Não espalhar chamadas específicas de cada marketplace pelos módulos de negócio. Cada fonte deve ter seu adaptador, responsável por:
1. Fazer a chamada HTTP.
2. Autenticar quando necessário.
3. Tratar paginação, limites e erros específicos.
4. Validar a resposta externa.
5. Converter os dados para um modelo interno normalizado.

Os módulos de negócio devem depender de contratos internos, não dos formatos proprietários de cada API.

Contrato conceitual inicial (pode ser refinado durante a implementação):

```ts
export interface ProductProvider {
  name: string;
  searchProducts(query: string): Promise<NormalizedProduct[]>;
}

export interface NormalizedProduct {
  externalId: string;
  name: string;
  brand?: string;
  model?: string;
  gtin?: string;
  imageUrl?: string;
  offer: {
    price: number;
    currency: "BRL";
    productUrl: string;
    storeName: string;
  };
}
```

Esse exemplo é ilustrativo. Ao implementar, considerar que uma busca pode retornar várias ofertas, que alguns campos podem faltar e que a resposta deve preservar identificadores e metadados úteis da origem. Não assumir que o nome do marketplace é necessariamente o vendedor.

### Fluxo lógico

```text
Usuário pesquisa produto
        |
        v
Serviço de pesquisa interno
        |
        +---- Provider Adapter A
        |
        +---- Provider Adapter B
        |
        +---- Provider Adapter C
        |
        v
Validação e normalização
        |
        v
Resolução/associação de produtos
        |
        v
Persistência de produtos, ofertas e observações
        |
        v
Resposta unificada ao frontend
```

O serviço de pesquisa deve lidar com falhas parciais: se um provedor falhar, avaliar se os resultados dos outros ainda podem ser retornados. Não permitir que uma falha isolada derrube necessariamente a pesquisa inteira.

## 6. Primeira integração: Mercado Livre

A primeira fonte escolhida é o Mercado Livre.

Endpoint de busca que será investigado inicialmente:

```http
GET https://api.mercadolibre.com/sites/MLB/search?q=iphone
```

Documentação de referência:
- https://developers.mercadolivre.com.br/
- https://developers.mercadolivre.com.br/pt_br/itens-e-buscas

A disponibilidade, autenticação, permissões e limites devem ser confirmados na documentação atual antes de depender do endpoint. Não assumir que todos os endpoints são públicos ou que não exigem token. Se houver `401` ou `403`, investigar os requisitos oficiais de autenticação e autorização.

A segunda API ainda **não foi escolhida**. Amazon Creators API foi mencionada como possibilidade futura, mas não deve ser tratada como integração confirmada; há requisitos de programa de afiliados e acesso que precisam ser verificados. Escolher uma segunda fonte acessível para desenvolvimento e testes antes de iniciar essa integração.

## 7. Modelo de domínio e histórico

Conceitos principais:

- **Product:** identidade canônica do produto, independente da loja.
- **Store:** loja ou vendedor/origem comercial, conforme o modelo final.
- **Offer:** oferta específica de um produto em uma loja, com URL e identificador externo.
- **PriceHistory / PriceObservation:** observação imutável do preço de uma oferta em determinado instante.
- **Category:** classificação do produto.
- **User** e **PriceAlert:** entidades futuras, não obrigatórias no primeiro incremento.

Relações conceituais:

```text
Category 1 ---- N Product
Product  1 ---- N Offer
Store    1 ---- N Offer
Offer    1 ---- N PriceObservation

User     1 ---- N PriceAlert
Product  1 ---- N PriceAlert
```

### Regras de integridade importantes

1. Cada produto canônico deve representar a variante correta. Não confundir, por exemplo, um celular de 128 GB com outro de 256 GB.
2. Um produto pode ter várias ofertas em lojas diferentes.
3. Cada oferta mantém seu próprio histórico.
4. Observações históricas não devem ser sobrescritas; inserir novos registros com data/hora.
5. Registrar a origem da observação e o instante de coleta.
6. Distinguir preço do produto de frete e, quando possível, registrar ambos.
7. Falhas de coleta nunca devem ser gravadas como preço zero.
8. Tratar moeda explicitamente (inicialmente BRL).
9. Considerar disponibilidade/indisponibilidade da oferta e qualidade/atualidade do dado.
10. Não comparar variantes diferentes como se fossem o mesmo produto.
11. Evitar duplicatas de observações causadas por reprocessamento; definir uma estratégia de idempotência.
12. Diferenciar preço anunciado, preço promocional, preço à vista e condições parceladas quando a fonte fornecer essas informações.

### Indicadores de preço

A plataforma poderá exibir:
- Menor preço registrado.
- Maior preço registrado.
- Média no período.
- Evolução ao longo do tempo.
- Comparação entre preço atual e histórico.

Classificações como “preço baixo”, “normal” ou “alto” devem usar regras transparentes e considerar quantidade, cobertura e qualidade dos dados. Não classificar como oportunidade confiável com apenas poucas observações. Sempre indicar o período efetivamente coberto; não inventar histórico anterior à primeira coleta confiável.

## 8. Estrutura inicial sugerida

Estrutura ilustrativa para o backend; ajustar conforme o projeto evoluir:

```text
price-tracker-api/
├── src/
│   ├── integrations/
│   │   ├── contracts/
│   │   │   └── product-provider.ts
│   │   ├── providers/
│   │   │   └── mercadolivre/
│   │   │       ├── mercadolivre.provider.ts
│   │   │       ├── mercadolivre.schemas.ts
│   │   │       └── mercadolivre.mapper.ts
│   │   └── product-search.service.ts
│   ├── modules/
│   │   ├── products/
│   │   ├── offers/
│   │   └── price-history/
│   ├── infrastructure/
│   │   ├── database/
│   │   └── http/
│   ├── shared/
│   └── index.ts
├── prisma/
├── tests/
├── .env.example
├── .gitignore
├── package.json
└── tsconfig.json
```

A estrutura pode começar menor. Evitar criar pastas e abstrações vazias apenas para parecer sofisticado.

## 9. Estado atual do projeto

**Ainda estamos na fase de planejamento e preparação da primeira integração.**

Decisões já tomadas:
- Nome de trabalho: Price Tracker.
- Produtos em geral como visão de longo prazo.
- Diferencial: histórico de preços.
- Objetivo imediato: portfólio e aprendizado.
- Backend Node.js + TypeScript.
- Frontend planejado em Next.js.
- PostgreSQL + Prisma planejados.
- Padrão Adapter para múltiplos provedores.
- Primeira fonte escolhida: Mercado Livre.
- Método de aprendizado: explicação + implementação conjunta + desafios.

Ainda não confirmado/implementado:
- Repositório e arquivos locais.
- Instalação de dependências.
- Teste real da API do Mercado Livre.
- Autenticação e permissões da API.
- Contrato TypeScript definitivo.
- Banco de dados e migrations.
- Segunda fonte de dados.
- Coletor periódico.
- Interface frontend.

## 10. Primeiro incremento de implementação

O primeiro marco é criar um pequeno backend/integrador que pesquise produtos no Mercado Livre e retorne resultados normalizados.

Passos sugeridos:

1. Verificar versões instaladas de Node.js e npm.
2. Criar projeto Node.js + TypeScript.
3. Instalar dependências iniciais: `typescript`, `tsx`, `dotenv`, `zod` e tipos do Node.
4. Configurar scripts de desenvolvimento e compilação.
5. Fazer uma requisição de teste ao endpoint de busca do Mercado Livre.
6. Inspecionar a resposta real e confirmar os campos disponíveis.
7. Criar schemas Zod para validar os campos usados.
8. Implementar o adaptador do Mercado Livre.
9. Mapear a resposta para o modelo interno normalizado.
10. Tratar erros HTTP, timeout, resposta inválida e campos ausentes.
11. Criar testes unitários usando respostas mockadas.
12. Só depois avaliar uma segunda fonte e a integração simultânea.

Comandos inicialmente sugeridos:

```bash
mkdir price-tracker-api
cd price-tracker-api
npm init -y
npm install typescript tsx dotenv zod
npm install -D @types/node
npx tsc --init
```

Usar `fetch` nativo inicialmente para aprender os fundamentos de HTTP; Axios pode ser considerado depois se houver benefício concreto.

## 11. Orientações para o Codex

- Leia este documento antes de propor ou realizar alterações.
- Não afirme que algo está implementado sem inspecionar o repositório.
- Primeiro examine a estrutura e os arquivos existentes; preserve trabalho prévio.
- Não crie uma aplicação inteira de uma vez. Trabalhe em incrementos pequenos e verificáveis.
- Explique brevemente o objetivo de cada alteração e as decisões técnicas.
- Priorize código legível, tipado, testável e apropriado ao estágio do projeto.
- Não coloque tokens, senhas ou credenciais no código, commits ou documentação. Use variáveis de ambiente e mantenha `.env` fora do Git.
- Não invente campos de APIs. Consulte documentação e/ou inspecione respostas reais; valide dados externos.
- Não acople o domínio ao formato específico do Mercado Livre.
- Preserve a separação entre produto canônico, oferta e observação de preço.
- Não introduza Redis, filas, microserviços ou complexidade prematura sem necessidade demonstrada.
- Não implemente scraping de lojas sem avaliar termos de uso, permissões, estabilidade e alternativas oficiais.
- Quando houver decisão importante ainda em aberto, apresente opções e explique impactos antes de escolher.
- Após cada incremento, execute os testes e informe exatamente o que foi verificado e o que permanece pendente.
- O usuário quer aprender: explique os conceitos e proponha pequenos desafios, em vez de simplesmente entregar código sem contexto.

## 12. Próxima ação imediata

Começar verificando o ambiente e a existência do repositório. Em seguida, criar o projeto backend mínimo e testar a consulta inicial ao Mercado Livre. Não iniciar banco, frontend ou múltiplas integrações antes de validar esse primeiro fluxo.

---

**Resumo em uma frase:** construir uma plataforma de histórico de preços com Node.js/TypeScript, aprendendo a integrar múltiplas APIs por meio de adaptadores independentes e normalização de dados, começando por uma integração funcional com o Mercado Livre.
