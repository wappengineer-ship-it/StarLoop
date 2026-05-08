const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: connectionString.includes("localhost")
        ? false
        : { rejectUnauthorized: false }
    })
  : null;

async function initDb() {
  if (!pool) {
    return;
  }

  await pool.query(`
    create table if not exists players (
      id text primary key,
      name text not null,
      zone_type text not null,
      zone_id text not null,
      x double precision not null,
      y double precision not null,
      direction text not null,
      updated_at timestamptz not null default now()
    )
  `);
}

async function loadPlayer(id) {
  if (!pool) {
    return null;
  }

  const result = await pool.query(
    `select id, name, zone_type, zone_id, x, y, direction
     from players
     where id = $1`,
    [id]
  );

  return result.rows[0] || null;
}

async function savePlayer(player) {
  if (!pool) {
    return;
  }

  await pool.query(
    `insert into players (id, name, zone_type, zone_id, x, y, direction, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (id) do update set
       name = excluded.name,
       zone_type = excluded.zone_type,
       zone_id = excluded.zone_id,
       x = excluded.x,
       y = excluded.y,
       direction = excluded.direction,
       updated_at = now()`,
    [
      player.id,
      player.name,
      player.zoneType,
      player.zoneId,
      player.x,
      player.y,
      player.direction
    ]
  );
}

module.exports = {
  initDb,
  loadPlayer,
  savePlayer
};
