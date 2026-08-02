const vizRoot = document.querySelector('.viz-root');
const style = getComputedStyle(vizRoot);
const seriesColor = style.getPropertyValue('--series-1').trim();

const state = { channels: [], sortKey: 'subscriberCount', sortDir: 'desc', search: '', activeChannelId: null };

function fmtNum(n) {
  return n === null || n === undefined ? '-' : n.toLocaleString('ko-KR');
}

function fmtPercent(n) {
  return n === null || n === undefined ? '-' : `${n.toFixed(1)}%`;
}

function fmtDelta(n) {
  if (n === null || n === undefined) return { text: '집계 중', cls: 'delta-empty' };
  if (n > 0) return { text: `▲ ${n.toLocaleString('ko-KR')}`, cls: 'delta-up' };
  if (n < 0) return { text: `▼ ${Math.abs(n).toLocaleString('ko-KR')}`, cls: 'delta-down' };
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

async function main() {
  const res = await fetch('data/index.json', { cache: 'no-store' });
  const data = await res.json();

  document.getElementById('updated').textContent =
    `마지막 업데이트: ${new Date(data.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (KST)`;

  state.channels = data.channels;

  renderKpiTiles(data);
  renderMovers(data.topMovers);
  renderChannelTabs(data.channels);

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
  const reachRates = channels.map((c) => c.reachRate).filter((v) => v !== null && v !== undefined);
  const avgReach = reachRates.length ? reachRates.reduce((a, b) => a + b, 0) / reachRates.length : null;

  const growthCandidates = channels.filter((c) => c.delta7d !== null && c.delta7d !== undefined);
  const topGrower = growthCandidates.length ? growthCandidates.reduce((a, b) => (b.delta7d > a.delta7d ? b : a)) : null;

  const tiles = [
    { label: '추적 채널 수', value: `${channels.length}개`, sub: `합산 구독자 ${fmtNum(totalSubscribers)}명` },
    { label: '평균 도달률', value: fmtPercent(avgReach), sub: '최근 영상 평균 조회수 ÷ 구독자 수' },
    {
      label: '7일 최고 성장 채널',
      value: topGrower ? topGrower.title : '집계 중',
      sub: topGrower ? `+${topGrower.delta7d.toLocaleString('ko-KR')}명` : '내일부터 표시돼요',
    },
    {
      label: '오늘 급상승 콘텐츠',
      value: data.topMovers.length ? data.topMovers[0].title : '집계 중',
      sub: data.topMovers.length ? `+${data.topMovers[0].viewDelta.toLocaleString('ko-KR')}회` : '내일부터 표시돼요',
    },
  ];

  document.getElementById('kpiGrid').innerHTML = tiles
    .map(
      (t) => `
    <div class="card kpi-tile">
      <div class="kpi-label">${t.label}</div>
      <div class="kpi-value">${t.value}</div>
      <div class="kpi-sub">${t.sub}</div>
    </div>
  `
    )
    .join('');
}

function getSortValue(c, key) {
  if (key === 'title') return c.title;
  if (key === 'subscriberCount') return c.latest.subscriberCount;
  if (key === 'totalViewCount') return c.latest.totalViewCount;
  if (key === 'delta7d') return c.delta7d;
  if (key === 'reachRate') return c.reachRate;
  return null;
}

function getSortedFilteredChannels() {
  const q = state.search.trim().toLowerCase();
  let rows = state.channels.filter((c) => c.title.toLowerCase().includes(q));

  rows = rows.slice().sort((a, b) => {
    if (state.sortKey === 'title') {
      return state.sortDir === 'asc' ? a.title.localeCompare(b.title, 'ko') : b.title.localeCompare(a.title, 'ko');
    }
    let av = getSortValue(a, state.sortKey);
    let bv = getSortValue(b, state.sortKey);
    av = av === null || av === undefined ? -Infinity : av;
    bv = bv === null || bv === undefined ? -Infinity : bv;
    return state.sortDir === 'asc' ? av - bv : bv - av;
  });

  return rows;
}

function renderChannelTable() {
  const rows = getSortedFilteredChannels();
  const tbody = document.getElementById('channelTableBody');

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">검색 결과가 없어요.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((c) => {
      const d7 = fmtDelta(c.delta7d);
      const spark = sparklineSvg(c.dailyStats.map((d) => d.subscriberCount));
      const active = c.channelId === state.activeChannelId ? ' active' : '';
      return `
      <tr class="channel-row${active}" data-channel-id="${c.channelId}">
        <td class="channel-name-cell">${c.title}</td>
        <td class="num">${fmtNum(c.latest.subscriberCount)}</td>
        <td class="num"><span class="delta-badge ${d7.cls}">${d7.text}</span></td>
        <td class="num">${fmtNum(c.latest.totalViewCount)}</td>
        <td class="num">${fmtPercent(c.reachRate)}</td>
        <td class="sparkline-cell">${spark}</td>
      </tr>
    `;
    })
    .join('');

  tbody.querySelectorAll('.channel-row').forEach((tr) => {
    tr.addEventListener('click', () => selectChannel(tr.dataset.channelId, { scroll: true }));
  });
}

function renderMovers(movers) {
  const el = document.getElementById('moversCard');
  if (!movers || movers.length === 0) {
    el.innerHTML = `<div class="empty-state">아직 비교할 전날 데이터가 없어요. 다음 날 수집부터 순위가 표시됩니다.</div>`;
    return;
  }
  el.innerHTML = movers
    .map(
      (m) => `
    <div class="mover-row">
      <div>
        <div class="mover-title">${m.title}</div>
        <div class="mover-channel">${m.channelTitle}</div>
      </div>
      <div class="mover-delta">+${m.viewDelta.toLocaleString('ko-KR')}</div>
    </div>
  `
    )
    .join('');
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
      return { title: v.title, publishedAt: v.publishedAt, latest, dayDelta };
    })
    .sort((a, b) => b.latest.viewCount - a.latest.viewCount);

  tbody.innerHTML = rows
    .map((r) => {
      const d = fmtDelta(r.dayDelta);
      return `
      <tr>
        <td>${r.title}</td>
        <td>${fmtDate(r.publishedAt)}</td>
        <td class="num">${fmtNum(r.latest.viewCount)}</td>
        <td class="num">${fmtNum(r.latest.likeCount)}</td>
        <td class="num">${fmtNum(r.latest.commentCount)}</td>
        <td class="num ${r.dayDelta === null ? '' : d.cls}">${r.dayDelta === null ? '-' : d.text}</td>
      </tr>
    `;
    })
    .join('');
}

main().catch((err) => {
  document.getElementById('updated').textContent = `데이터 로드 실패: ${err.message}`;
});
