import { Module } from '@nestjs/common';
import { VerticalsController } from './verticals.controller';

@Module({
  controllers: [VerticalsController],
})
export class VerticalsModule {}
