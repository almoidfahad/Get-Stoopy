import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ServiceabilityController } from './serviceability.controller.js';
import { PublicServiceabilityController } from './public-serviceability.controller.js';
import { RiderEligibilityController } from './rider-eligibility.controller.js';
import { ServiceabilityService } from './serviceability.service.js';
import { RiderEligibilityService } from './rider-eligibility.service.js';

@Module({ imports: [AuthModule], controllers: [ServiceabilityController, RiderEligibilityController, PublicServiceabilityController], providers: [ServiceabilityService, RiderEligibilityService], exports: [ServiceabilityService, RiderEligibilityService] })
export class ServiceabilityModule {}
