import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

// Thrown instead of a NestJS HTTP exception so callers (adapters, processors)
// can decide how to handle the failure without coupling Claude errors to HTTP
// response shapes. Only InferenceService throws this; no other module imports
// it directly.
export class InferenceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InferenceUnavailableError';
  }
}

export interface InferenceParams {
  model: string;
  maxTokens: number;
  system: string;
  user: string;
  correlationId: string;
  timeoutMs: number;
}

// Wraps the Anthropic SDK. No other module in the codebase imports from
// @anthropic-ai/sdk directly (NFR-29, NFR-30). All Claude calls flow through
// these two methods. Config is read at call time (not at initialization) so a
// missing key fails closed on first call, not on application start (section
// 2.3 of the E10 architecture doc).
@Injectable()
export class InferenceService {
  private readonly logger = new Logger(InferenceService.name);

  constructor(private configService: ConfigService) {}

  // For non-streaming calls: fit reasoning and brand safety tier-2.
  async completeText(params: InferenceParams): Promise<string> {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new InferenceUnavailableError('ANTHROPIC_API_KEY is not configured');
    }

    const client = new Anthropic({ apiKey });
    const startMs = Date.now();
    let outcome: 'success' | 'error' | 'timeout' = 'success';

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new InferenceUnavailableError('Claude API call timed out')),
        params.timeoutMs,
      ),
    );

    const callPromise = client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: [{ role: 'user', content: params.user }],
    });

    try {
      const response = await Promise.race([callPromise, timeoutPromise]);
      const durationMs = Date.now() - startMs;

      const textBlock = response.content.find((b) => b.type === 'text');
      const text = textBlock?.type === 'text' ? textBlock.text : '';

      this.logger.log({
        message: 'Claude API call completed',
        correlationId: params.correlationId,
        model: params.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        durationMs,
        outcome,
      });

      return text;
    } catch (error) {
      const durationMs = Date.now() - startMs;

      if (error instanceof InferenceUnavailableError) {
        outcome = 'timeout';
        this.logger.warn({
          message: 'Claude API call timed out',
          correlationId: params.correlationId,
          model: params.model,
          durationMs,
          outcome,
        });
        throw error;
      }

      outcome = 'error';
      const apiError = error as { status?: number; message?: string };
      this.logger.warn({
        message: 'Claude API call failed',
        correlationId: params.correlationId,
        model: params.model,
        durationMs,
        outcome,
        errorCode: apiError.status,
      });
      throw new InferenceUnavailableError(
        `Claude API error: ${apiError.message || String(error)}`,
      );
    }
  }

  // For streaming calls: briefing Q&A. Yields tokens as they arrive.
  // Throws InferenceUnavailableError before the first token if the initial
  // handshake fails.
  async *streamText(params: InferenceParams): AsyncGenerator<string> {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new InferenceUnavailableError('ANTHROPIC_API_KEY is not configured');
    }

    const client = new Anthropic({ apiKey });
    const startMs = Date.now();

    // Apply timeout only to the initial connection. Mid-stream errors are
    // propagated as thrown exceptions from the generator, handled by the
    // caller (the SSE endpoint handler) per section 4.2 of the architecture.
    let stream: Awaited<ReturnType<typeof client.messages.stream>>;
    const connectTimeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new InferenceUnavailableError('Claude API connection timed out')),
        params.timeoutMs,
      ),
    );

    try {
      stream = await Promise.race([
        client.messages.stream({
          model: params.model,
          max_tokens: params.maxTokens,
          system: params.system,
          messages: [{ role: 'user', content: params.user }],
        }),
        connectTimeout,
      ]);
    } catch (error) {
      const durationMs = Date.now() - startMs;
      if (error instanceof InferenceUnavailableError) {
        this.logger.warn({
          message: 'Claude stream connection timed out',
          correlationId: params.correlationId,
          model: params.model,
          durationMs,
          outcome: 'timeout',
        });
        throw error;
      }
      const apiError = error as { status?: number; message?: string };
      this.logger.warn({
        message: 'Claude stream connection failed',
        correlationId: params.correlationId,
        model: params.model,
        durationMs,
        outcome: 'error',
        errorCode: apiError.status,
      });
      throw new InferenceUnavailableError(
        `Claude API error: ${apiError.message || String(error)}`,
      );
    }

    let inputTokens = 0;
    let outputTokens = 0;

    try {
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield event.delta.text;
        }
        if (event.type === 'message_delta' && event.usage) {
          outputTokens = event.usage.output_tokens;
        }
        if (event.type === 'message_start' && event.message.usage) {
          inputTokens = event.message.usage.input_tokens;
        }
      }

      const durationMs = Date.now() - startMs;
      this.logger.log({
        message: 'Claude stream completed',
        correlationId: params.correlationId,
        model: params.model,
        inputTokens,
        outputTokens,
        durationMs,
        outcome: 'success',
      });
    } catch (error) {
      const durationMs = Date.now() - startMs;
      const apiError = error as { status?: number; message?: string };
      this.logger.warn({
        message: 'Claude stream failed mid-stream',
        correlationId: params.correlationId,
        model: params.model,
        durationMs,
        outcome: 'error',
        errorCode: apiError.status,
      });
      throw new InferenceUnavailableError(
        `Claude stream error: ${apiError.message || String(error)}`,
      );
    }
  }
}
