import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

describe('RBAC — cross-project isolation (C3)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const userA = {
    email: 'e2e-owner-a@example.com',
    name: 'Owner A',
    password: 'password123',
  };
  const userB = {
    email: 'e2e-owner-b@example.com',
    name: 'Owner B',
    password: 'password123',
  };

  let tokenA: string;
  let tokenB: string;
  let projectAId: number;
  let projectBId: number;
  let taskInProjectBId: number;

  async function cleanup() {
    await dataSource.query(`
      DELETE FROM comments WHERE task_id IN (
        SELECT id FROM tasks WHERE project_id IN (
          SELECT id FROM projects WHERE name IN ('Project A', 'Project B')
        )
      )
    `);
    await dataSource.query(`
      DELETE FROM tasks WHERE project_id IN (
        SELECT id FROM projects WHERE name IN ('Project A', 'Project B')
      )
    `);
    await dataSource.query(`
      DELETE FROM project_members WHERE project_id IN (
        SELECT id FROM projects WHERE name IN ('Project A', 'Project B')
      )
    `);
    await dataSource.query(
      `DELETE FROM projects WHERE name IN ('Project A', 'Project B')`,
    );
    await dataSource.query(`DELETE FROM users WHERE email IN ($1, $2)`, [
      userA.email,
      userB.email,
    ]);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    await cleanup(); // defensive, in case a previous failed run left rows behind

    // Register + log in both users
    await request(app.getHttpServer()).post('/auth/register').send(userA);
    await request(app.getHttpServer()).post('/auth/register').send(userB);

    const loginA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userA.email, password: userA.password });
    tokenA = loginA.body.access_token;

    const loginB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userB.email, password: userB.password });
    tokenB = loginB.body.access_token;

    // User A creates and owns Project A
    const projA = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Project A' });
    projectAId = projA.body.id;

    // User B creates and owns Project B — User A has NO membership row here
    const projB = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'Project B' });
    projectBId = projB.body.id;

    // User B creates a task inside Project B, for the comment test below
    const taskB = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ title: 'Task in B', priority: 3, projectId: projectBId });
    taskInProjectBId = taskB.body.id;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('rejects Project-A owner creating a task under Project B', async () => {
    await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'sneaky task', priority: 3, projectId: projectBId })
      .expect(403);
  });

  it('rejects Project-A owner updating Project B', async () => {
    await request(app.getHttpServer())
      .patch(`/projects/${projectBId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Hijacked name' })
      .expect(403);
  });

  it('rejects Project-A owner deleting Project B', async () => {
    await request(app.getHttpServer())
      .delete(`/projects/${projectBId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);
  });

  it('rejects Project-A owner commenting on a task that belongs to Project B', async () => {
    await request(app.getHttpServer())
      .post(`/tasks/${taskInProjectBId}/comments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ body: 'I should not be able to post this' })
      .expect(403);
  });

  it('confirms Project B still fully intact after all rejected attempts', async () => {
    const check = await request(app.getHttpServer())
      .get(`/projects/${projectBId}`)
      .expect(200);

    expect(check.body.name).toBe('Project B'); // NOT "Hijacked name" — the rejected PATCH never applied
  });
});
