require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { createYoutubeClient } = require('./src/youtubeClient');
const { resolveChannels } = require('./src/resolveChannels');
const { collectVideos } = require('./src/collectVideos');
const { openDb, upsertChannelDaily, upsertVideoDaily } = require('./src/db');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

function todayKST() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

async function main() {
  const client = createYoutubeClient({ apiKey: process.env.YOUTUBE_API_KEY });

  console.log('채널 정보 조회 중...');
  const { resolved: channels, errors: resolveErrors } = await resolveChannels(client, config.channels);
  for (const c of channels) {
    console.log(`  ${c.name}: 구독자 ${c.subscriberCount.toLocaleString()}명, 총 조회수 ${c.totalViewCount.toLocaleString()}회`);
  }
  for (const e of resolveErrors) {
    console.warn(`  건너뜀: ${e.entry.name || e.entry.handle || e.entry.channelId} — ${e.message}`);
  }

  if (channels.length === 0) {
    throw new Error('채널을 하나도 조회하지 못했습니다. API 키나 config.json 설정을 확인하세요.');
  }

  console.log('\n최근 영상 목록/지표 수집 중...');
  const { videos, errors: videoErrors } = await collectVideos(client, channels, config.collection);
  console.log(`  ${videos.length}개 영상 수집 완료`);
  for (const e of videoErrors) {
    const label = e.channel ? e.channel.name : `영상 배치 ${e.videoIds?.length}개`;
    console.warn(`  일부 실패: ${label} — ${e.message}`);
  }

  const date = todayKST();
  const collectedAt = new Date().toISOString();

  const db = openDb(path.join(__dirname, 'data', 'youtube_tracker.db'));

  const channelRows = channels.map((c) => ({
    channelId: c.channelId,
    date,
    title: c.title,
    subscriberCount: c.subscriberCount,
    totalViewCount: c.totalViewCount,
    videoCount: c.videoCount,
    collectedAt,
  }));
  upsertChannelDaily(db, channelRows);

  // thumbnailUrl은 video_daily에 저장하지 않는다(썸네일 분석은 별도의 analyze-thumbnails 스크립트가 담당).
  const videoRows = videos.map(({ thumbnailUrl, ...v }) => ({ ...v, date, collectedAt }));
  upsertVideoDaily(db, videoRows);

  db.close();

  console.log(`\n저장 완료 (기준일 ${date}): 채널 ${channelRows.length}건, 영상 ${videoRows.length}건`);

  const totalErrors = resolveErrors.length + videoErrors.length;
  if (totalErrors > 0) {
    console.warn(`\n일부 실패했지만 나머지는 정상 수집되어 저장했습니다 (실패 ${totalErrors}건, 위 로그 참고).`);
  }
}

main().catch((err) => {
  console.error('실행 중 오류:', err.message);
  process.exit(1);
});
