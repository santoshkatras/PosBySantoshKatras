import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import {
  createUserSchema,
  updateRolePermissionsSchema,
  updateUserSchema,
  type CreateUserInput,
  type UpdateRolePermissionsInput,
  type UpdateUserInput,
} from '@stockkeep/types';
import type { Request } from 'express';
import { RequireModule, RequirePermission } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import type { RequestUser } from '../../common/request-user';
import { ZodValidationPipe } from '../../common/zod-pipe';
import { UsersService } from './users.service';

@Controller()
@RequireModule('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users')
  @RequirePermission('users.view')
  listUsers() {
    return this.users.listUsers();
  }

  @Post('users')
  @RequirePermission('users.manage')
  createUser(
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.users.createUser(req.user, body, requestMeta(req));
  }

  @Patch('users/:id')
  @RequirePermission('users.manage')
  updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.users.updateUser(req.user, id, body, requestMeta(req));
  }

  @Get('roles')
  @RequirePermission('users.view')
  listRoles() {
    return this.users.listRoles();
  }

  @Patch('roles/:id/permissions')
  @RequirePermission('users.manage')
  updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRolePermissionsSchema)) body: UpdateRolePermissionsInput,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.users.updateRolePermissions(req.user, id, body, requestMeta(req));
  }
}
