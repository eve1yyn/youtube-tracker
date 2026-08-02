// 실제 YouTube API를 호출하지 않고, fixtures/의 고정 응답으로 전체 플로우를 검증하는 오프라인 러너
const fs = require('fs');
const path = require('path');

const { createYoutubeClient } = require('./src/youtubeClient');
const { resolveChannels } = require('./src/resolveChannels');
const { collectVideos } = require('./src/collectVideos');
const { openDb, upsertChannelDaily, upsertVideoDaily } = require('./src/db');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const channelsFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sample_channels_response.json'), 'utf8'));
const playlistItemsFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sample_playlistItems_response.json'), 'utf8'));
const videosFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sample_videos_response.json'), 'utf8'));

function fakeResponse(body) {
  return { ok: true, json: async () => body };
}

async function fixtureFetch(urlString) {
  const url = new URL(urlString);

  if (url.pathname.endsWith('/channels')) {
    const forHandle = url.searchParams.get('forHandle');
    if (forHandle) {
      return fakeResponse(channelsFixture[forHandle] || { items: [] });
    }
    const ids = (url.searchParams.get('id') || '').split(',');
    const allItems = Object.values(channelsFixture).flatMap((r) => r.items);
    return fakeResponse({ items: allItems.filter((it) => ids.includes(it.id)) });
  }

  if (url.pathname.endsWith('/playlistItems')) {
    const playlistId = url.searchParams.get('playlistId');
    return fakeResponse(playlistItemsFixture[playlistId] || { items: [] });
  }

  if (url.pathname.endsWith('/videos')) {
    const ids = (url.searchParams.get('id') || '').split(',');
    return fakeResponse({ items: videosFixture.items.filter((it) => ids.includes(it.id)) });
  }

  throw new Error(`알 수 없는 fixture 요청: ${urlString}`);
}

function todayKST() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

async function main() {
  const client = createYoutubeClient({ apiKey: 'dev-fixture-key', fetchImpl: fixtureFetch });

  console.log('[dev] 채널 정보 조회 중...');
  const channels = await resolveChannels(client, config.channels);
  for (const c of channels) {
    console.log(`  ${c.name}: 구독자 ${c.subscriberCount.toLocaleString()}명, 총 조회수 ${c.totalViewCount.toLocaleString()}회`);
  }

  console.log('\n[dev] 최근 영상 목록/지표 수집 중...');
  const videos = await collectVideos(client, channels, config.collection);
  for (const v of videos) {
    console.log(`  [${v.channelId}] ${v.title}: 조회수 ${v.viewCount.toLocaleString()}회`);
  }

  const date = todayKST();
  const collectedAt = new Date().toISOString();

  const db = openDb(path.join(__dirname, 'data', 'youtube_tracker.dev.db'));

  upsertChannelDaily(
    db,
    channels.map((c) => ({
      channelId: c.channelId,
      date,
      title: c.title,
      subscriberCount: c.subscriberCount,
      totalViewCount: c.totalViewCount,
      videoCount: c.videoCount,
      collectedAt,
    }))
  );
  upsertVideoDaily(db, videos.map((v) => ({ ...v, date, collectedAt })));

  db.close();

  console.log(`\n[dev] 저장 완료 (기준일 ${date}) → data/youtube_tracker.dev.db`);
}

main().catch((err) => {
  console.error('[dev] 실행 중 오류:', err.message);
  process.exit(1);
});
