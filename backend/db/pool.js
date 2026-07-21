// Shared PostgreSQL connection pool.
// Every route module should require this file rather than instantiating its
// own `pg` Pool, so the whole app shares one set of connections.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  // Log unexpected errors on idle clients so a bad connection doesn't
  // silently crash the process.
  console.error('Unexpected error on idle PostgreSQL client', err);
});

module.exports = pool;
