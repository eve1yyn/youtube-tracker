CREATE TABLE IF NOT EXISTS channel_daily (
  channel_id       TEXT NOT NULL,
  date             TEXT NOT NULL,
  title            TEXT,
  subscriber_count INTEGER,
  total_view_count INTEGER,
  video_count      INTEGER,
  collected_at     TEXT NOT NULL,
  PRIMARY KEY (channel_id, date)
);

CREATE TABLE IF NOT EXISTS video_daily (
  video_id          TEXT NOT NULL,
  channel_id        TEXT NOT NULL,
  date              TEXT NOT NULL,
  title             TEXT,
  published_at      TEXT,
  view_count        INTEGER,
  like_count        INTEGER,
  comment_count     INTEGER,
  duration_seconds  INTEGER,
  collected_at      TEXT NOT NULL,
  PRIMARY KEY (video_id, date)
);

CREATE INDEX IF NOT EXISTS idx_video_daily_channel_date ON video_daily(channel_id, date);
CREATE INDEX IF NOT EXISTS idx_channel_daily_date        ON channel_daily(date);

-- video_daily(매일 재기록되는 시계열)와 달리, 영상 하나당 한 번만 분석해서 기록하는 정적 테이블.
CREATE TABLE IF NOT EXISTS video_thumbnail_features (
  video_id          TEXT PRIMARY KEY,
  thumbnail_url     TEXT,
  face_count        INTEGER,
  text_overlay      INTEGER,   -- SQLite에 boolean 타입이 없어 0/1로 저장
  dominant_emotion  TEXT,
  shot_type         TEXT,
  brightness        TEXT,
  scene_busyness    TEXT,
  dominant_color    TEXT,
  model             TEXT NOT NULL,
  analyzed_at       TEXT NOT NULL
);
