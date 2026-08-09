// 썸네일 시각 요소 분석 스크립트. 매일 자동 실행되는 index.js와는 분리된, 사람이 원할 때
// 직접 실행하는 도구다(discover.js와 동일한 패턴). 이미 분석된 영상은 건너뛰므로
// 여러 번 실행해도 중복 비용이 들지 않는다.
require('dotenv').config();
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const { createYoutubeClient } = require('./src/youtubeClient');
const { openDb, getExistingFeatureVideoIds, upsertThumbnailFeatures } = require('./src/db');
const { analyzeThumbnails } = require('./src/analyzeThumbnails');

const MODEL = 'claude-haiku-4-5';

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function extractThumbnailUrl(snippet) {
  return (
    snippet.thumbnails?.maxres?.url ||
    snippet.thumbnails?.high?.url ||
    snippet.thumbnails?.standard?.url ||
    snippet.thumbnails?.medium?.url ||
    snippet.thumbnails?.default?.url ||
    null
  );
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('.env에 ANTHROPIC_API_KEY를 설정하세요.');
  }

  const db = openDb(path.join(__dirname, 'data', 'youtube_tracker.db'));
  const allVideoIds = db.prepare('SELECT DISTINCT video_id FROM video_daily ORDER BY video_id').all().map((r) => r.video_id);
  const alreadyAnalyzed = getExistingFeatureVideoIds(db, allVideoIds);
  const targetVideoIds = allVideoIds.filter((id) => !alreadyAnalyzed.has(id));

  if (targetVideoIds.length === 0) {
    console.log(`분석할 신규 썸네일이 없습니다 (추적 중인 영상 ${allVideoIds.length}개 전부 분석 완료 상태).`);
    db.close();
    return;
  }

  console.log(`분석 대상 영상 ${targetVideoIds.length}개 (전체 ${allVideoIds.length}개 중 ${alreadyAnalyzed.size}개는 이미 분석됨)`);

  console.log('썸네일 URL 조회 중...');
  const youtubeClient = createYoutubeClient({ apiKey: process.env.YOUTUBE_API_KEY });
  const items = [];
  for (const batch of chunk(targetVideoIds, 50)) {
    try {
      const res = await youtubeClient.getVideosByIds(batch);
      for (const item of res.items || []) {
        const thumbnailUrl = extractThumbnailUrl(item.snippet);
        if (thumbnailUrl) items.push({ videoId: item.id, thumbnailUrl });
      }
    } catch (err) {
      console.warn(`  썸네일 URL 조회 실패(영상 ${batch.length}개): ${err.message}`);
    }
  }

  if (items.length === 0) {
    console.log('썸네일 URL을 가져온 영상이 없어 분석을 종료합니다.');
    db.close();
    return;
  }

  console.log(`Claude Vision(${MODEL})으로 ${items.length}개 썸네일 분석 중...`);
  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const { features, errors } = await analyzeThumbnails(anthropicClient, items, { model: MODEL });

  const analyzedAt = new Date().toISOString();
  upsertThumbnailFeatures(db, features.map((f) => ({ ...f, model: MODEL, analyzedAt })));

  console.log(`\n분석 완료: ${features.length}개 저장`);
  if (errors.length > 0) {
    console.warn(`실패 ${errors.length}건 (다음 실행 때 자동 재시도됨):`);
    for (const e of errors) console.warn(`  ${e.videoId}: ${e.message}`);
  }

  db.close();
}

main().catch((err) => {
  console.error('실행 중 오류:', err.message);
  process.exit(1);
});
