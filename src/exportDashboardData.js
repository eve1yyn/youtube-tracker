const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function daysAgo(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function computeDelta(rows, field, days) {
  if (rows.length === 0) return null;
  const latest = rows[rows.length - 1];
  const targetDate = daysAgo(latest.date, days);
  const past = rows.find((r) => r.date === targetDate);
  if (!past) return null;
  return latest[field] - past[field];
}

function exportDashboardData(dbPath, outDir) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const channelIds = db.prepare('SELECT DISTINCT channel_id FROM channel_daily ORDER BY channel_id').all().map((r) => r.channel_id);

  fs.mkdirSync(outDir, { recursive: true });

  const indexChannels = [];
  const allMovers = [];

  for (const channelId of channelIds) {
    const channelRows = db
      .prepare('SELECT date, title, subscriber_count AS subscriberCount, total_view_count AS totalViewCount, video_count AS videoCount FROM channel_daily WHERE channel_id = ? ORDER BY date ASC')
      .all(channelId);
    const latestChannel = channelRows[channelRows.length - 1];

    const videoIds = db
      .prepare('SELECT DISTINCT video_id FROM video_daily WHERE channel_id = ? ORDER BY video_id')
      .all(channelId)
      .map((r) => r.video_id);

    const videos = videoIds.map((videoId) => {
      const videoRows = db
        .prepare('SELECT date, title, published_at AS publishedAt, view_count AS viewCount, like_count AS likeCount, comment_count AS commentCount FROM video_daily WHERE video_id = ? ORDER BY date ASC')
        .all(videoId);
      const latest = videoRows[videoRows.length - 1];
      const dayDelta =
        videoRows.length >= 2 ? videoRows[videoRows.length - 1].viewCount - videoRows[videoRows.length - 2].viewCount : null;

      if (dayDelta !== null) {
        allMovers.push({ videoId, channelId, channelTitle: latestChannel.title, title: latest.title, viewDelta: dayDelta });
      }

      return { videoId, title: latest.title, publishedAt: latest.publishedAt, dailyStats: videoRows };
    });

    fs.writeFileSync(
      path.join(outDir, `channel_${channelId}.json`),
      JSON.stringify({ channelId, title: latestChannel.title, dailyStats: channelRows, videos }, null, 2)
    );

    indexChannels.push({
      channelId,
      title: latestChannel.title,
      latest: latestChannel,
      delta7d: computeDelta(channelRows, 'subscriberCount', 7),
      delta30d: computeDelta(channelRows, 'subscriberCount', 30),
      dailyStats: channelRows,
    });
  }

  allMovers.sort((a, b) => b.viewDelta - a.viewDelta);

  fs.writeFileSync(
    path.join(outDir, 'index.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), channels: indexChannels, topMovers: allMovers.slice(0, 10) }, null, 2)
  );

  db.close();

  console.log(`대시보드 데이터 export 완료: 채널 ${indexChannels.length}개 → ${outDir}`);
}

module.exports = { exportDashboardData };

if (require.main === module) {
  exportDashboardData(
    path.join(__dirname, '..', 'data', 'youtube_tracker.db'),
    path.join(__dirname, '..', 'docs', 'data')
  );
}
