<div align="center">

# Aurora

**Projeto de Engenharia de Software — Inteli, Instituto de Tecnologia e Liderança**

Módulo 2A · 2026 · Autora: Kaiane Souza Cordeiro

</div>

---

## O que é Aurora

Aurora é uma plataforma de infraestrutura para campanhas de creator marketing no mid-market brasileiro. Uma marca define orçamento, público e mensagem uma única vez; Aurora cuida do matching, briefing, brand safety e pagamento de cada criador do pool — tratando o conjunto como uma unidade de mídia que se compra inteira.

A motivação completa, a análise de mercado e as decisões de produto estão em [`docs/business-analysis.md`](docs/business-analysis.md) e [`docs/product-requirements.md`](docs/product-requirements.md).

---

## O que está neste repositório

Este é o repositório **interno** do projeto. Ele contém tudo:

- Código-fonte completo (`backend/` e `frontend/`)
- Documentação de produto, arquitetura e épicos (`docs/`)
- Pesquisa de campo com empresas do setor (`docs/field-research/`) — mantida apenas aqui por solicitação dos entrevistados
- Pitch deck interativo e relatório do módulo

O repositório público (espelho no GitHub) não inclui o código-fonte nem a pesquisa de campo.

---

## Demo ao vivo

| | |
|---|---|
| Frontend | [aurora-kaiane.vercel.app](https://aurora-kaiane.vercel.app) |
| API (Swagger) | [aurora-production-b051.up.railway.app/api/docs](https://aurora-production-b051.up.railway.app/api/docs) |

Credenciais de demo e instruções de seed estão em [`docs/deployment.md`](docs/deployment.md).

---

## Épicos entregues

| Épico | Nome | Resumo do revisor |
|---|---|---|
| E1 | Acesso e Onboarding | [summary.md](docs/epics/e1-access-onboarding/summary.md) |
| E2 | Planejamento de Campanha e Pool Buying | [summary.md](docs/epics/e2-campaign-planning-pool-buying/summary.md) |
| E3 | Matching e Curadoria de Criadores | [summary.md](docs/epics/e3-creator-matching-curation/summary.md) |
| E4 | Brand Safety | [summary.md](docs/epics/e4-brand-safety/summary.md) |
| E5 | Briefing e Workflow de Conteúdo | [summary.md](docs/epics/e5-briefing-content-workflow/summary.md) |
| E6 | Pagamentos e Transparência Financeira | [summary.md](docs/epics/e6-payments-financial-transparency/summary.md) |
| E7 | Analytics e Relatórios | [summary.md](docs/epics/e7-analytics-reporting/summary.md) |
| E8 | Recrutamento e Crescimento de Criadores | [summary.md](docs/epics/e8-creator-recruitment-growth/summary.md) |
| E9 | Operações Multi-Cliente para Agências | [summary.md](docs/epics/e9-agency-multi-client-operations/summary.md) |
| E10 | AI Creator Demo | [summary.md](docs/epics/e10-ai-creator-demo/summary.md) |

Cada summary cobre: o que foi construído, contagem de testes, desvios do design e gaps de cobertura.

---

## Documentação principal

| Documento | Conteúdo |
|---|---|
| [Pipeline de implementação](docs/implementation.md) | Como o pipeline de agentes funciona, como rodar localmente, como testar |
| [Análise de negócios](docs/business-analysis.md) | Creator economy, Porter, SWOT, Gap Analysis, Personas, modelo de receita |
| [Requisitos de produto](docs/product-requirements.md) | 47 user stories, 60 RFs, 36 RNFs |
| [Arquitetura](docs/architecture.md) | Decisões arquiteturais, ATAM, segurança, DevOps |
| [ADRs](docs/adr/) | 68 Architecture Decision Records (ADR-0001 a ADR-0068) |
| [Pitch deck](docs/pitch/pitch-deck.html) | Deck interativo — mercado, solução, demo, próximos passos |
| [Pesquisa de campo](docs/field-research/) | Análises das entrevistas com Creator Ads e PlayNest |
| [Implantação](docs/deployment.md) | Passo a passo Railway + Vercel, variáveis, seed |

---

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | NestJS · TypeScript · PostgreSQL 16 · Redis |
| Frontend | React · Vite · TypeScript |
| IA | Claude (Anthropic) — brand safety e fit score |
| Infraestrutura | Railway · Vercel · GitHub Actions CI · GitLab CI |

---

## Como rodar localmente

```bash
# 1. Postgres e Redis
docker compose up -d

# 2. Backend
cd backend && cp .env.example .env && npm install
npx tsx src/database/run-migrations.ts
npm run seed:demo        # seed completo para a apresentação
npm run start:dev        # http://localhost:3001

# 3. Frontend (outro terminal)
cd frontend && npm install
npm run dev              # http://localhost:5173
```

Instruções detalhadas, incluindo variáveis de ambiente e seed de criadores, em [`docs/implementation.md`](docs/implementation.md).

---

## Suíte de testes

```bash
cd backend  && npm test          # 523 testes unitários
cd backend  && npm run test:e2e  # integração real com Postgres
cd frontend && npm test          # 218 testes
```

---

**Autora:** Kaiane Souza Cordeiro · kaiane.cordeiro@sou.inteli.edu.br  
**Instituição:** [Inteli — Instituto de Tecnologia e Liderança](https://www.inteli.edu.br/)
