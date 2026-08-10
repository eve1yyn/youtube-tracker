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

// face_count는 정수 그대로 두면 표본이 작은 우리 데이터에서 값마다 n=1짜리 버킷이 난립한다.
// "없음/1명/2명 이상" 3버킷으로 묶어야 그룹당 표본이 그나마 확보된다.
function bucketFaceCount(n) {
  if (n === 0) return '없음';
  if (n === 1) return '1명';
  return '2명 이상';
}

// Claude가 반환하는 값은 영어 enum이라 그대로 노출하면 대시보드에서 읽기 어렵다.
const DOMINANT_EMOTION_LABELS = { positive: '긍정', neutral: '중립', negative: '부정', none: '없음' };
const SHOT_TYPE_LABELS = { closeup: '클로즈업', medium: '중간거리', wide: '넓은 화면' };
const BRIGHTNESS_LABELS = { bright: '밝음', medium: '보통', dark: '어두움' };
const SCENE_BUSYNESS_LABELS = { clean: '깔끔함', moderate: '보통', busy: '복잡함' };
const DOMINANT_COLOR_LABELS = {
  red: '빨강', orange: '주황', yellow: '노랑', green: '초록', blue: '파랑',
  purple: '보라', pink: '분홍', black_white: '흑백', multicolor: '다채로움',
};
const TITLE_MATCH_LABELS = { consistent: '일치', exaggerated: '과장(클릭베이트)', unrelated: '무관' };
const OVERLAY_TONE_LABELS = {
  none: '없음',
  curiosity_hook: '궁금증 유발',
  superlative_hype: '과장·최상급',
  urgent_warning: '긴급·경고',
  question: '질문형',
  plain_info: '단순 정보',
};

// 채널 구독자 규모 구간. 대시보드 클라이언트(docs/app.js)의 TIERS 기준과 동일하게 맞춘다.
function getTier(subscriberCount) {
  if (subscriberCount < 10000) return 'nano';
  if (subscriberCount < 100000) return 'micro';
  if (subscriberCount < 1000000) return 'macro';
  return 'mega';
}

// exampleFn을 주면(overlayTone 차원 전용) 버킷마다 실제 문구 예시를 최대 3개까지 뽑아준다.
function groupBy(rows, keyFn, label, exampleFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (key === null || key === undefined) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const buckets = [...groups.entries()].map(([value, rs]) => {
    const bucket = {
      value,
      count: rs.length,
      avgViews: average(rs.map((r) => r.viewCount)),
      medianViews: median(rs.map((r) => r.viewCount)),
      avgEngagementRate: average(rs.map((r) => r.engagementRate).filter((v) => v !== null)),
    };
    if (exampleFn) {
      const examples = [...new Set(rs.map(exampleFn).filter((t) => t && t.trim()))].slice(0, 3);
      if (examples.length) bucket.examples = examples;
    }
    return bucket;
  });
  buckets.sort((a, b) => (b.avgEngagementRate ?? -Infinity) - (a.avgEngagementRate ?? -Infinity));
  return { label, buckets, insight: dimensionInsight(buckets) };
}

// buckets는 이미 avgEngagementRate 내림차순 정렬돼 있으니, 양 끝(최고/최저)을 뽑아
// "이 요소는 참여율 차이가 이만큼 난다"를 한 줄로 요약할 수 있게 한다.
function dimensionInsight(buckets) {
  const withRate = buckets.filter((b) => b.avgEngagementRate !== null);
  if (withRate.length < 2) return null;
  const top = withRate[0];
  const bottom = withRate[withRate.length - 1];
  return {
    topValue: top.value,
    topRate: top.avgEngagementRate,
    bottomValue: bottom.value,
    bottomRate: bottom.avgEngagementRate,
    deltaPct: top.avgEngagementRate - bottom.avgEngagementRate,
  };
}

// 채널 하나당 영상이 몇 개 안 되므로 채널별로는 상관관계가 무의미하다. 전체 채널의
// 안정화된 영상을 모두 합쳐야 버킷당 표본이 확보된다(그래서 채널 루프 밖에서 호출).
function buildThumbnailInsights(rows, totalAnalyzedCount) {
  if (rows.length === 0) return null;
  const dimensions = {
    faceCount: groupBy(rows, (r) => bucketFaceCount(r.faceCount), '얼굴 수'),
    textOverlay: groupBy(rows, (r) => (r.textOverlay ? '있음' : '없음'), '텍스트 오버레이'),
    dominantEmotion: groupBy(rows, (r) => DOMINANT_EMOTION_LABELS[r.dominantEmotion] ?? r.dominantEmotion, '표정'),
    shotType: groupBy(rows, (r) => SHOT_TYPE_LABELS[r.shotType] ?? r.shotType, '샷 타입'),
    brightness: groupBy(rows, (r) => BRIGHTNESS_LABELS[r.brightness] ?? r.brightness, '밝기'),
    sceneBusyness: groupBy(rows, (r) => SCENE_BUSYNESS_LABELS[r.sceneBusyness] ?? r.sceneBusyness, '구성 복잡도'),
    dominantColor: groupBy(rows, (r) => DOMINANT_COLOR_LABELS[r.dominantColor] ?? r.dominantColor, '주조색'),
    titleMatch: groupBy(rows, (r) => TITLE_MATCH_LABELS[r.titleMatch] ?? r.titleMatch, '제목-썸네일 일치도'),
    overlayTone: groupBy(rows, (r) => OVERLAY_TONE_LABELS[r.overlayTone] ?? r.overlayTone, '오버레이 문구 톤', (r) => r.overlayText),
  };

  let topSignal = null;
  for (const [key, dim] of Object.entries(dimensions)) {
    if (dim.insight && (!topSignal || dim.insight.deltaPct > topSignal.deltaPct)) {
      topSignal = { dimensionKey: key, dimensionLabel: dim.label, ...dim.insight };
    }
  }

  return {
    sampleSize: totalAnalyzedCount,
    stableSampleSize: rows.length,
    generatedAt: new Date().toISOString(),
    dimensions,
    topSignal,
  };
}

// 채널 규모(티어)별로 나눠 봐야 소형/대형 채널에서 통하는 요소가 다른지 알 수 있다.
// 전체 표본이 179개뿐이라 티어별로 쪼개면 더 작아지므로, buildThumbnailInsights가
// rows.length===0이면 null을 반환하는 것에 기대 표본 부족한 티어는 자동으로 빈 상태로 나온다.
function buildThumbnailInsightsByTier(rows, totalAnalyzedCount, totalAnalyzedByTier) {
  const result = { all: buildThumbnailInsights(rows, totalAnalyzedCount) };
  for (const tierKey of ['nano', 'micro', 'macro', 'mega']) {
    const tierRows = rows.filter((r) => r.tier === tierKey);
    result[tierKey] = buildThumbnailInsights(tierRows, totalAnalyzedByTier[tierKey] || 0);
  }
  return result;
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

  // video_thumbnail_features는 analyze-thumbnails 스크립트를 한 번도 안 돌렸으면 아직 없을 수 있다.
  const hasThumbnailFeatures = !!db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='video_thumbnail_features'")
    .get();
  const featureStmt = hasThumbnailFeatures
    ? db.prepare(
        `SELECT face_count AS faceCount, text_overlay AS textOverlay, dominant_emotion AS dominantEmotion,
                shot_type AS shotType, brightness, scene_busyness AS sceneBusyness, dominant_color AS dominantColor,
                title_match AS titleMatch, overlay_text AS overlayText, overlay_tone AS overlayTone
         FROM video_thumbnail_features WHERE video_id = ?`
      )
    : null;

  fs.mkdirSync(outDir, { recursive: true });

  const indexChannels = [];
  const allMovers = [];
  const allStableFeatureRows = [];
  const channelClickbaitVsGrowth = [];
  let totalAnalyzedCount = 0;
  const totalAnalyzedByTier = { nano: 0, micro: 0, macro: 0, mega: 0 };

  for (const channelId of channelIds) {
    const channelRows = db
      .prepare('SELECT date, title, subscriber_count AS subscriberCount, total_view_count AS totalViewCount, video_count AS videoCount FROM channel_daily WHERE channel_id = ? ORDER BY date ASC')
      .all(channelId);
    const latestChannel = channelRows[channelRows.length - 1];
    const tier = getTier(latestChannel.subscriberCount);

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

      const featureRow = featureStmt ? featureStmt.get(videoId) : undefined;
      const thumbnailFeatures = featureRow
        ? { ...featureRow, textOverlay: !!featureRow.textOverlay, hasFace: featureRow.faceCount > 0 }
        : null;
      if (thumbnailFeatures) {
        totalAnalyzedCount += 1;
        totalAnalyzedByTier[tier] += 1;
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
        thumbnailFeatures,
      };
    });

    fs.writeFileSync(
      path.join(outDir, `channel_${channelId}.json`),
      JSON.stringify({ channelId, title: latestChannel.title, dailyStats: channelRows, videos }, null, 2)
    );

    // 채널 단위 집계는 "안정화된"(올라온 지 STABLE_VIDEO_AGE_DAYS일 이상 지난) 영상만 사용.
    const stableVideos = videos.filter((v) => now - new Date(v.publishedAt).getTime() >= STABLE_VIDEO_AGE_DAYS * 86400000);
    const stableViewCounts = stableVideos.map((v) => v.dailyStats[v.dailyStats.length - 1].viewCount);

    const channelStableFeatures = [];
    for (const v of stableVideos) {
      if (!v.thumbnailFeatures) continue;
      const latestStats = v.dailyStats[v.dailyStats.length - 1];
      const featureRow = {
        ...v.thumbnailFeatures,
        channelId,
        tier,
        viewCount: latestStats.viewCount,
        engagementRate: ratePercent((latestStats.likeCount || 0) + (latestStats.commentCount || 0), latestStats.viewCount),
      };
      allStableFeatureRows.push(featureRow);
      channelStableFeatures.push(featureRow);
    }

    // 클릭베이트("과장"/"무관")로 판단된 영상 비율과, 이 채널의 30일 구독자 성장률을 짝지어
    // "제목 낚시가 실제로 성장에 도움이 되는지 손해인지"를 볼 수 있게 한다.
    if (channelStableFeatures.length > 0) {
      const clickbaitCount = channelStableFeatures.filter((f) => f.titleMatch === 'exaggerated' || f.titleMatch === 'unrelated').length;
      channelClickbaitVsGrowth.push({
        channelId,
        title: latestChannel.title,
        subscriberCount: latestChannel.subscriberCount,
        analyzedVideoCount: channelStableFeatures.length,
        clickbaitRate: ratePercent(clickbaitCount, channelStableFeatures.length),
        growthRate30d: computeGrowthRate(channelRows, 'subscriberCount', 30),
      });
    }

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

  const thumbnailInsightsByTier = buildThumbnailInsightsByTier(allStableFeatureRows, totalAnalyzedCount, totalAnalyzedByTier);

  fs.writeFileSync(
    path.join(outDir, 'index.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        channels: indexChannels,
        topMoversShorts,
        topMoversLongform,
        thumbnailInsightsByTier,
        channelClickbaitVsGrowth,
      },
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
