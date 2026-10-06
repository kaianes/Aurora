import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsUUID } from 'class-validator';
import { Creator } from '../database/entities';
import { OpportunityService } from './opportunity.service';
import { CreatorAuthGuard } from './creator-auth.guard';
import { Public, CurrentUser } from '../common/decorators';

class CreatorLoginDto {
  @IsUUID()
  creator_id: string;
}

@Controller('creator-portal')
export class CreatorPortalController {
  constructor(
    private opportunityService: OpportunityService,
    private jwtService: JwtService,
    @InjectRepository(Creator)
    private creatorRepo: Repository<Creator>,
  ) {}

  private actorContext(req: Request) {
    return { ipAddress: req.ip || '', userAgent: req.headers['user-agent'] || '' };
  }

  // Pilot-only stub (ADR-0013): E8 owns the real creator login flow (social
  // auth or magic link). This endpoint exists only so US-28 is testable end
  // to end before that flow ships; it issues a creator JWT for a creator row
  // that already exists (seeded for the pilot), with no password.
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: CreatorLoginDto) {
    const creator = await this.creatorRepo.findOne({ where: { id: dto.creator_id } });
    if (!creator) {
      throw new NotFoundException({
        error: { code: 'CREATOR_NOT_FOUND', message: 'Criador nao encontrado.', details: {} },
      });
    }
    const accessToken = this.jwtService.sign(
      { sub: creator.id, creator_id: creator.id },
      { expiresIn: '15m' },
    );
    return { access_token: accessToken, expires_in: 900, creator_id: creator.id };
  }

  @UseGuards(CreatorAuthGuard)
  @Get('opportunities')
  @HttpCode(HttpStatus.OK)
  async list(@CurrentUser() user: any) {
    return this.opportunityService.listForCreator(user.creatorId);
  }

  @UseGuards(CreatorAuthGuard)
  @Post('opportunities/:id/accept')
  @HttpCode(HttpStatus.OK)
  async accept(@Param('id') id: string, @CurrentUser() user: any, @Req() req: Request) {
    return this.opportunityService.accept(id, user.creatorId, this.actorContext(req));
  }

  @UseGuards(CreatorAuthGuard)
  @Post('opportunities/:id/decline')
  @HttpCode(HttpStatus.OK)
  async decline(@Param('id') id: string, @CurrentUser() user: any, @Req() req: Request) {
    return this.opportunityService.decline(id, user.creatorId, this.actorContext(req));
  }
}
