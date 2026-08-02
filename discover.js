// 채널 후보 발굴 스크립트. 매일 자동 실행되는 index.js와는 분리된, 사람이 가끔
// 필요할 때 직접 실행하는 도구다 (search.list는 호출당 100유닛으로 비싸다).
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { createYoutubeClient } = require('./src/youtubeClient');
const { discoverChannels } = require('./src/discoverChannels');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'discover.config.json'), 'utf8'));

function toCsv(rows) {
  const headers = ['채널명', '채널ID', '구독자수', '영상수', '설명', '발견키워드', '채널URL'];
  const escape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.title,
        r.channelId,
        r.subscriberCount,
        r.videoCount,
        r.description,
        r.foundViaKeywords,
        `https://www.youtube.com/channel/${r.channelId}`,
      ]
        .map(escape)
        .join(',')
    );
  }
  return '﻿' + lines.join('\n') + '\n';
}

async function main() {
  const client = createYoutubeClient({ apiKey: process.env.YOUTUBE_API_KEY });

  const estimatedUnits = config.keywords.length * config.maxPagesPerKeyword * 100;
  console.log(
    `검색 예상 쿼터 사용량: 약 ${estimatedUnits}유닛 (키워드 ${config.keywords.length}개 x 페이지 ${config.maxPagesPerKeyword} x 100유닛)`
  );

  const candidates = await discoverChannels(client, config);
  console.log(`\n후보 채널 ${candidates.length}개 발견 (구독자 적은 순 정렬)`);

  const outDir = path.join(__dirname, 'discovery');
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `candidates_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
  fs.writeFileSync(filePath, toCsv(candidates));

  console.log(`CSV 저장 완료: ${filePath}`);
  console.log('이 목록을 직접 훑어보고, 실제로 추적하고 싶은 채널만 config.json의 channels 배열에 추가하세요.');
}

main().catch((err) => {
  console.error('실행 중 오류:', err.message);
  process.exit(1);
});
