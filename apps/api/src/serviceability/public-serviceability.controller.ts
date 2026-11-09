import { Controller, Get, Inject, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ServiceabilityService } from './serviceability.service.js';
import { optionalPublicSearch } from '../common/public-query.js';

/**
 * Public, read-only destination lookup for the storefront.
 *
 * Exposes only city id/name/code and an aggregate store count. No store, vendor or
 * rider identity is revealed, and nothing that is DRAFT, SUSPENDED or pending
 * review can appear. Session-free by design so a buyer can pick a destination
 * before signing in; the global throttler still applies.
 */
@ApiTags('public-serviceability')
@Controller('public/serviceability')
export class PublicServiceabilityController {
  constructor(@Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService) {}

  @Get('cities')
  cities(
    @Query('countryId', ParseUUIDPipe) countryId: string,
    @Query('q') q?: unknown,
  ) {
    return this.serviceability.publicServiceableCities(countryId.toLowerCase(), optionalPublicSearch(q, 60));
  }
}
