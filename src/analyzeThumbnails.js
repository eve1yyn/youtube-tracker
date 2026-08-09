const THUMBNAIL_FEATURE_SCHEMA = {
  type: 'object',
  properties: {
    face_count: {
      type: 'integer',
      description: '썸네일에서 명확히 보이는 사람 얼굴의 수(0 이상 정수, 보통 0~10 사이). 없으면 0.',
    },
    text_overlay: {
      type: 'boolean',
      description: '원본 장면이 아니라 편집으로 추가된 캡션/타이틀 텍스트가 있는지 여부',
    },
    dominant_emotion: {
      type: 'string',
      enum: ['positive', 'neutral', 'negative', 'none'],
      description: '가장 크게 나온 얼굴의 표정. 얼굴이 없으면 none',
    },
    shot_type: {
      type: 'string',
      enum: ['closeup', 'medium', 'wide'],
      description: '주요 인물/피사체의 프레이밍',
    },
    brightness: {
      type: 'string',
      enum: ['bright', 'medium', 'dark'],
      description: '전체적인 노출/밝기 톤',
    },
    scene_busyness: {
      type: 'string',
      enum: ['clean', 'moderate', 'busy'],
      description: '배경/구성의 시각적 복잡도',
    },
    dominant_color: {
      type: 'string',
      enum: ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'black_white', 'multicolor'],
      description: '썸네일의 지배적 색 계열',
    },
  },
  required: ['face_count', 'text_overlay', 'dominant_emotion', 'shot_type', 'brightness', 'scene_busyness', 'dominant_color'],
  additionalProperties: false,
};

const PROMPT_TEXT =
  '이 유튜브 영상 썸네일 이미지를 분석해서 지정된 구조로 시각적 특징만 추출하세요. 이미지에 실제로 보이는 것만 근거로 판단하세요.';

async function analyzeOne(client, { videoId, thumbnailUrl }, model, maxTokens) {
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    output_config: { format: { type: 'json_schema', schema: THUMBNAIL_FEATURE_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: thumbnailUrl } },
          { type: 'text', text: PROMPT_TEXT },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('모델이 이 썸네일 분석을 거부함');
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('응답에 텍스트 블록이 없음');
  const parsed = JSON.parse(textBlock.text);

  return {
    videoId,
    thumbnailUrl,
    faceCount: parsed.face_count,
    textOverlay: parsed.text_overlay,
    dominantEmotion: parsed.dominant_emotion,
    shotType: parsed.shot_type,
    brightness: parsed.brightness,
    sceneBusyness: parsed.scene_busyness,
    dominantColor: parsed.dominant_color,
  };
}

// items: [{ videoId, thumbnailUrl }]. 항목 하나가 실패(거부/네트워크 오류/파싱 실패)해도
// 나머지는 계속 진행하고, 실패는 errors로 모아 반환한다 (resolveChannels/collectVideos와 동일한 패턴).
async function analyzeThumbnails(client, items, options = {}) {
  const { model = 'claude-haiku-4-5', maxTokens = 300, concurrency = 5 } = options;
  const features = [];
  const errors = [];

  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      try {
        features.push(await analyzeOne(client, item, model, maxTokens));
      } catch (err) {
        errors.push({ videoId: item.videoId, message: err.message });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);

  return { features, errors };
}

module.exports = { analyzeThumbnails, THUMBNAIL_FEATURE_SCHEMA };
