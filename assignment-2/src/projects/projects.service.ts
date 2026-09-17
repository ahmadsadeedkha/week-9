import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../entities/Project.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { User } from '../entities/User.js';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async create(dto: CreateProjectDto): Promise<Project> {
    const owner = await this.userRepo.findOneBy({ id: dto.ownerId });
    if (!owner) {
      throw new NotFoundException(`User ${dto.ownerId} not found`);
    }

    const project = this.projectRepo.create({
      name: dto.name,
      owner,
    });
    return this.projectRepo.save(project);
  }

  async findAll(): Promise<Project[]> {
    return this.projectRepo.find();
  }

  async findOne(id: number): Promise<Project> {
    const project = await this.projectRepo.findOneBy({ id });
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    return project;
  }

  async update(id: number, dto: UpdateProjectDto): Promise<Project> {
    const project = await this.findOne(id);
    if (dto.ownerId !== undefined) {
      const owner = await this.userRepo.findOneBy({ id: dto.ownerId });
      if (!owner) {
        throw new NotFoundException(`User ${dto.ownerId} not found`);
      }
      project.owner = owner;
    }

    if (dto.name !== undefined) {
      project.name = dto.name;
    }
    return this.projectRepo.save(project);
  }

  async remove(id: number): Promise<void> {
    const project = await this.findOne(id);
    await this.projectRepo.remove(project);
  }
}
