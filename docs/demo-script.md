# Roteiro de Gravacao — Demo Aurora

**Data:** 2026-11-24
**Ambiente:** Vercel (frontend) + Railway (backend/DB)
**Preparacao:** Rodar `DEMO_SEED_ALLOWED=true npm run seed:demo:reset` apontando para o banco do Railway antes de gravar.

---

## CONTA MARINA (marca)

**Login:** demo-bella@aurora.internal / Demo@2026

### Cena 1 — Shortlist AI

1. Login → vai direto para `/app/home`
2. Abre a campanha **"Verao Bella 2027"**
3. Clica em **Shortlist**
4. Mostra os 4 creators com o **fit score** e o **texto de justificativa da IA** em cada card
5. **Narracao:** "Aqui o shortlist ja aprovado, com o fit_reason que a IA gerou para cada creator — cada justificativa cita dados reais como taxa de engajamento, nicho e tamanho do publico."

### Cena 2 — Briefing Q&A com AI

1. Ainda na campanha → abre **Briefing** → clica em **"Ver perguntas dos criadores"**
2. Clica na thread da **@dudamartins**
3. Clica em **"✦ Responder com AI"** → mostra o **streaming acontecendo em tempo real**
4. **Narracao:** "A IA responde com base exclusivamente no conteudo do briefing, em portugues, e o creator ve os tokens aparecendo ao vivo."

### Cena 3 — Brand Safety (Fila de Revisao)

1. Menu lateral → **Fila de Revisao**
2. Mostra a **@natybeauty** flagrada com **"Regra violada"** → clica **Rejeitar**
3. Mostra a **@carolinafit** com **"Verificacao indisponivel"** → clica **Solicitar revisao**
4. **Narracao:** "A IA analisa cada submissao contra as regras de marca. A @natybeauty mencionou 'testes em animais', que e um topico proibido pela Bella. A @carolinafit esta pendente de analise semantica pelo tier 2."

### Cena 4 — Dashboard ROI + Invoice

1. Vai para a campanha **"Hidratante Noturno Q4 2026"**
2. Clica em **Relatorio** → espera gerar e mostra o grafico com os 3 creators
3. Clica em **Gerar PDF**
4. Menu lateral → **Invoice** → mostra a invoice emitida e paga
5. **Narracao:** "O relatorio agrega metricas reais de cada creator e a invoice e gerada automaticamente com base no budget da campanha."

---

## FAZ LOGOUT

---

## CONTA DUDA (creator)

**Login:** demo-duda@aurora.internal / Demo@2026

### Cena 5 — Creator Home + Oportunidades

1. Login → vai para `/creator-portal/home`
2. Clica em **Oportunidades**
3. Mostra a campanha Bella Verao aceita com o valor liquido e o link pro briefing
4. **Narracao:** "O creator ve suas oportunidades ativas com o valor liquido ja descontada a comissao da plataforma."

### Cena 6 — Brand Safety AI ao vivo (upload de Reels)

> **Essa e a cena-chave de IA no brand safety.** O creator envia um rascunho com video e a IA analisa em tempo real.

1. Menu → **Enviar rascunho** (ou navega para `/creator-portal/drafts/new`)
2. Seleciona a oportunidade **"Bella Natural Cosmeticos · reels"**
3. **Arrasta um video .mp4 curto** na area de upload → mostra o preview do video no player
4. Escreve na legenda: **"Adorei esse protetor! Sem parabenos e sem testes em animais, a Bella cuida de tudo. #BellaNatural"**
   - Essa legenda viola duas regras: "parabenos" (topico proibido) e "testes em animais" (topico proibido)
5. Clica em **Enviar rascunho**
6. Mostra a **animacao de analise da IA** com os 3 passos:
   - ✓ Extraindo texto visivel do video...
   - ✓ Transcrevendo audio do conteudo...
   - ⟳ Verificando regras de seguranca de marca...
7. Resultado: **Submissao flagrada** com as regras acionadas
8. **Narracao:** "O creator enviou um Reels com uma legenda que menciona topicos proibidos pela marca. A IA detectou automaticamente as violacoes e bloqueou o conteudo — ele agora vai para a fila de revisao humana que vimos na Cena 3."

### Cena 7 — Creator Q&A + Pagamentos

1. Volta para **Briefing** → abre a thread de Q&A
2. Faz uma nova pergunta (ex: "Posso gravar em ambiente externo ou precisa ser em estudio?")
3. Mostra a **IA respondendo em streaming**
4. Menu → **Pagamentos** → mostra os dois registros (owed + settled)
5. **Narracao:** "O creator pode tirar duvidas sobre o briefing a qualquer momento e recebe respostas instantaneas da IA. Os pagamentos mostram o historico completo."

---

## FAZ LOGOUT

---

## CONTA AGENCIA (agencia)

**Login:** demo-agencia@aurora.internal / Demo@2026

### Cena 8 — Visao consolidada

1. Login → vai para a visao de **Clientes**
2. Abre **NovaTech** → mostra campanha ativa + campanha encerrada com relatorio comparativo
3. **Narracao:** "A agencia tem visao consolidada de todos os clientes, com campanhas ativas e historico de performance comparado."

---

## Resumo das Features de IA demonstradas

| Cena | Feature de IA | Como e mostrada |
|------|--------------|-----------------|
| 1 | Shortlist com fit_score + fit_reason | Texto pre-gerado pela IA com dados quantitativos |
| 2 | Briefing Q&A streaming | IA responde ao vivo, token por token |
| 3 | Brand Safety — fila de revisao | Resultado da deteccao automatica de violacoes |
| 4 | Relatorio de performance | Geracao ao vivo de relatorio agregado |
| 6 | **Brand Safety AI ao vivo** | Creator envia Reels + legenda → IA analisa em tempo real → flagged |
| 7 | Briefing Q&A streaming (creator) | Creator faz pergunta ao vivo e ve IA respondendo |

---

## Checklist pre-gravacao

- [ ] Seed executado com sucesso no Railway (`DEMO_SEED_ALLOWED=true npm run seed:demo:reset`)
- [ ] Vercel deploy completo (verificar que o botao "✦ Responder com AI" aparece)
- [ ] Ter um video .mp4 curto (5-10s) pronto para arrastar na Cena 6
- [ ] Testar login das 3 contas antes de gravar
- [ ] Verificar que a fila de revisao mostra @natybeauty e @carolinafit
