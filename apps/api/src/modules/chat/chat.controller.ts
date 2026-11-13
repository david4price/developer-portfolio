import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  type ChatMessageResponse,
  type ChatSessionResponse,
} from '@portfolio/shared-types';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { API_CONFIG, type ApiConfig } from '../../config/api-config.js';
import { clientAddress, clientBucket } from './client-address.js';
import { sessionCookie, sessionIdFromCookieHeader } from './chat-cookie.js';
import { CHAT_SESSION_TTL_SECONDS, ChatService } from './chat.service.js';

const messageBodySchema = z.strictObject({
  message: z.string().trim().min(1, 'message is empty').max(CHAT_MESSAGE_MAX_LENGTH),
});

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  private bucketOf(request: FastifyRequest): string {
    return clientBucket(
      clientAddress(
        request.socket.remoteAddress,
        request.headers['cf-connecting-ip'],
        this.config.chat.trustCfConnectingIp,
      ),
    );
  }

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  async createSession(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ChatSessionResponse> {
    const { sessionId, session } = await this.chat.createSession(this.bucketOf(request));
    void reply.header('set-cookie', sessionCookie(sessionId, CHAT_SESSION_TTL_SECONDS));
    return { expiresAt: session.expiresAt };
  }

  @Post('messages')
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body(new ZodValidationPipe(messageBodySchema)) body: z.infer<typeof messageBodySchema>,
  ): Promise<ChatMessageResponse> {
    // Stop generating if the visitor goes away before the reply is sent.
    const disconnected = new AbortController();
    reply.raw.once('close', () => {
      if (!reply.raw.writableFinished) disconnected.abort(new Error('client disconnected'));
    });
    return this.chat.sendMessage(
      sessionIdFromCookieHeader(request.headers.cookie),
      body.message,
      this.bucketOf(request),
      disconnected.signal,
    );
  }
}
