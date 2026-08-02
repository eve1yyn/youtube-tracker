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
  const channels = await resolveChannels(client, config.channels);
  for (const c of channels) {
    console.log(`  ${c.name}: 구독자 ${c.subscriberCount.toLocaleString()}명, 총 조회수 ${c.totalViewCount.toLocaleString()}회`);
  }

  console.log('\n최근 영상 목록/지표 수집 중...');
  const videos = await collectVideos(client, channels, config.collection);
  console.log(`  ${videos.length}개 영상 수집 완료`);

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

  const videoRows = videos.map((v) => ({ ...v, date, collectedAt }));
  upsertVideoDaily(db, videoRows);

  db.close();

  console.log(`\n저장 완료 (기준일 ${date}): 채널 ${channelRows.length}건, 영상 ${videoRows.length}건`);
}

main().catch((err) => {
  console.error('실행 중 오류:', err.message);
  process.exit(1);
});
