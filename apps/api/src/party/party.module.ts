import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PartyController } from './party.controller.js';
import { PartyService } from './party.service.js';
@Module({ imports: [AuthModule], controllers: [PartyController], providers: [PartyService], exports: [PartyService] })
export class PartyModule {}
