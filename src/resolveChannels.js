function normalizeChannelItem(item, configName) {
  return {
    channelId: item.id,
    name: configName || item.snippet.title,
    title: item.snippet.title,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
    subscriberCount: Number(item.statistics.subscriberCount || 0),
    totalViewCount: Number(item.statistics.viewCount || 0),
    videoCount: Number(item.statistics.videoCount || 0),
  };
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

// config.channels의 각 항목은 { channelId } 또는 { handle } 중 하나 + 선택적 name(별칭)
// 채널 하나가 실패(삭제/비공개 전환, API 오류 등)해도 나머지 채널은 계속 수집되도록
// 항목별로 오류를 격리하고, 실패 목록은 errors로 함께 반환한다.
async function resolveChannels(client, channelsConfig) {
  const resolved = [];
  const errors = [];
  const byId = [];

  for (const entry of channelsConfig) {
    if (entry.channelId) {
      byId.push(entry);
      continue;
    }
    if (!entry.handle) {
      errors.push({ entry, message: 'config.json 채널 항목에 channelId 또는 handle이 필요합니다.' });
      continue;
    }
    try {
      const res = await client.getChannelByHandle(entry.handle);
      if (!res.items || res.items.length === 0) {
        errors.push({ entry, message: `핸들 ${entry.handle}에 해당하는 채널을 찾지 못했습니다.` });
        continue;
      }
      resolved.push(normalizeChannelItem(res.items[0], entry.name));
    } catch (err) {
      errors.push({ entry, message: err.message });
    }
  }

  for (const batch of chunk(byId, 50)) {
    const nameById = new Map(batch.map((e) => [e.channelId, e.name]));
    try {
      const res = await client.getChannelsByIds(batch.map((e) => e.channelId));
      const returnedIds = new Set();
      for (const item of res.items || []) {
        returnedIds.add(item.id);
        resolved.push(normalizeChannelItem(item, nameById.get(item.id)));
      }
      for (const entry of batch) {
        if (!returnedIds.has(entry.channelId)) {
          errors.push({ entry, message: `채널ID ${entry.channelId}를 찾지 못했습니다 (삭제되었거나 비공개 채널일 수 있음).` });
        }
      }
    } catch (err) {
      for (const entry of batch) errors.push({ entry, message: err.message });
    }
  }

  return { resolved, errors };
}

module.exports = { resolveChannels };
