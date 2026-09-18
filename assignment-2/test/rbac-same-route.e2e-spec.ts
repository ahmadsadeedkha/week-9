import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { ProjectRole } from '../src/entities/Enums.js';

describe('RBAC — same route, both outcomes (C5)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const ownerUser = {
    email: 'e2e-c5-owner@example.com',
    name: 'C5 Owner',
    password: 'password123',
  };
  const viewerUser = {
    email: 'e2e-c5-viewer@example.com',
    name: 'C5 Viewer',
    password: 'password123',
  };

  let ownerToken: string;
  let viewerToken: string;
  let sharedProjectId: number;

  async function cleanup() {
    await dataSource.query(`
      DELETE FROM tasks WHERE project_id IN (
        SELECT id FROM projects WHERE name = 'C5 Shared Project'
      )
    `);
    await dataSource.query(`
      DELETE FROM project_members WHERE project_id IN (
        SELECT id FROM projects WHERE name = 'C5 Shared Project'
      )
    `);
    await dataSource.query(
      `DELETE FROM projects WHERE name = 'C5 Shared Project'`,
    );
    await dataSource.query(`DELETE FROM users WHERE email IN ($1, $2)`, [
      ownerUser.email,
      viewerUser.email,
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
    await cleanup();

    // Register + log in both users
    await request(app.getHttpServer()).post('/auth/register').send(ownerUser);
    await request(app.getHttpServer()).post('/auth/register').send(viewerUser);

    const ownerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ownerUser.email, password: ownerUser.password });
    ownerToken = ownerLogin.body.access_token;

    const viewerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: viewerUser.email, password: viewerUser.password });
    viewerToken = viewerLogin.body.access_token;

    // Owner creates the shared project — auto-becomes 'owner' member (per our create() fix)
    const projRes = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'C5 Shared Project' })
      .expect(201);
    sharedProjectId = projRes.body.id;

    // Manually add the second user as a 'viewer' on the SAME project
    // (no membership-invite endpoint exists yet, so we seed directly)
    const viewerId = viewerLogin.body.access_token
      ? JSON.parse(
          Buffer.from(viewerToken.split('.')[1], 'base64url').toString(),
        ).sub
      : null;

    await dataSource.query(
      `INSERT INTO project_members (user_id, project_id, role) VALUES ($1, $2, $3)`,
      [viewerId, sharedProjectId, ProjectRole.VIEWER],
    );
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it('viewer gets 403 creating a task on the project', async () => {
    await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        title: 'viewer trying to create',
        priority: 3,
        projectId: sharedProjectId,
      })
      .expect(403);
  });

  it('owner succeeds creating a task on the SAME project', async () => {
    const res = await request(app.getHttpServer())
      .post('/tasks')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'owner creating',
        priority: 3,
        projectId: sharedProjectId,
      })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.project_id).toBe(sharedProjectId);
  });
});
