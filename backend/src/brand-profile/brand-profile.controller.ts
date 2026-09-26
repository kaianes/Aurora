import {
  Controller,
  Post,
  Patch,
  Get,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { BrandProfileService } from './brand-profile.service';
import { CreateBrandProfileDto } from './dto/create-brand-profile.dto';
import { UpdateBrandProfileDto } from './dto/update-brand-profile.dto';
import { Roles, CurrentUser } from '../common/decorators';
import { Role } from '../database/entities';

interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller('brand-profiles')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class BrandProfileController {
  constructor(private brandProfileService: BrandProfileService) {}

  @Post()
  @Roles(
    Role.BRAND_OWNER,
    Role.BRAND_MANAGER,
    Role.AGENCY_ADMIN,
    Role.AGENCY_OPERATOR,
  )
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateBrandProfileDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.brandProfileService.create(
      (req as any).currentAccountId,
      dto,
      user.sub,
      req.ip || '',
      req.headers['user-agent'] || '',
    );
  }

  @Patch(':id')
  @Roles(
    Role.BRAND_OWNER,
    Role.BRAND_MANAGER,
    Role.AGENCY_ADMIN,
    Role.AGENCY_OPERATOR,
  )
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateBrandProfileDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.brandProfileService.update(
      id,
      (req as any).currentAccountId,
      dto,
      user.sub,
      req.ip || '',
      req.headers['user-agent'] || '',
    );
  }

  @Get('current')
  @HttpCode(HttpStatus.OK)
  async getCurrent(@Req() req: Request) {
    return this.brandProfileService.getCurrent(
      (req as any).currentAccountId ||
        (req as any).user?.currentAccountId,
    );
  }

  @Post(':id/logo')
  @Roles(
    Role.BRAND_OWNER,
    Role.BRAND_MANAGER,
    Role.AGENCY_ADMIN,
    Role.AGENCY_OPERATOR,
  )
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.OK)
  async uploadLogo(
    @Param('id') id: string,
    @UploadedFile() file: MulterFile,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.brandProfileService.uploadLogo(
      id,
      (req as any).currentAccountId,
      file,
      user.sub,
      req.ip || '',
      req.headers['user-agent'] || '',
    );
  }
}
