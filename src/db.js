const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrate(db);
  return db;
}

// schema.sql은 CREATE TABLE IF NOT EXISTS라서 이미 존재하는 테이블에는
// 새 컬럼이 안 생긴다. 기존 DB에 컬럼을 더할 땐 여기에 추가한다.
function migrate(db) {
  const columns = db.prepare('PRAGMA table_info(video_daily)').all().map((c) => c.name);
  if (!columns.includes('duration_seconds')) {
    db.exec('ALTER TABLE video_daily ADD COLUMN duration_seconds INTEGER');
  }
}

function withTransaction(db, fn) {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function upsertChannelDaily(db, rows) {
  const stmt = db.prepare(`
    INSERT INTO channel_daily (channel_id, date, title, subscriber_count, total_view_count, video_count, collected_at)
    VALUES (@channelId, @date, @title, @subscriberCount, @totalViewCount, @videoCount, @collectedAt)
    ON CONFLICT (channel_id, date) DO UPDATE SET
      title = excluded.title,
      subscriber_count = excluded.subscriber_count,
      total_view_count = excluded.total_view_count,
      video_count = excluded.video_count,
      collected_at = excluded.collected_at
  `);
  withTransaction(db, () => {
    for (const row of rows) stmt.run(row);
  });
}

function upsertVideoDaily(db, rows) {
  const stmt = db.prepare(`
    INSERT INTO video_daily (video_id, channel_id, date, title, published_at, view_count, like_count, comment_count, duration_seconds, collected_at)
    VALUES (@videoId, @channelId, @date, @title, @publishedAt, @viewCount, @likeCount, @commentCount, @durationSeconds, @collectedAt)
    ON CONFLICT (video_id, date) DO UPDATE SET
      title = excluded.title,
      published_at = excluded.published_at,
      view_count = excluded.view_count,
      like_count = excluded.like_count,
      comment_count = excluded.comment_count,
      duration_seconds = excluded.duration_seconds,
      collected_at = excluded.collected_at
  `);
  withTransaction(db, () => {
    for (const row of rows) stmt.run(row);
  });
}

module.exports = { openDb, upsertChannelDaily, upsertVideoDaily };
