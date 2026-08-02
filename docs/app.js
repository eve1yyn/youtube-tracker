const vizRoot = document.querySelector('.viz-root');
const style = getComputedStyle(vizRoot);
const seriesColors = [style.getPropertyValue('--series-1').trim(), style.getPropertyValue('--series-2').trim()];

function fmtNum(n) {
  return n === null || n === undefined ? '-' : n.toLocaleString('ko-KR');
}

function fmtDelta(n) {
  if (n === null || n === undefined) return { text: '데이터 쌓이는 중', cls: 'delta-empty' };
  if (n > 0) return { text: `▲ ${n.toLocaleString('ko-KR')}`, cls: 'delta-up' };
  if (n < 0) return { text: `▼ ${Math.abs(n).toLocaleString('ko-KR')}`, cls: 'delta-down' };
  return { text: '변화 없음', cls: 'delta-empty' };
}

function fmtDate(iso) {
  return iso ? iso.slice(0, 10) : '-';
}

async function main() {
  const res = await fetch('data/index.json', { cache: 'no-store' });
  const data = await res.json();

  document.getElementById('updated').textContent =
    `마지막 업데이트: ${new Date(data.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (KST)`;

  renderChannelCards(data.channels);
  renderSubscriberChart(data.channels);
  renderMovers(data.topMovers);
  renderChannelTabs(data.channels);
}

function renderChannelCards(channels) {
  const grid = document.getElementById('channelGrid');
  grid.innerHTML = '';
  channels.forEach((ch, i) => {
    const d7 = fmtDelta(ch.delta7d);
    const d30 = fmtDelta(ch.delta30d);
    const card = document.createElement('div');
    card.className = 'card channel-card';
    card.style.borderLeft = `4px solid ${seriesColors[i % seriesColors.length]}`;
    card.innerHTML = `
      <div class="name">${ch.title}</div>
      <div class="stat">${fmtNum(ch.latest.subscriberCount)}</div>
      <div class="label">구독자</div>
      <div class="deltas">
        <span class="${d7.cls}">7일: ${d7.text}</span>
        <span class="${d30.cls}">30일: ${d30.text}</span>
      </div>
      <div class="sub-stats">
        <span>총 조회수 ${fmtNum(ch.latest.totalViewCount)}</span>
        <span>영상 ${fmtNum(ch.latest.videoCount)}개</span>
      </div>
    `;
    grid.appendChild(card);
  });
}

function renderSubscriberChart(channels) {
  const totalPoints = channels.reduce((sum, ch) => sum + ch.dailyStats.length, 0);
  const canvas = document.getElementById('subscriberChart');
  const emptyState = document.getElementById('chartEmptyState');
  const legend = document.getElementById('chartLegend');

  legend.innerHTML = channels
    .map((ch, i) => `<span class="legend-item"><span class="swatch" style="background:${seriesColors[i % seriesColors.length]}"></span>${ch.title}</span>`)
    .join('');

  if (totalPoints < 2) {
    canvas.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }

  const allDates = [...new Set(channels.flatMap((ch) => ch.dailyStats.map((d) => d.date)))].sort();

  new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: allDates,
      datasets: channels.map((ch, i) => ({
        label: ch.title,
        data: allDates.map((date) => {
          const row = ch.dailyStats.find((d) => d.date === date);
          return row ? row.subscriberCount : null;
        }),
        borderColor: seriesColors[i % seriesColors.length],
        backgroundColor: seriesColors[i % seriesColors.length],
        borderWidth: 2,
        pointRadius: 4,
        spanGaps: true,
        tension: 0.2,
      })),
    },
    options: {
      plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: { ticks: { callback: (v) => v.toLocaleString('ko-KR') }, grid: { color: style.getPropertyValue('--gridline').trim() } },
        x: { grid: { display: false } },
      },
    },
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
  channels.forEach((ch, i) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (i === 0 ? ' active' : '');
    btn.textContent = ch.title;
    btn.addEventListener('click', () => {
      [...tabs.children].forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      loadVideoTable(ch.channelId);
    });
    tabs.appendChild(btn);
  });
  if (channels.length > 0) loadVideoTable(channels[0].channelId);
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
        <td class="num ${d.cls}">${r.dayDelta === null ? '-' : d.text}</td>
      </tr>
    `;
    })
    .join('');
}

main().catch((err) => {
  document.getElementById('updated').textContent = `데이터 로드 실패: ${err.message}`;
});
