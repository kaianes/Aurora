import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BrandProfile } from '../database/entities';
import { BrandProfileController } from './brand-profile.controller';
import { BrandProfileService } from './brand-profile.service';

@Module({
  imports: [TypeOrmModule.forFeature([BrandProfile])],
  controllers: [BrandProfileController],
  providers: [BrandProfileService],
  exports: [BrandProfileService],
})
export class BrandProfileModule {}
