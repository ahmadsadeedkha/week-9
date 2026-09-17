import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module.js';

describe('Projects cascade (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('cascades: deleting a project removes its tasks and their comments', async () => {
    const project = await request(app.getHttpServer())
      .post('/projects')
      .send({ name: 'Cascade test project', ownerId: 1 })
      .expect(201);

    const task = await request(app.getHttpServer())
      .post('/tasks')
      .send({
        title: 'Cascade test task',
        priority: 1,
        projectId: project.body.id,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/tasks/${task.body.id}/comments`)
      .send({ body: 'Cascade test comment', authorId: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/projects/${project.body.id}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/tasks/${task.body.id}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/tasks/${task.body.id}/comments`)
      .expect(404);
  });
});
