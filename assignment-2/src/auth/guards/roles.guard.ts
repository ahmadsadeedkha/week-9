import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectMember } from '../../entities/ProjectMember.js';
import { Task } from '../../entities/Task.js';
import { ProjectRole } from '../../entities/Enums.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import {
  PROJECT_SOURCE_KEY,
  ProjectSource,
} from '../decorators/project-source.decorator.js';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { type Cache } from 'cache-manager';


@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(ProjectMember)
    private readonly projectMemberRepo: Repository<ProjectMember>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<ProjectRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // route doesn't declare @Roles(), nothing to enforce
    }

    const projectSource = this.reflector.getAllAndOverride<ProjectSource>(
      PROJECT_SOURCE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!projectSource) {
      throw new Error(
        'RolesGuard: route uses @Roles() but has no @ProjectSourceFrom() — cannot resolve project id',
      );
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user; // set by JwtAuthGuard — must run before this guard

    const projectId = await this.resolveProjectId(projectSource, request);

    const membership = await this.getMembership(projectId,  user.userId);

    if (!membership) {
      throw new ForbiddenException('You are not a member of this project');
    }

    if (!requiredRoles.includes(membership.role)) {
      throw new ForbiddenException('Insufficient role for this action');
    }

    return true;
  }

  private cacheKey(projectId: number, userId: number): string {
    return `project_member:${projectId}:${userId}`;
  }

  private async getMembership(
    projectId: number,
    userId: number,
  ): Promise<ProjectMember | null> {
    const key = this.cacheKey(projectId, userId);
    const cached = await this.cache.get<ProjectMember | null>(key);

    if (cached !== undefined) {
      return cached; // cache hit — no DB query, including the "confirmed no membership" case
    }

    const membership = await this.projectMemberRepo.findOne({
      where: { project_id: projectId, user_id: userId },
    });

    await this.cache.set(key, membership ?? null);
    return membership;
  }

  private async resolveProjectId(
    source: ProjectSource,
    request: any,
  ): Promise<number> {
    switch (source.type) {
      case 'route-param': {
        const value = request.params[source.param];
        return Number(value);
      }

      case 'body-field': {
        const value = request.body?.[source.field];
        if (value === undefined) {
          throw new ForbiddenException(
            `Missing ${source.field} in request body`,
          );
        }
        return Number(value);
      }

      case 'task-param': {
        const taskId = Number(request.params[source.param]);
        const task = await this.taskRepo.findOne({ where: { id: taskId } });
        if (!task) {
          throw new ForbiddenException('Referenced task does not exist');
        }
        return task.project_id;
      }
    }
  }
}
