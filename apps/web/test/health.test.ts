import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/health/route.js';

test('GET /api/health returns 200 with ok:true', async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true });
});
