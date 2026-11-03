import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard.js';
import { CsrfGuard } from '../common/csrf.js';
import { AdminActivationService } from './admin-activation.service.js';
import type { AccessContext } from '@getstoopy/core';
class InviteDto { @IsUUID() userId!:string; @IsUUID() countryId!:string; @IsUUID() roleId!:string; @IsString() @MinLength(8) @MaxLength(512) reason!:string; @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!:string; }
class ReviewDto { @IsInt() @Min(1) expectedVersion!:number; @IsIn(['ACTIVATE','REJECT']) decision!:'ACTIVATE'|'REJECT'; @IsOptional() @IsUUID() kycCaseId?:string; @IsString() @MinLength(8) @MaxLength(512) reason!:string; @IsString() @Matches(/^[A-Za-z0-9:_-]{8,128}$/) commandKey!:string; }
@Controller('admin/activations') @UseGuards(SessionGuard)
export class AdminActivationController { constructor(@Inject(AdminActivationService) private readonly service:AdminActivationService){} private ctx(req:Request){return (req as any).accessContext as AccessContext;}
 @Post() @UseGuards(CsrfGuard) invite(@Req() req:Request,@Body() body:InviteDto){return this.service.invite(this.ctx(req),body);}
 @Get() list(@Req() req:Request,@Query('countryId',ParseUUIDPipe) countryId:string){return this.service.list(this.ctx(req),countryId);}
 @Post(':id/review') @UseGuards(CsrfGuard) review(@Req() req:Request,@Param('id',ParseUUIDPipe) id:string,@Body() body:ReviewDto){return this.service.review(this.ctx(req),id,body);}
}
