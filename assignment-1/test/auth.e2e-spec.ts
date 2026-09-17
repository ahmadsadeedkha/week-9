import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { Application } from 'express';
import { AppModule } from './../src/app.module.js';

describe('Auth (e2e)', () => {
  let app: INestApplication<Application>;
  let dataSource: DataSource;

  const testUser = {
    email: 'e2e-test@example.com',
    name: 'E2E Test User',
    password: 'correct-password-123',
  };

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

    // Clean slate in case a previous failed run left this row behind
    await dataSource.query(
      'DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = $1)',
      [testUser.email],
    );
    await dataSource.query('DELETE FROM users WHERE email = $1', [
      testUser.email,
    ]);

    // Register the user once for the whole suite
    await request(app.getHttpServer()).post('/auth/register').send(testUser);
  });

  afterAll(async () => {
    await dataSource.query(
      'DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = $1)',
      [testUser.email],
    );
    await dataSource.query('DELETE FROM users WHERE email = $1', [
      testUser.email,
    ]);
    await app.close();
  });

  it('logs in successfully with correct credentials and returns a token pair', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);

    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('refresh_token');
  });

  it('returns 401 for a wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: 'totally-wrong-password' })
      .expect(401);
  });

  it('returns the identical 401 body for a nonexistent email', async () => {
    const wrongPasswordRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: 'totally-wrong-password' })
      .expect(401);

    const noSuchUserRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nobody-at-all@example.com', password: 'anything' })
      .expect(401);

    expect(noSuchUserRes.body).toEqual(wrongPasswordRes.body);
  });

  it('rotates the refresh token: old token stops working after refresh', async () => {
    // 1. Login
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);

    const firstRefreshToken = loginRes.body.refresh_token;

    // 2. Refresh with it — should succeed and issue a new pair
    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: firstRefreshToken })
      .expect(200);

    expect(refreshRes.body).toHaveProperty('access_token');
    expect(refreshRes.body).toHaveProperty('refresh_token');
    expect(refreshRes.body.refresh_token).not.toBe(firstRefreshToken);

    // 3. Try the FIRST (now-old) refresh token again — must be rejected
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: firstRefreshToken })
      .expect(401);
  });
});
