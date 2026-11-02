import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ENV } from '../common/env.js';
import type { ApiEnv } from '@getstoopy/config';
import { DeliveryController } from './delivery.controller.js';
import { DeliveryService } from './delivery.service.js';
import { DELIVERY_OTP_CHANNEL, TEST_DELIVERY_OTP_SINK, DisabledDeliveryOtpChannel, TestDeliveryOtpChannel, TestDeliveryOtpSink } from './delivery-otp.channel.js';

@Module({
  imports: [AuthModule],
  controllers: [DeliveryController],
  providers: [
    DeliveryService,
    { provide: TEST_DELIVERY_OTP_SINK, useFactory: (env: ApiEnv) => env.NODE_ENV === 'test' && env.DELIVERY_OTP_CHANNEL === 'test' ? new TestDeliveryOtpSink() : null, inject: [ENV] },
    { provide: DELIVERY_OTP_CHANNEL, useFactory: (env: ApiEnv, sink: TestDeliveryOtpSink | null) => env.DELIVERY_OTP_ENABLED && env.DELIVERY_OTP_CHANNEL === 'test' && sink ? new TestDeliveryOtpChannel(sink) : new DisabledDeliveryOtpChannel(), inject: [ENV, TEST_DELIVERY_OTP_SINK] }
  ],
  exports: [DeliveryService]
})
export class DeliveryModule {}
