import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { BriefingQaService } from './briefing-qa.service';
import { AskQuestionDto } from './dto/ask-question.dto';
import { AskQuestionAiDto } from './dto/ask-question-ai.dto';
import { CreatorAuthGuard } from '../matching/creator-auth.guard';
import { CurrentUser, CreatorPortalRoute } from '../common/decorators';
import { InferenceService, InferenceUnavailableError } from '../inference/inference.service';
import { Briefing } from '../database/entities';

// Creator side of US-30 (briefing view) and US-31 (Q&A), section 4.3 of the
// E5 architecture doc. Authenticated with a creator JWT (E3's
// CreatorAuthGuard, reused unchanged).
@Controller('creator-portal')
@UseGuards(CreatorAuthGuard)
@CreatorPortalRoute()
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class CreatorPortalBriefingController {
  constructor(
    private briefingQaService: BriefingQaService,
    private inferenceService: InferenceService,
    private configService: ConfigService,
  ) {}

  private actorContext(req: Request) {
    return { ipAddress: req.ip || '', userAgent: req.headers['user-agent'] || '' };
  }

  @Get('briefing')
  @HttpCode(HttpStatus.OK)
  async getBriefing(@Query('campaign_id') campaignId: string, @CurrentUser() user: any) {
    return this.briefingQaService.getBriefingForCreator(campaignId, user.creatorId);
  }

  @Post('briefing/qa')
  @HttpCode(HttpStatus.CREATED)
  async askQuestion(@Body() dto: AskQuestionDto, @CurrentUser() user: any, @Req() req: Request) {
    return this.briefingQaService.askQuestion(dto.campaign_id, user.creatorId, dto.question, this.actorContext(req));
  }

  @Get('briefing/qa')
  @HttpCode(HttpStatus.OK)
  async getOwnThread(@Query('campaign_id') campaignId: string, @CurrentUser() user: any) {
    return this.briefingQaService.getOwnThread(campaignId, user.creatorId);
  }

  // US-10.1: AI-powered briefing Q&A with SSE streaming (section 4.2 of the
  // E10 architecture doc). Uses raw @Res() injection to write SSE events
  // directly because NestJS's @Sse() decorator is GET-only.
  @Post('briefings/:briefingId/qa/:threadId/messages/ask')
  async askQuestionWithAi(
    @Param('briefingId') briefingId: string,
    @Param('threadId') threadId: string,
    @Body() dto: AskQuestionAiDto,
    @CurrentUser() user: any,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const correlationId: string =
      (req as any).correlationId || (req.headers['x-correlation-id'] as string) || 'unknown';

    const model = this.configService.get<string>('ANTHROPIC_MODEL_QA', 'claude-sonnet-4-5');
    const timeoutMs = parseInt(
      this.configService.get<string>('AI_QA_TIMEOUT_MS', '30000'),
      10,
    );

    // Steps 1-4: validate access, persist question. HTTP errors (403, 404,
    // 422) are thrown before the stream opens so they surface as normal HTTP
    // responses, not SSE events.
    let prepared: Awaited<ReturnType<typeof this.briefingQaService.prepareAiQuestion>>;
    try {
      prepared = await this.briefingQaService.prepareAiQuestion(
        briefingId,
        threadId,
        user.creatorId,
        dto.body,
      );
    } catch (err) {
      throw err;
    }

    const { questionMessage, briefing, campaignId } = prepared;

    // Step 3: set SSE headers and begin the event stream.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const emit = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Step 4: emit question_stored.
    emit({
      type: 'question_stored',
      messageId: questionMessage.id,
      body: questionMessage.body,
      senderType: questionMessage.senderType,
      createdAt: questionMessage.createdAt.toISOString(),
    });

    // Step 6: emit ai_thinking.
    emit({ type: 'ai_thinking' });

    // Step 7: stream Claude's response.
    const systemPrompt = this.buildQaSystemPrompt();
    const userPrompt = this.buildQaUserPrompt(briefing, dto.body);

    let accumulatedText = '';
    try {
      for await (const token of this.inferenceService.streamText({
        model,
        maxTokens: 1024,
        system: systemPrompt,
        user: userPrompt,
        correlationId,
        timeoutMs,
      })) {
        accumulatedText += token;
        emit({ type: 'token', delta: token });
      }
    } catch (err) {
      if (err instanceof InferenceUnavailableError) {
        emit({ type: 'error', error: 'ai_unavailable' });
        emit({ type: 'done' });
        res.end();
        return;
      }
      emit({ type: 'error', error: 'ai_unavailable' });
      emit({ type: 'done' });
      res.end();
      return;
    }

    // Steps 9-10: persist AI answer and emit answer_stored + done.
    const answerMessage = await this.briefingQaService.persistAiAnswer(
      questionMessage.threadId,
      campaignId,
      accumulatedText,
    );

    emit({
      type: 'answer_stored',
      messageId: answerMessage.id,
      body: answerMessage.body,
      senderType: answerMessage.senderType,
      createdAt: answerMessage.createdAt.toISOString(),
    });

    emit({ type: 'done' });
    res.end();
  }

  private buildQaSystemPrompt(): string {
    return `Voce e um assistente da plataforma Aurora, especializado em responder perguntas de criadores de conteudo sobre briefings de campanhas de marketing.

Instrucoes:
- Responda SEMPRE em Portugues Brasileiro, independente do idioma da pergunta.
- Use exclusivamente as informacoes presentes no briefing abaixo. Nao invente detalhes nao listados.
- Seja direto, cordial e especifico. Cite o trecho relevante do briefing quando necessario.
- Se a resposta nao estiver claramente definida no briefing, informe isso ao criador e sugira que ele entre em contato com a marca.
- Responda em no maximo 3 paragrafos curtos.`;
  }

  private buildQaUserPrompt(briefing: Briefing, questionBody: string): string {
    const sanitize = (v: string) => v.replace(/[`<>]/g, '');
    const listOrNone = (items: string[] | null | undefined): string => {
      if (!items || items.length === 0) return '(nao informado)';
      return items.map((i) => `- ${sanitize(i)}`).join('\n');
    };

    const spec = briefing.deliverableSpec;
    const specFormat = spec?.format ? sanitize(spec.format) : '(nao informado)';
    const specQty = spec?.quantity != null ? String(spec.quantity) : '(nao informado)';
    const specHashtags =
      spec?.mandatory_hashtags && spec.mandatory_hashtags.length > 0
        ? spec.mandatory_hashtags.join(', ')
        : '(nao informado)';
    const specCaption =
      spec?.caption_length_limit != null ? String(spec.caption_length_limit) : '(nao informado)';
    const specNotes = spec?.notes ? sanitize(spec.notes) : '(nao informado)';

    const deadline = briefing.deadline
      ? briefing.deadline.toISOString().split('T')[0]
      : '(nao informado)';

    return `Briefing da campanha:

O que e permitido fazer (dos):
${listOrNone(briefing.dos)}

O que nao e permitido (donts):
${listOrNone(briefing.donts)}

Especificacao do deliverable:
- Formato: ${specFormat}
- Quantidade de pecas: ${specQty}
- Hashtags obrigatorias: ${specHashtags}
- Limite de caracteres da legenda: ${specCaption}
- Notas adicionais: ${specNotes}

Prazo de entrega: ${deadline}

Exemplos de referencia fornecidos pela marca:
${listOrNone(briefing.referenceExamples)}

Pergunta do criador:
${sanitize(questionBody)}`;
  }
}
