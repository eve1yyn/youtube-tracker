const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// 올린 지 얼마 안 된 영상은 아직 조회수가 안 쌓인 상태라 채널 단위 평균/도달률
// 계산에 넣으면 착시를 만든다. 이 기간이 지난 영상만 집계에 포함한다.
const STABLE_VIDEO_AGE_DAYS = 3;

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

// 절대 증감이 아니라 비율(%) 증가율. 과거 값이 0이면 계산 불가로 처리.
function computeGrowthRate(rows, field, days) {
  if (rows.length === 0) return null;
  const latest = rows[rows.length - 1];
  const targetDate = daysAgo(latest.date, days);
  const past = rows.find((r) => r.date === targetDate);
  if (!past || !past[field]) return null;
  return ((latest[field] - past[field]) / past[field]) * 100;
}

function average(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function ratePercent(numerator, denominator) {
  if (numerator === null || numerator === undefined) return null;
  if (!denominator) return null;
  return (numerator / denominator) * 100;
}

// 유튜브 쇼츠 여부를 판단할 공식 API 필드가 없어, 재생시간 3분 이하를 쇼츠로 추정한다.
// 구 데이터(재수집 전)는 duration_seconds가 없어 null(형식 미상)로 남는다.
function isShort(durationSeconds) {
  if (durationSeconds === null || durationSeconds === undefined) return null;
  return durationSeconds <= 180;
}

function exportDashboardData(dbPath, outDir) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const channelIds = db.prepare('SELECT DISTINCT channel_id FROM channel_daily ORDER BY channel_id').all().map((r) => r.channel_id);
  const now = Date.now();

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
        .prepare('SELECT date, title, published_at AS publishedAt, view_count AS viewCount, like_count AS likeCount, comment_count AS commentCount, duration_seconds AS durationSeconds FROM video_daily WHERE video_id = ? ORDER BY date ASC')
        .all(videoId);
      const latest = videoRows[videoRows.length - 1];
      const dayDelta =
        videoRows.length >= 2 ? videoRows[videoRows.length - 1].viewCount - videoRows[videoRows.length - 2].viewCount : null;

      if (dayDelta !== null) {
        allMovers.push({
          videoId,
          channelId,
          channelTitle: latestChannel.title,
          title: latest.title,
          viewDelta: dayDelta,
          isShort: isShort(latest.durationSeconds),
        });
      }

      return {
        videoId,
        title: latest.title,
        publishedAt: latest.publishedAt,
        durationSeconds: latest.durationSeconds,
        isShort: isShort(latest.durationSeconds),
        likeRate: ratePercent(latest.likeCount, latest.viewCount),
        commentRate: ratePercent(latest.commentCount, latest.viewCount),
        dailyStats: videoRows,
      };
    });

    fs.writeFileSync(
      path.join(outDir, `channel_${channelId}.json`),
      JSON.stringify({ channelId, title: latestChannel.title, dailyStats: channelRows, videos }, null, 2)
    );

    // 채널 단위 집계는 "안정화된"(올라온 지 STABLE_VIDEO_AGE_DAYS일 이상 지난) 영상만 사용.
    const stableVideos = videos.filter((v) => now - new Date(v.publishedAt).getTime() >= STABLE_VIDEO_AGE_DAYS * 86400000);
    const stableViewCounts = stableVideos.map((v) => v.dailyStats[v.dailyStats.length - 1].viewCount);
    const avgViews = average(stableViewCounts);
    const medianViews = median(stableViewCounts);
    const reachRate = avgViews !== null ? ratePercent(avgViews, latestChannel.subscriberCount) : null;
    const reachRateMedian = medianViews !== null ? ratePercent(medianViews, latestChannel.subscriberCount) : null;
    const engagementRates = stableVideos
      .map((v) => ratePercent(v.dailyStats[v.dailyStats.length - 1].likeCount + (v.dailyStats[v.dailyStats.length - 1].commentCount || 0), v.dailyStats[v.dailyStats.length - 1].viewCount))
      .filter((v) => v !== null);
    const engagementRate = average(engagementRates);

    // 최근 30일 활동량: 수집 기간(config.collection.videoWindowDays) 설정과 무관하게
    // 항상 "최근 30일" 기준으로 고정 계산 (활동 지표는 수집 범위와 별개 의미이므로).
    const videosLast30d = videos.filter((v) => now - new Date(v.publishedAt).getTime() <= 30 * 86400000).length;
    const uploadsPerWeek = videosLast30d / (30 / 7);

    indexChannels.push({
      channelId,
      title: latestChannel.title,
      latest: latestChannel,
      delta7d: computeDelta(channelRows, 'subscriberCount', 7),
      delta30d: computeDelta(channelRows, 'subscriberCount', 30),
      growthRate30d: computeGrowthRate(channelRows, 'subscriberCount', 30),
      viewDelta7d: computeDelta(channelRows, 'totalViewCount', 7),
      viewDelta30d: computeDelta(channelRows, 'totalViewCount', 30),
      videosLast30d,
      uploadsPerWeek,
      avgViewsPerVideo: avgViews,
      reachRate,
      reachRateMedian,
      engagementRate,
      dailyStats: channelRows,
    });
  }

  allMovers.sort((a, b) => b.viewDelta - a.viewDelta);
  // 숏폼은 구조적으로 조회수가 빨리 튀어서, 롱폼과 한 순위에 섞으면 롱폼 성장 신호가 묻힌다.
  const topMoversShorts = allMovers.filter((m) => m.isShort === true).slice(0, 10);
  const topMoversLongform = allMovers.filter((m) => m.isShort === false).slice(0, 10);

  fs.writeFileSync(
    path.join(outDir, 'index.json'),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), channels: indexChannels, topMoversShorts, topMoversLongform },
      null,
      2
    )
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
