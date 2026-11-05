import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min, MinLength, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { NotificationService } from './notification.service.js';
import type { AccessContext } from '@getstoopy/core';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
  notificationErrorMessage,
  parseNotificationInput,
} from '@getstoopy/core';

const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 100;

class CreateNotificationDto {
  @IsUUID() userId!: string;
  @IsString() @IsIn(NOTIFICATION_TYPES) type!: string;
  @IsString() @IsIn(NOTIFICATION_CHANNELS) channel!: string;
  @IsString() @MinLength(1) @MaxLength(200) subject!: string;
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
  @IsOptional() @IsUUID() templateId?: string | null;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!: string;
}

class UpdatePreferenceDto {
  @IsString() @IsIn(NOTIFICATION_CHANNELS) channel!: string;
  @IsBoolean() enabled!: boolean;
}

@ApiTags('notification')
@Controller('notifications')
@UseGuards(SessionGuard)
export class NotificationController {
  constructor(@Inject(NotificationService) private readonly notification: NotificationService) {}

  private ctx(req: Request) { return (req as any).accessContext as AccessContext; }

  private pagination(limit?: string, cursor?: string) {
    const parsedLimit = limit === undefined ? LIMIT_DEFAULT : Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > LIMIT_MAX) {
      throw new BadRequestException({ code: 'LIMIT_INVALID', message: `limit must be 1-${LIMIT_MAX}` });
    }
    if (cursor !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor)) {
      throw new BadRequestException({ code: 'CURSOR_INVALID', message: 'Invalid cursor' });
    }
    return { limit: parsedLimit, ...(cursor ? { cursor } : {}) };
  }

  @Get()
  list(@Req() req: Request, @Query('userId') userId?: string, @Query('status') status?: string, @Query('channel') channel?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    if (!userId) throw new BadRequestException({ code: 'USER_ID_REQUIRED', message: 'userId query parameter is required' });
    if (status !== undefined && !NOTIFICATION_STATUSES.includes(status as any)) {
      throw new BadRequestException({ code: 'NOTIFICATION_STATUS_INVALID', message: 'Invalid notification status' });
    }
    if (channel !== undefined && !NOTIFICATION_CHANNELS.includes(channel as any)) {
      throw new BadRequestException({ code: 'NOTIFICATION_CHANNEL_INVALID', message: 'Invalid notification channel' });
    }
    const paginationParams = this.pagination(limit, cursor);
    return this.notification.listNotifications(this.ctx(req), userId, {
      ...(status !== undefined ? { status } : {}),
      ...(channel !== undefined ? { channel } : {}),
      ...paginationParams,
    });
  }

  @Get('preferences')
  preferences(@Req() req: Request, @Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException({ code: 'USER_ID_REQUIRED', message: 'userId query parameter is required' });
    return this.notification.getPreferences(this.ctx(req), userId);
  }

  @Post('preferences')
  @UseGuards(CsrfGuard)
  updatePreference(@Req() req: Request, @Query('userId') userId?: string, @Body() body?: unknown) {
    if (!userId) throw new BadRequestException({ code: 'USER_ID_REQUIRED', message: 'userId query parameter is required' });
    const { channel, enabled } = body as Record<string, unknown>;
    if (typeof channel !== 'string' || !NOTIFICATION_CHANNELS.includes(channel as any)) {
      throw new BadRequestException({ code: 'NOTIFICATION_CHANNEL_INVALID', message: 'Invalid notification channel' });
    }
    if (typeof enabled !== 'boolean') {
      throw new BadRequestException({ code: 'PREFERENCE_INVALID', message: 'enabled must be a boolean' });
    }
    return this.notification.updatePreference(this.ctx(req), userId, channel, enabled);
  }

  @Get(':id')
  get(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException({ code: 'USER_ID_REQUIRED', message: 'userId query parameter is required' });
    return this.notification.getNotification(this.ctx(req), id, userId);
  }

  @Post()
  @UseGuards(CsrfGuard)
  create(@Req() req: Request, @Body() body: unknown) {
    const parsed = parseNotificationInput(body);
    if (!parsed.ok) throw new BadRequestException({ code: parsed.code, message: notificationErrorMessage(parsed.code, 400) });
    return this.notification.createNotification(this.ctx(req), parsed.value);
  }

  @Patch(':id/read')
  @UseGuards(CsrfGuard)
  read(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Query('userId') userId?: string) {
    if (!userId) throw new BadRequestException({ code: 'USER_ID_REQUIRED', message: 'userId query parameter is required' });
    return this.notification.markRead(this.ctx(req), id, userId);
  }
}
