import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { BriefingQaService } from './briefing-qa.service';
import { AnswerQuestionDto } from './dto/answer-question.dto';
import { Roles } from '../common/decorators';
import { Role } from '../database/entities';
import { InferenceService, InferenceUnavailableError } from '../inference/inference.service';

const WRITE_ROLES = [Role.BRAND_OWNER, Role.BRAND_MANAGER, Role.AGENCY_ADMIN, Role.AGENCY_OPERATOR];

// Brand side of US-31's Q&A thread, section 4.3 of the E5 architecture doc.
@Controller('campaigns')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class BriefingQaController {
  constructor(
    private briefingQaService: BriefingQaService,
    private inferenceService: InferenceService,
    private configService: ConfigService,
  ) {}

  private actorContext(user: any, req: Request) {
    return {
      userId: user.sub,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    };
  }

  @Get(':id/briefing/qa')
  @HttpCode(HttpStatus.OK)
  async listThreads(@Param('id') id: string, @Req() req: Request) {
    return this.briefingQaService.listThreads(id, (req as any).currentAccountId);
  }

  @Get(':id/briefing/qa/:threadId')
  @HttpCode(HttpStatus.OK)
  async getThreadDetail(@Param('id') id: string, @Param('threadId') threadId: string, @Req() req: Request) {
    return this.briefingQaService.getThreadDetail(id, threadId, (req as any).currentAccountId);
  }

  @Post(':id/briefing/qa/:threadId/messages/ai-answer')
  @Roles(...WRITE_ROLES)
  async aiAnswerQuestion(
    @Param('id') id: string,
    @Param('threadId') threadId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const accountId = (req as any).currentAccountId;
    const correlationId: string =
      (req as any).correlationId || (req.headers['x-correlation-id'] as string) || 'unknown';
    const model = this.configService.get<string>('ANTHROPIC_MODEL_QA', 'claude-sonnet-5');
    const timeoutMs = parseInt(this.configService.get<string>('AI_QA_TIMEOUT_MS', '30000'), 10);

    const briefing = await this.briefingQaService.getBriefingForBrand(id, accountId);
    const thread = await this.briefingQaService.getThreadOrFail(id, threadId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const emit = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    emit({ type: 'ai_thinking' });

    const systemPrompt = `Voce e um assistente da plataforma Aurora, ajudando gestores de marca a responder perguntas de criadores de conteudo sobre briefings de campanhas.

Instrucoes:
- Responda SEMPRE em Portugues Brasileiro.
- Use exclusivamente as informacoes presentes no briefing abaixo.
- Seja direto, cordial e especifico. Cite o trecho relevante do briefing quando necessario.
- Se a resposta nao estiver claramente definida no briefing, indique isso e sugira que a marca entre em contato diretamente.
- Responda em no maximo 3 paragrafos curtos.`;

    const sanitize = (v: string) => v.replace(/[`<>]/g, '');
    const listOrNone = (items: string[] | null | undefined) =>
      !items || items.length === 0 ? '(nao informado)' : items.map((i) => `- ${sanitize(i)}`).join('\n');

    const spec = briefing.deliverableSpec as any;
    const userPrompt = `BRIEFING DA CAMPANHA:
Dos (o que o criador deve fazer):
${listOrNone(briefing.dos)}

Don'ts (o que o criador deve evitar):
${listOrNone(briefing.donts)}

Formato do entregavel: ${spec?.format ?? '(nao informado)'}
Quantidade: ${spec?.quantity ?? '(nao informado)'}
Hashtags obrigatorias: ${listOrNone(spec?.mandatory_hashtags)}

Exemplos de referencia:
${listOrNone(briefing.referenceExamples)}

Ultima pergunta do criador nesta thread: (veja o contexto da thread e responda de forma apropriada)`;

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
      } else {
        emit({ type: 'error', error: 'ai_unavailable' });
      }
      emit({ type: 'done' });
      res.end();
      return;
    }

    const answerMessage = await this.briefingQaService.persistAiAnswer(thread.id, id, accumulatedText);

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

  @Post(':id/briefing/qa/:threadId/messages')
  @Roles(...WRITE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  async answerQuestion(
    @Param('id') id: string,
    @Param('threadId') threadId: string,
    @Body() dto: AnswerQuestionDto,
    @Req() req: Request,
  ) {
    return this.briefingQaService.answerQuestion(
      id,
      threadId,
      (req as any).currentAccountId,
      dto.body,
      this.actorContext((req as any).user, req),
    );
  }
}
