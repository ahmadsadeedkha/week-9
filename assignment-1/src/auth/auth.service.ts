import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/User.js';
import { RegisterDto } from './dto/register.dto.js';
import { UserResponseDto } from './dto/user-response.dto.js';
import * as argon2 from 'argon2';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async register(dto: RegisterDto): Promise<UserResponseDto> {
    const existing = await this.userRepository.findOne({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const password_hash = await argon2.hash(dto.password);

    const user = this.userRepository.create({
      name: dto.name,
      email: dto.email,
      password_hash,
    });
    const saved = await this.userRepository.save(user);

    return new UserResponseDto({
      id: saved.id,
      name: saved.name,
      email: saved.email,
      created_at: saved.created_at,
    });
  }
}
