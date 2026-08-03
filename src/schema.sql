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
