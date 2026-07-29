import assert from 'node:assert/strict';
import test from 'node:test';

import { localPostgresEnvironment } from './run-in-ephemeral-database.mjs';

test('builds PostgreSQL CLI environment from a local connection only', () => {
  const { parsed, environment } = localPostgresEnvironment(
    'postgresql://nook:private-password@127.0.0.1:5433/nook?sslmode=disable',
    { SAFE_EXISTING_VALUE: 'preserved' },
  );

  assert.equal(parsed.pathname, '/nook');
  assert.deepEqual(environment, {
    SAFE_EXISTING_VALUE: 'preserved',
    PGHOST: '127.0.0.1',
    PGPORT: '5433',
    PGDATABASE: 'postgres',
    PGUSER: 'nook',
    PGPASSWORD: 'private-password',
    PGSSLMODE: 'disable',
  });
});

test('rejects remote PostgreSQL hosts', () => {
  assert.throws(
    () => localPostgresEnvironment('postgresql://nook@example.com/nook', {}),
    /restricted to local PostgreSQL/,
  );
});

test('rejects non-PostgreSQL connection strings', () => {
  assert.throws(
    () => localPostgresEnvironment('https://localhost/nook', {}),
    /restricted to local PostgreSQL/,
  );
});
