import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { StorageService } from './storage.service.js';
import type { AccessContext } from '@getstoopy/core';
class CreateUploadDto { @IsString() @MaxLength(64) purpose!: string; @IsString() @MaxLength(120) contentType!: string; @IsInt() @Min(1) sizeBytes!: number; }
class ReviewDto { @IsIn(['approve', 'reject']) decision!: 'approve' | 'reject'; @IsString() @MinLength(8) @MaxLength(512) reason!: string; }
@ApiTags('storage')
@Controller('storage')
export class StorageController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}
  private ctx(req: Request) { return (req as any).accessContext as AccessContext; }
  @Post('uploads') @UseGuards(SessionGuard, CsrfGuard)
  create(@Req() req: Request, @Body() body: CreateUploadDto) { return this.storage.createUpload(this.ctx(req), body); }
  @Put('uploads/:id') @UseGuards(SessionGuard)
  upload(@Req() req: Request, @Param('id') id: string) { return this.storage.upload(this.ctx(req), id, req.header('x-storage-token') ?? '', req); }
  @Post('objects/:id/download-url') @UseGuards(SessionGuard, CsrfGuard)
  downloadUrl(@Req() req: Request, @Param('id') id: string) { return this.storage.createDownload(this.ctx(req), id); }
  @Post('objects/:id/review-download-url') @UseGuards(SessionGuard, CsrfGuard)
  reviewDownloadUrl(@Req() req: Request, @Param('id') id: string) { return this.storage.createReviewDownload(this.ctx(req), id); }
  @Post('objects/:id/review') @UseGuards(SessionGuard, CsrfGuard)
  review(@Req() req: Request, @Param('id') id: string, @Body() body: ReviewDto) { return this.storage.review(this.ctx(req), id, body); }
  @Get('downloads/:id')
  async download(@Param('id') id: string, @Query('token') token: string, @Res() res: Response) {
    const { data, contentType } = await this.storage.download(id, token ?? '');
    res.setHeader('Content-Type', contentType); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.send(data);
  }
}
