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
async function resolveChannels(client, channelsConfig) {
  const resolved = [];
  const byId = [];

  for (const entry of channelsConfig) {
    if (entry.channelId) {
      byId.push(entry);
      continue;
    }
    if (!entry.handle) {
      throw new Error(`config.json 채널 항목에 channelId 또는 handle이 필요합니다: ${JSON.stringify(entry)}`);
    }
    const res = await client.getChannelByHandle(entry.handle);
    if (!res.items || res.items.length === 0) {
      throw new Error(`핸들 ${entry.handle}에 해당하는 채널을 찾지 못했습니다.`);
    }
    resolved.push(normalizeChannelItem(res.items[0], entry.name));
  }

  for (const batch of chunk(byId, 50)) {
    const res = await client.getChannelsByIds(batch.map((e) => e.channelId));
    const nameById = new Map(batch.map((e) => [e.channelId, e.name]));
    for (const item of res.items || []) {
      resolved.push(normalizeChannelItem(item, nameById.get(item.id)));
    }
  }

  return resolved;
}

module.exports = { resolveChannels };
