import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../common/prisma.js';
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  @Get('live')
  live() { return { status: 'ok', service: 'get-stoopy-api' }; }
  @Get('ready')
  async ready() { await this.db.$queryRaw`SELECT 1`; return { status: 'ok', database: 'reachable' }; }
}
