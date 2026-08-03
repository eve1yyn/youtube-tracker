const vizRoot = document.querySelector('.viz-root');
const style = getComputedStyle(vizRoot);
const seriesColor = style.getPropertyValue('--series-1').trim();

const TIERS = [
  { key: 'all', label: '전체', test: () => true },
  { key: 'nano', label: '나노 (~1만)', test: (s) => s < 10000 },
  { key: 'micro', label: '마이크로 (1만~10만)', test: (s) => s >= 10000 && s < 100000 },
  { key: 'macro', label: '매크로 (10만~100만)', test: (s) => s >= 100000 && s < 1000000 },
  { key: 'mega', label: '메가 (100만~)', test: (s) => s >= 1000000 },
];

const state = { channels: [], sortKey: 'subscriberCount', sortDir: 'desc', search: '', tier: 'all', activeChannelId: null };

function fmtNum(n) {
  return n === null || n === undefined ? '-' : Math.round(n).toLocaleString('ko-KR');
}

function fmtPercent(n, digits = 1) {
  return n === null || n === undefined ? '-' : `${n.toFixed(digits)}%`;
}

function truncate(str, maxLen) {
  if (!str) return str;
  return str.length > maxLen ? `${str.slice(0, maxLen).trim()}…` : str;
}

// durationSeconds가 null이면(구 데이터, 재수집 전) 형식을 알 수 없어 배지를 생략한다.
function isShort(durationSeconds) {
  if (durationSeconds === null || durationSeconds === undefined) return null;
  return durationSeconds <= 180;
}

function formatBadge(durationSeconds) {
  const s = isShort(durationSeconds);
  if (s === null) return '';
  return `<span class="format-badge ${s ? 'short' : 'long'}">${s ? '숏폼' : '롱폼'}</span>`;
}

function fmtDelta(n) {
  if (n === null || n === undefined) return { text: '집계 중', cls: 'delta-empty' };
  if (n > 0) return { text: `▲ ${n.toLocaleString('ko-KR')}`, cls: 'delta-up' };
  if (n < 0) return { text: `▼ ${Math.abs(n).toLocaleString('ko-KR')}`, cls: 'delta-down' };
  return { text: '변화 없음', cls: 'delta-empty' };
}

function fmtGrowthPercent(n) {
  if (n === null || n === undefined) return { text: '집계 중', cls: 'delta-empty' };
  if (n > 0) return { text: `▲ ${n.toFixed(1)}%`, cls: 'delta-up' };
  if (n < 0) return { text: `▼ ${Math.abs(n).toFixed(1)}%`, cls: 'delta-down' };
  return { text: '변화 없음', cls: 'delta-empty' };
}

function fmtDate(iso) {
  return iso ? iso.slice(0, 10) : '-';
}

function sparklineSvg(values) {
  const w = 92;
  const h = 28;
  const pad = 3;
  if (!values || values.length < 2) {
    return `<span style="color:var(--text-muted); font-size:12px;">데이터 쌓이는 중</span>`;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = pad + i * stepX;
      const y = pad + (h - pad * 2) * (1 - (v - min) / range);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${points}" fill="none" stroke="${seriesColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
}

function scaleRadius(v, min, max, rMin, rMax) {
  if (max === min) return (rMin + rMax) / 2;
  const t = (Math.sqrt(v) - Math.sqrt(min)) / (Math.sqrt(max) - Math.sqrt(min));
  return rMin + (rMax - rMin) * t;
}

function renderPositioningChart(channels) {
  const canvas = document.getElementById('positioningChart');
  const wrap = document.getElementById('positioningChartWrap');
  const emptyState = document.getElementById('positioningEmptyState');
  const points = channels.filter((c) => c.reachRateMedian !== null && c.engagementRate !== null);

  if (points.length === 0) {
    wrap.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }

  const subs = points.map((c) => c.latest.subscriberCount);
  const minSub = Math.min(...subs);
  const maxSub = Math.max(...subs);

  new Chart(canvas.getContext('2d'), {
    type: 'bubble',
    data: {
      datasets: [
        {
          label: '채널',
          data: points.map((c) => ({
            x: c.reachRateMedian,
            y: c.engagementRate,
            r: scaleRadius(c.latest.subscriberCount, minSub, maxSub, 6, 30),
            channelId: c.channelId,
            title: c.title,
            subscriberCount: c.latest.subscriberCount,
          })),
          backgroundColor: `${seriesColor}66`,
          borderColor: seriesColor,
          borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const p = ctx.raw;
              return [`${p.title}`, `도달률 ${p.x.toFixed(1)}% · 참여율 ${p.y.toFixed(2)}%`, `구독자 ${p.subscriberCount.toLocaleString('ko-KR')}명`];
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: '도달률(중앙값, %)', color: style.getPropertyValue('--text-muted').trim() },
          grid: { color: style.getPropertyValue('--gridline').trim() },
        },
        y: {
          title: { display: true, text: '참여율(%)', color: style.getPropertyValue('--text-muted').trim() },
          grid: { color: style.getPropertyValue('--gridline').trim() },
        },
      },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const point = points[elements[0].index];
        if (point) selectChannel(point.channelId, { scroll: true });
      },
      onHover: (evt, elements) => {
        evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
    },
  });
}

async function main() {
  const res = await fetch('data/index.json', { cache: 'no-store' });
  const data = await res.json();

  document.getElementById('updated').textContent =
    `마지막 업데이트: ${new Date(data.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (KST)`;

  state.channels = data.channels;

  renderKpiTiles(data);
  renderPositioningChart(data.channels);
  renderMovers(data.topMoversShorts, data.topMoversLongform);
  renderChannelTabs(data.channels);
  renderTierFilter();

  const initial = getSortedFilteredChannels()[0];
  if (initial) {
    state.activeChannelId = initial.channelId;
    loadVideoTable(initial.channelId);
  }
  renderChannelTable();

  document.getElementById('channelSearch').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderChannelTable();
  });

  document.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = key;
        state.sortDir = key === 'title' ? 'asc' : 'desc';
      }
      document.querySelectorAll('th.sortable').forEach((t) => {
        t.classList.remove('sorted');
        const arrow = t.querySelector('.arrow');
        if (arrow) arrow.textContent = '▾';
      });
      th.classList.add('sorted');
      const arrow = th.querySelector('.arrow');
      if (arrow) arrow.textContent = state.sortDir === 'asc' ? '▴' : '▾';
      renderChannelTable();
    });
  });
}

function renderKpiTiles(data) {
  const channels = data.channels;
  const totalSubscribers = channels.reduce((sum, c) => sum + c.latest.subscriberCount, 0);
  const reachRates = channels.map((c) => c.reachRateMedian).filter((v) => v !== null && v !== undefined);
  const avgReach = reachRates.length ? reachRates.reduce((a, b) => a + b, 0) / reachRates.length : null;

  const growthCandidates = channels.filter((c) => c.growthRate30d !== null && c.growthRate30d !== undefined);
  const topGrower = growthCandidates.length ? growthCandidates.reduce((a, b) => (b.growthRate30d > a.growthRate30d ? b : a)) : null;

  const topMoverCandidates = [...(data.topMoversShorts || []), ...(data.topMoversLongform || [])];
  const topMover = topMoverCandidates.length ? topMoverCandidates.reduce((a, b) => (b.viewDelta > a.viewDelta ? b : a)) : null;

  const tiles = [
    { label: '추적 채널 수', value: `${channels.length}개`, sub: `합산 구독자 ${fmtNum(totalSubscribers)}명` },
    { label: '평균 도달률 (중앙값 기준)', value: fmtPercent(avgReach), sub: '영상 1개 튀는 값에 덜 흔들리는 지표' },
    {
      label: '30일 최고 성장 채널',
      value: topGrower ? truncate(topGrower.title, 24) : '집계 중',
      sub: topGrower ? `구독자 +${topGrower.growthRate30d.toFixed(1)}%` : '데이터가 30일 쌓이면 표시돼요',
      isText: true,
    },
    {
      label: '오늘 급상승 콘텐츠',
      value: topMover ? truncate(topMover.title, 24) : '집계 중',
      sub: topMover ? `${topMover.isShort ? '숏폼' : '롱폼'} · +${topMover.viewDelta.toLocaleString('ko-KR')}회` : '내일부터 표시돼요',
      isText: true,
    },
  ];

  document.getElementById('kpiGrid').innerHTML = tiles
    .map(
      (t) => `
    <div class="card kpi-tile">
      <div class="kpi-label">${t.label}</div>
      <div class="kpi-value${t.isText ? ' text' : ''}">${t.value}</div>
      <div class="kpi-sub">${t.sub}</div>
    </div>
  `
    )
    .join('');
}

function renderTierFilter() {
  const el = document.getElementById('tierFilter');
  el.innerHTML = TIERS.map((t) => `<button class="tier-btn${t.key === state.tier ? ' active' : ''}" data-tier="${t.key}">${t.label}</button>`).join(
    ''
  );
  el.querySelectorAll('.tier-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tier = btn.dataset.tier;
      el.querySelectorAll('.tier-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderChannelTable();
    });
  });
}

function getSortValue(c, key) {
  if (key === 'title') return c.title;
  if (key === 'subscriberCount') return c.latest.subscriberCount;
  return c[key];
}

function getSortedFilteredChannels() {
  const q = state.search.trim().toLowerCase();
  const tier = TIERS.find((t) => t.key === state.tier) || TIERS[0];
  let rows = state.channels.filter((c) => c.title.toLowerCase().includes(q) && tier.test(c.latest.subscriberCount));

  rows = rows.slice().sort((a, b) => {
    if (state.sortKey === 'title') {
      return state.sortDir === 'asc' ? a.title.localeCompare(b.title, 'ko') : b.title.localeCompare(a.title, 'ko');
    }
    const av = getSortValue(a, state.sortKey);
    const bv = getSortValue(b, state.sortKey);
    // 값이 없는 항목은 정렬 방향과 무관하게 항상 맨 아래로 보낸다.
    const aMissing = av === null || av === undefined;
    const bMissing = bv === null || bv === undefined;
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    return state.sortDir === 'asc' ? av - bv : bv - av;
  });

  return rows;
}

function renderChannelTable() {
  const rows = getSortedFilteredChannels();
  const tbody = document.getElementById('channelTableBody');

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">조건에 맞는 채널이 없어요.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((c) => {
      const growth = fmtGrowthPercent(c.growthRate30d);
      const spark = sparklineSvg(c.dailyStats.map((d) => d.subscriberCount));
      const active = c.channelId === state.activeChannelId ? ' active' : '';
      const reachCell =
        c.reachRateMedian === null
          ? '-'
          : `${fmtPercent(c.reachRateMedian)}<div style="color:var(--text-muted); font-size:11px; margin-top:2px;">평균 ${fmtPercent(c.reachRate)}</div>`;
      return `
      <tr class="channel-row${active}" data-channel-id="${c.channelId}">
        <td class="channel-name-cell">${c.title}</td>
        <td class="num">${fmtNum(c.latest.subscriberCount)}</td>
        <td class="num"><span class="delta-badge ${growth.cls}">${growth.text}</span></td>
        <td class="num">${c.viewDelta7d === null ? '집계 중' : `+${fmtNum(c.viewDelta7d)}`}</td>
        <td class="num">${c.uploadsPerWeek.toFixed(1)}회</td>
        <td class="num">${fmtNum(c.avgViewsPerVideo)}</td>
        <td class="num">${fmtPercent(c.engagementRate, 2)}</td>
        <td class="num">${reachCell}</td>
        <td class="sparkline-cell">${spark}</td>
      </tr>
    `;
    })
    .join('');

  tbody.querySelectorAll('.channel-row').forEach((tr) => {
    tr.addEventListener('click', () => selectChannel(tr.dataset.channelId, { scroll: true }));
  });
}

function renderMoverList(movers) {
  if (!movers || movers.length === 0) {
    return `<div class="empty-state">아직 비교할 전날 데이터가 없어요.</div>`;
  }
  return movers
    .slice(0, 5)
    .map(
      (m) => `
    <a class="mover-row" href="https://www.youtube.com/watch?v=${m.videoId}" target="_blank" rel="noopener noreferrer">
      <div>
        <div class="mover-title">${m.title}</div>
        <div class="mover-channel">${m.channelTitle}</div>
      </div>
      <div class="mover-delta">+${m.viewDelta.toLocaleString('ko-KR')}</div>
    </a>
  `
    )
    .join('');
}

function renderMovers(moversShorts, moversLongform) {
  const el = document.getElementById('moversCard');
  if ((!moversShorts || moversShorts.length === 0) && (!moversLongform || moversLongform.length === 0)) {
    el.innerHTML = `<div class="empty-state">아직 비교할 전날 데이터가 없어요. 다음 날 수집부터 순위가 표시됩니다.</div>`;
    return;
  }
  el.innerHTML = `
    <div class="movers-split">
      <div>
        <div class="movers-subhead">숏폼</div>
        ${renderMoverList(moversShorts)}
      </div>
      <div>
        <div class="movers-subhead">롱폼</div>
        ${renderMoverList(moversLongform)}
      </div>
    </div>
  `;
}

function renderChannelTabs(channels) {
  const tabs = document.getElementById('channelTabs');
  tabs.innerHTML = '';
  channels.forEach((ch) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (ch.channelId === state.activeChannelId ? ' active' : '');
    btn.textContent = ch.title;
    btn.dataset.channelId = ch.channelId;
    btn.addEventListener('click', () => selectChannel(ch.channelId));
    tabs.appendChild(btn);
  });
}

function selectChannel(channelId, { scroll = false } = {}) {
  state.activeChannelId = channelId;
  renderChannelTable();
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.channelId === channelId));
  loadVideoTable(channelId);
  if (scroll) {
    document.getElementById('channelTabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function loadVideoTable(channelId) {
  const res = await fetch(`data/channel_${channelId}.json`, { cache: 'no-store' });
  const data = await res.json();
  const tbody = document.getElementById('videoTableBody');

  const rows = data.videos
    .map((v) => {
      const stats = v.dailyStats;
      const latest = stats[stats.length - 1];
      const dayDelta = stats.length >= 2 ? latest.viewCount - stats[stats.length - 2].viewCount : null;
      return {
        videoId: v.videoId,
        title: v.title,
        publishedAt: v.publishedAt,
        durationSeconds: v.durationSeconds,
        likeRate: v.likeRate,
        commentRate: v.commentRate,
        latest,
        dayDelta,
      };
    })
    .sort((a, b) => b.latest.viewCount - a.latest.viewCount);

  tbody.innerHTML = rows
    .map((r) => {
      const d = fmtDelta(r.dayDelta);
      return `
      <tr>
        <td>${formatBadge(r.durationSeconds)} <a class="video-link" href="https://www.youtube.com/watch?v=${r.videoId}" target="_blank" rel="noopener noreferrer">${r.title}</a></td>
        <td>${fmtDate(r.publishedAt)}</td>
        <td class="num">${fmtNum(r.latest.viewCount)}</td>
        <td class="num">${fmtNum(r.latest.likeCount)}</td>
        <td class="num">${fmtPercent(r.likeRate, 2)}</td>
        <td class="num">${fmtPercent(r.commentRate, 2)}</td>
        <td class="num ${r.dayDelta === null ? '' : d.cls}">${r.dayDelta === null ? '-' : d.text}</td>
      </tr>
    `;
    })
    .join('');
}

main().catch((err) => {
  document.getElementById('updated').textContent = `데이터 로드 실패: ${err.message}`;
});
