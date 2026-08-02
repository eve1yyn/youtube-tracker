function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

const KOREAN_PATTERN = /[가-힣]/;

// 키워드로 채널 후보를 검색한다. search.list는 호출당 100유닛이라
// 일일 자동 수집(index.js)과는 분리된, 사람이 가끔 실행하는 발굴 전용 흐름이다.
async function discoverChannels(
  client,
  { keywords, maxPagesPerKeyword = 2, regionCode = 'KR', minSubscribers = 1000, maxSubscribers = 3000000, requireKorean = true }
) {
  const foundKeywordsByChannelId = new Map();

  for (const keyword of keywords) {
    let pageToken;
    for (let page = 0; page < maxPagesPerKeyword; page++) {
      const res = await client.searchChannels(keyword, { pageToken, regionCode });
      for (const item of res.items || []) {
        const channelId = item.snippet.channelId || item.id.channelId;
        if (!channelId) continue;
        if (!foundKeywordsByChannelId.has(channelId)) foundKeywordsByChannelId.set(channelId, new Set());
        foundKeywordsByChannelId.get(channelId).add(keyword);
      }
      pageToken = res.nextPageToken;
      if (!pageToken) break;
    }
  }

  const channelIds = [...foundKeywordsByChannelId.keys()];
  const candidates = [];

  for (const batch of chunk(channelIds, 50)) {
    const res = await client.getChannelsByIds(batch);
    for (const item of res.items || []) {
      const title = item.snippet.title;
      const description = (item.snippet.description || '').replace(/\s+/g, ' ').slice(0, 120);
      const subscriberCount = Number(item.statistics.subscriberCount || 0);
      const videoCount = Number(item.statistics.videoCount || 0);

      if (subscriberCount < minSubscribers || subscriberCount > maxSubscribers) continue;
      if (requireKorean && !KOREAN_PATTERN.test(`${title} ${description}`)) continue;

      candidates.push({
        channelId: item.id,
        title,
        description,
        subscriberCount,
        videoCount,
        foundViaKeywords: [...foundKeywordsByChannelId.get(item.id)].join(', '),
      });
    }
  }

  candidates.sort((a, b) => a.subscriberCount - b.subscriberCount);

  return candidates;
}

module.exports = { discoverChannels };
