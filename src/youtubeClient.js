const BASE_URL = 'https://www.googleapis.com/youtube/v3';

function createYoutubeClient({ apiKey, fetchImpl } = {}) {
  if (!apiKey) {
    throw new Error(
      'YOUTUBE_API_KEY가 설정되지 않았습니다. .env 파일에 YOUTUBE_API_KEY=발급받은_키 를 추가하세요.'
    );
  }
  const doFetch = fetchImpl || fetch;

  async function getJson(path, params) {
    const url = new URL(`${BASE_URL}/${path}`);
    url.searchParams.set('key', apiKey);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
    const res = await doFetch(url.toString());
    const body = await res.json();
    if (!res.ok) {
      const message = body?.error?.message || `YouTube API 오류 (status ${res.status})`;
      throw new Error(`${path} 호출 실패: ${message}`);
    }
    return body;
  }

  // ids: 최대 50개까지 배치 가능
  function getChannelsByIds(ids) {
    return getJson('channels', {
      part: 'snippet,statistics,contentDetails',
      id: ids.join(','),
    });
  }

  function getChannelByHandle(handle) {
    return getJson('channels', {
      part: 'snippet,statistics,contentDetails',
      forHandle: handle,
    });
  }

  function getPlaylistItems(playlistId, pageToken) {
    return getJson('playlistItems', {
      part: 'contentDetails',
      playlistId,
      maxResults: 50,
      pageToken,
    });
  }

  // ids: 최대 50개까지 배치 가능
  function getVideosByIds(ids) {
    return getJson('videos', {
      part: 'snippet,statistics',
      id: ids.join(','),
    });
  }

  // 채널 후보 발굴용 검색. 호출당 100유닛 — 일일 자동 수집에는 쓰지 말 것.
  function searchChannels(query, { pageToken, regionCode } = {}) {
    return getJson('search', {
      part: 'snippet',
      type: 'channel',
      q: query,
      maxResults: 50,
      regionCode: regionCode || 'KR',
      relevanceLanguage: 'ko',
      pageToken,
    });
  }

  return { getChannelsByIds, getChannelByHandle, getPlaylistItems, getVideosByIds, searchChannels };
}

module.exports = { createYoutubeClient };
