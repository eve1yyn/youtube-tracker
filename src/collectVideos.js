function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

// "PT1H2M3S" 같은 ISO 8601 duration을 초 단위로 변환
function parseIso8601Duration(iso) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!match) return null;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

// 채널의 업로드 재생목록을 페이지네이션하며, 수집 기간(windowDays)을 벗어나거나
// 채널당 최대 개수(maxPerChannel)에 도달하면 중단한다.
async function listRecentVideoIds(client, uploadsPlaylistId, { windowDays, maxPerChannel }) {
  const windowStart = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const videoIds = [];
  let pageToken;

  do {
    const res = await client.getPlaylistItems(uploadsPlaylistId, pageToken);
    for (const item of res.items || []) {
      const publishedAt = new Date(item.contentDetails.videoPublishedAt).getTime();
      if (publishedAt < windowStart) return videoIds;
      videoIds.push(item.contentDetails.videoId);
      if (videoIds.length >= maxPerChannel) return videoIds;
    }
    pageToken = res.nextPageToken;
  } while (pageToken);

  return videoIds;
}

// channels: resolveChannels()가 반환한 배열 (channelId, uploadsPlaylistId 포함)
// 채널 하나의 재생목록 조회가 실패해도 나머지 채널은 계속 진행하고, 실패는 errors로 반환한다.
async function collectVideos(client, channels, { videoWindowDays, maxVideosPerChannel }) {
  const channelIdByVideoId = new Map();
  const errors = [];

  for (const channel of channels) {
    try {
      const videoIds = await listRecentVideoIds(client, channel.uploadsPlaylistId, {
        windowDays: videoWindowDays,
        maxPerChannel: maxVideosPerChannel,
      });
      for (const videoId of videoIds) channelIdByVideoId.set(videoId, channel.channelId);
    } catch (err) {
      errors.push({ channel, message: err.message });
    }
  }

  const allVideoIds = [...channelIdByVideoId.keys()];
  const videos = [];

  for (const batch of chunk(allVideoIds, 50)) {
    try {
      const res = await client.getVideosByIds(batch);
      for (const item of res.items || []) {
        videos.push({
          videoId: item.id,
          channelId: channelIdByVideoId.get(item.id),
          title: item.snippet.title,
          publishedAt: item.snippet.publishedAt,
          viewCount: Number(item.statistics.viewCount || 0),
          likeCount: item.statistics.likeCount !== undefined ? Number(item.statistics.likeCount) : null,
          commentCount: item.statistics.commentCount !== undefined ? Number(item.statistics.commentCount) : null,
          durationSeconds: parseIso8601Duration(item.contentDetails?.duration),
          thumbnailUrl:
            item.snippet.thumbnails?.maxres?.url ||
            item.snippet.thumbnails?.high?.url ||
            item.snippet.thumbnails?.standard?.url ||
            item.snippet.thumbnails?.medium?.url ||
            item.snippet.thumbnails?.default?.url ||
            null,
        });
      }
    } catch (err) {
      errors.push({ videoIds: batch, message: err.message });
    }
  }

  return { videos, errors };
}

module.exports = { collectVideos, listRecentVideoIds, parseIso8601Duration };
