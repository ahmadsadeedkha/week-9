import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from '../entities/Comment.js';
import { User } from '../entities/User.js';
import { CommentsService } from './comments.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Comment, User])],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
