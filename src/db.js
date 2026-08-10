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
  const videoDailyColumns = db.prepare('PRAGMA table_info(video_daily)').all().map((c) => c.name);
  if (!videoDailyColumns.includes('duration_seconds')) {
    db.exec('ALTER TABLE video_daily ADD COLUMN duration_seconds INTEGER');
  }
  const featureColumns = db.prepare('PRAGMA table_info(video_thumbnail_features)').all().map((c) => c.name);
  if (!featureColumns.includes('title_match')) {
    db.exec('ALTER TABLE video_thumbnail_features ADD COLUMN title_match TEXT');
  }
  if (!featureColumns.includes('overlay_text')) {
    db.exec('ALTER TABLE video_thumbnail_features ADD COLUMN overlay_text TEXT');
  }
  if (!featureColumns.includes('overlay_tone')) {
    db.exec('ALTER TABLE video_thumbnail_features ADD COLUMN overlay_tone TEXT');
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

// 주어진 videoId 목록 중 "완전히" 분석된(현재 스키마의 모든 필드가 채워진) 것만 Set으로 반환한다.
// title_match처럼 나중에 필드가 추가되면, 그 필드가 없는 예전 행은 여기서 자동으로
// "미분석"으로 잡혀 재분석 대상이 된다 — 별도 백필 스크립트/플래그가 필요 없다.
function getExistingFeatureVideoIds(db, videoIds) {
  if (videoIds.length === 0) return new Set();
  const placeholders = videoIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT video_id FROM video_thumbnail_features WHERE video_id IN (${placeholders}) AND title_match IS NOT NULL AND overlay_tone IS NOT NULL`
    )
    .all(...videoIds);
  return new Set(rows.map((r) => r.video_id));
}

// 어떤 video_id를 다시 분석 대상에 넣을지는 getExistingFeatureVideoIds가 걸러내므로,
// 여기서는 덮어쓰기(DO UPDATE)로 둬도 불필요한 재호출/재과금이 생기지 않는다.
function upsertThumbnailFeatures(db, rows) {
  const stmt = db.prepare(`
    INSERT INTO video_thumbnail_features (video_id, thumbnail_url, face_count, text_overlay, dominant_emotion, shot_type, brightness, scene_busyness, dominant_color, title_match, overlay_text, overlay_tone, model, analyzed_at)
    VALUES (@videoId, @thumbnailUrl, @faceCount, @textOverlay, @dominantEmotion, @shotType, @brightness, @sceneBusyness, @dominantColor, @titleMatch, @overlayText, @overlayTone, @model, @analyzedAt)
    ON CONFLICT (video_id) DO UPDATE SET
      thumbnail_url = excluded.thumbnail_url,
      face_count = excluded.face_count,
      text_overlay = excluded.text_overlay,
      dominant_emotion = excluded.dominant_emotion,
      shot_type = excluded.shot_type,
      brightness = excluded.brightness,
      scene_busyness = excluded.scene_busyness,
      dominant_color = excluded.dominant_color,
      title_match = excluded.title_match,
      overlay_text = excluded.overlay_text,
      overlay_tone = excluded.overlay_tone,
      model = excluded.model,
      analyzed_at = excluded.analyzed_at
  `);
  withTransaction(db, () => {
    for (const row of rows) stmt.run({ ...row, textOverlay: row.textOverlay ? 1 : 0 });
  });
}

module.exports = { openDb, upsertChannelDaily, upsertVideoDaily, getExistingFeatureVideoIds, upsertThumbnailFeatures };
