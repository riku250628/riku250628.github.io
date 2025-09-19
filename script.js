let globalData = [];
let charts = {};
let autoSyncInterval = null;

// Configuration variables - will be loaded from config.json
let currentSource;
let currentTimeRange;
let selectedMembers;
let memberColors;
let videoNames;
let summarySheetUrl;
let sheetsUrls;

// Check authentication status
function checkAuthentication() {
  const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
  if (!isLoggedIn) {
    window.location.href = './login.html';
    return false;
  }
  return true;
}

// Logout function
function logout() {
  localStorage.removeItem('isLoggedIn');
  localStorage.removeItem('currentUser');
  localStorage.removeItem('rememberMe');
  window.location.href = './login.html';
}

// Load configuration from config.json
async function loadConfig() {
  try {
    const response = await fetch('./config.json');
    const config = await response.json();

    // Set default values
    currentSource = config.defaultSettings.currentSource;
    currentTimeRange = config.defaultSettings.currentTimeRange;
    selectedMembers = new Set(config.defaultSettings.selectedMembers);

    // Set configuration objects
    memberColors = config.memberColors;
    videoNames = config.videoNames;
    summarySheetUrl = config.urls.summarySheetUrl;
    sheetsUrls = config.urls.sheetsUrls;

    console.log('Configuration loaded successfully');
    return true;
  } catch (error) {
    console.error('Error loading configuration:', error);
    // Fallback to default values if config loading fails
    currentSource = '';
    currentTimeRange = '7d';
    selectedMembers = new Set();
    memberColors = {};
    videoNames = {};
    summarySheetUrl = '';
    sheetsUrls = {};
    return false;
  }
}

function selectDate(source) {
  document.querySelectorAll('.date-button').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`[data-date="${source}"]`).classList.add('active');
  currentSource = source;
  loadData();
}

function selectTimeRange(range) {
  console.log(`选择时间范围: ${range}`);
  document.querySelectorAll('.time-button').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`[data-range="${range}"]`).classList.add('active');
  currentTimeRange = range;
  console.log(`当前时间范围设置为: ${currentTimeRange}`);
  if (globalData.length > 0) {
    createCharts();
  }
}

function toggleMember(member) {
  if (selectedMembers.has(member)) {
    selectedMembers.delete(member);
    document.querySelector(`[data-member="${member}"]`).classList.remove('active');
  } else {
    selectedMembers.add(member);
    document.querySelector(`[data-member="${member}"]`).classList.add('active');
  }

  if (globalData.length > 0) {
    createCharts();
  }
}

function updateButtonStates() {
  document.querySelectorAll('.date-button').forEach(btn => {
    const source = btn.getAttribute('data-date');
    const hasData = sheetsUrls[source] && sheetsUrls[source] !== '';
    btn.disabled = !hasData;
    btn.style.opacity = hasData ? '1' : '0.5';
  });
}

function showStatus(message, type = 'success') {
  const existingToast = document.querySelector('.toast');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 100);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function updateSyncStatus(status, message = '') {
  document.getElementById('syncStatus').innerHTML = status;
  if (globalData.length > 0) {
    const latestTime = Math.max(...globalData.map(row => parseDateTime(row.更新时间)));
    document.getElementById('latestData').textContent =
      `最新数据: ${new Date(latestTime).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })}`;
  }
  if (message) showStatus(message, status.includes('错误') ? 'error' : 'success');
}

function parseNumber(value) {
  return parseInt(String(value || 0).replace(/,/g, '')) || 0;
}

function parseDateTime(dateTimeStr) {
  try {
    return new Date(dateTimeStr || new Date());
  } catch {
    return new Date();
  }
}

function filterDataByTimeRange(data) {
  if (currentTimeRange === 'all') return data;

  const now = new Date();
  let cutoffTime = new Date();

  switch (currentTimeRange) {
    case '6h':
      cutoffTime = new Date(now.getTime() - 6 * 60 * 60 * 1000);
      break;
    case '12h':
      cutoffTime = new Date(now.getTime() - 12 * 60 * 60 * 1000);
      break;
    case '1d':
      cutoffTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case '3d':
      cutoffTime = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      break;
    case '7d':
      cutoffTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    default:
      return data;
  }

  console.log(
    `过滤时间范围: ${currentTimeRange}, 截止时间: ${cutoffTime.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })}, 当前时间: ${now.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })}`);
  const filtered = data.filter(row => {
    const rowTime = parseDateTime(row.更新时间);
    return rowTime >= cutoffTime;
  });
  console.log(`原始数据: ${data.length} 条, 过滤后: ${filtered.length} 条`);
  return filtered;
}

function filterDataByMembers(data) {
  return data.filter(row => selectedMembers.has(row.成员));
}

async function loadData() {
  await syncFromGoogleSheets();
}

async function syncFromGoogleSheets() {
  const sheetsUrl = sheetsUrls[currentSource];
  if (!sheetsUrl) {
    updateSyncStatus('⚠ 待配置', `${currentSource} 的URL尚未配置且无本地文件`);
    return;
  }

  updateSyncStatus(
    '<span class="material-icons" style="font-size: 14px; vertical-align: middle; color: #3b82f6;">sync</span> 同步中...'
  );
  try {
    const response = await fetch(sheetsUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const csvText = await response.text();
    if (!csvText || csvText.includes('<html')) {
      throw new Error('获取的不是CSV资料，可能是权限问题');
    }

    Papa.parse(csvText, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
      complete: function (results) {
        const newData = results.data.filter(row => row.成员 && row.视频ID && row.更新时间);
        if (newData.length === 0) {
          updateSyncStatus('⚠ 数据为空', '未找到有效的YouTube数据');
          return;
        }
        newData.sort((a, b) => parseDateTime(a.更新时间) - parseDateTime(b.更新时间));
        const hasDataChanged = globalData.length !== newData.length ||
          JSON.stringify(globalData) !== JSON.stringify(newData);
        if (hasDataChanged) {
          globalData = newData;
          createCharts();
          updateSyncStatus(
            '<span class="material-icons" style="font-size: 14px; vertical-align: middle; color: #4ade80;">check_circle</span> 同步完成'
          );
        } else {
          updateSyncStatus(
            '<span class="material-icons" style="font-size: 14px; vertical-align: middle; color: #4ade80;">check_circle</span> 同步完成'
          );
        }
      },
      error: function (error) {
        updateSyncStatus('⚠ 连接错误', 'CSV解析错误: ' + error.message);
      }
    });
  } catch (error) {
    updateSyncStatus('⚠ 连接错误', error.message);
  }
}

function createCharts() {
  if (globalData.length === 0) return;
  Object.values(charts).forEach(chart => chart && chart.destroy());
  charts = {};

  // Update video names in chart titles
  const videoName = videoNames[currentSource] || currentSource;
  document.getElementById('viewCountVideoName').textContent = videoName;
  document.getElementById('likeCountVideoName').textContent = videoName;
  document.getElementById('commentCountVideoName').textContent = videoName;

  const timeFilteredData = filterDataByTimeRange(globalData);
  const filteredData = filterDataByMembers(timeFilteredData);

  if (filteredData.length === 0) {
    console.log('过滤后无数据');
    return;
  }

  const members = [...selectedMembers].filter(member =>
    filteredData.some(row => row.成员 === member)
  );

  const timePoints = [...new Set(filteredData.map(row => row.更新时间))].sort((a, b) => parseDateTime(a) -
    parseDateTime(b));

  const metrics = [{
      key: '观看次数',
      id: 'viewCountChart'
    },
    {
      key: '点赞数',
      id: 'likeCountChart'
    },
    {
      key: '评论数',
      id: 'commentCountChart'
    }
  ];

  metrics.forEach(metric => {
    charts[metric.id] = createTrendChart(metric.id, timePoints, metric.key, members, memberColors,
      filteredData);
  });
}

function createTrendChart(canvasId, timePoints, dataKey, members, memberColors, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');

  const datasets = members.map(member => {
    const memberData = timePoints.map(time => {
      const row = data.find(r => r.更新时间 === time && r.成员 === member);
      return row ? parseNumber(row[dataKey]) : null;
    });

    return {
      label: member,
      data: memberData,
      borderColor: memberColors[member] || '#64B5F6',
      backgroundColor: (memberColors[member] || '#64B5F6') + '20',
      borderWidth: window.innerWidth < 768 ? 2 : 3,
      pointRadius: window.innerWidth < 768 ? 1.5 : 2,
      pointHoverRadius: window.innerWidth < 768 ? 3 : 4,
      tension: 0.4,
      spanGaps: true,
      fill: false
    };
  });

  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: timePoints.map(time => {
        const date = parseDateTime(time);
        return date.toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        }).replace(/\//g, '-');
      }),
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      scales: {
        y: {
          beginAtZero: false,
          ticks: {
            color: '#b0b0b0',
            callback: value => value.toLocaleString(),
            font: {
              size: window.innerWidth < 768 ? 10 : 12
            }
          },
          grid: {
            color: '#404040'
          }
        },
        x: {
          ticks: {
            color: '#b0b0b0',
            maxRotation: window.innerWidth < 768 ? 90 : 45,
            font: {
              size: window.innerWidth < 768 ? 10 : 12
            }
          },
          grid: {
            color: '#404040'
          }
        }
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: '#e0e0e0',
            usePointStyle: true,
            pointStyle: 'circle',
            padding: 20,
            boxWidth: 15,
            boxHeight: 15,
            generateLabels: function (chart) {
              const original = Chart.defaults.plugins.legend.labels.generateLabels;
              const labels = original.call(this, chart);
              labels.forEach(label => {
                label.pointStyle = 'circle';
                label.fillStyle = label.strokeStyle;
                label.text = ' ' + label.text;
              });
              return labels;
            }
          }
        },
        tooltip: {
          backgroundColor: '#2d2d2d',
          titleColor: '#e0e0e0',
          bodyColor: '#e0e0e0',
          borderColor: '#64B5F6',
          borderWidth: 1,
          usePointStyle: true,
          callbacks: {
            label: context =>
              ` ${context.dataset.label}: ${context.parsed.y.toLocaleString()}`,
            labelColor: context => ({
              borderColor: context.dataset.borderColor,
              backgroundColor: context.dataset.borderColor,
              borderWidth: 0,
              borderRadius: 0
            })
          }
        }
      }
    }
  });
}

window.addEventListener('load', async () => {
  // Check authentication first
  if (!checkAuthentication()) {
    return;
  }

  // Display current user
  const currentUser = localStorage.getItem('currentUser') || '用户';
  const userElement = document.getElementById('currentUser');
  if (userElement) {
    userElement.textContent = currentUser;
  }

  // Load configuration first
  await loadConfig();

  updateButtonStates();
  setTimeout(() => {
    loadData();
    autoSyncInterval = setInterval(() => {
      syncFromGoogleSheets();
    }, 60000);
    // updateSyncStatus(
    //   '<span class="material-icons" style="font-size: 14px; vertical-align: middle; color: #22c55e;">check_circle</span> 已连接 - 自动同步中'
    // );
  }, 1000);
});

window.addEventListener('beforeunload', () => autoSyncInterval && clearInterval(autoSyncInterval));

// Material Design 3 Secondary Tabs functionality
function switchTab(tabName) {
  // Remove active state from all tabs and panels
  document.querySelectorAll('.md3-secondary-tab').forEach(tab => {
    tab.classList.remove('active');
    tab.setAttribute('aria-selected', 'false');
  });

  document.querySelectorAll('.tab-content').forEach(panel => {
    panel.classList.remove('active');
  });

  // Add active state to selected tab and panel
  const selectedTab = document.getElementById(`${tabName}-tab`);
  const selectedPanel = document.getElementById(`${tabName}-panel`);

  if (selectedTab && selectedPanel) {
    selectedTab.classList.add('active');
    selectedTab.setAttribute('aria-selected', 'true');
    selectedPanel.classList.add('active');
  }
}

// Keyboard navigation for tabs
document.addEventListener('keydown', function (e) {
  if (e.target.classList.contains('md3-secondary-tab')) {
    const tabs = Array.from(document.querySelectorAll('.md3-secondary-tab'));
    const currentIndex = tabs.indexOf(e.target);
    let nextIndex;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        nextIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
        tabs[nextIndex].focus();
        break;
      case 'ArrowRight':
        e.preventDefault();
        nextIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
        tabs[nextIndex].focus();
        break;
      case 'Home':
        e.preventDefault();
        tabs[0].focus();
        break;
      case 'End':
        e.preventDefault();
        tabs[tabs.length - 1].focus();
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        e.target.click();
        break;
    }
  }
});

// Summary table functionality
let summaryData = [];

async function loadSummaryData() {
  try {
    const response = await fetch(summarySheetUrl);
    const csvText = await response.text();
    const rows = csvText.split('\n').filter(row => row.trim());

    // Skip header row and parse data
    summaryData = rows.slice(1).map(row => {
      // Parse CSV properly handling quoted fields
      const cols = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < row.length; i++) {
        const char = row[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          cols.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      cols.push(current.trim()); // Add the last column

      console.log(row);
      return {
        member: cols[1] || '',
        videoKey: cols[4] || '',
        viewCount: parseInt(cols[5] ? cols[5].replace(/,/g, '') : 0),
        likeCount: parseInt(cols[6] ? cols[6].replace(/,/g, '') : 0),
        likeRatio: cols[7] || '',
      };
    }).filter(item => item.member && item.videoKey);

    populateSummaryTable();
  } catch (error) {
    console.error('Error loading summary data:', error);
  }
}

function populateSummaryTable() {
  const tbody = document.getElementById('summaryTableBody');
  tbody.innerHTML = '';

  // Group by video to find rankings
  const videoGroups = {};
  summaryData.forEach(item => {
    if (!videoGroups[item.videoKey]) {
      videoGroups[item.videoKey] = [];
    }
    videoGroups[item.videoKey].push(item);
  });

  // Sort each group by view count and mark top performer
  Object.keys(videoGroups).forEach(videoKey => {
    videoGroups[videoKey].sort((a, b) => b.viewCount - a.viewCount);
    if (videoGroups[videoKey].length > 0) {
      videoGroups[videoKey][0].isTop = true;
    }
  });

  // Create table rows
  let lastVideoKey = null;
  summaryData.forEach((item, index) => {
    const row = document.createElement('tr');

    // Get video display name
    const videoDisplayName = videoNames[item.videoKey] || item.videoKey;

    // Add separator class if this is the last row of a video group
    const nextItem = summaryData[index + 1];
    if (nextItem && item.videoKey !== nextItem.videoKey) {
      row.classList.add('video-group-separator');
    }

    // Format numbers with commas
    const formatNumber = (num) => num.toLocaleString();

    row.innerHTML = `
      <td><span class="video-name">${videoDisplayName}</span></td>
      <td><span class="member-name${item.isTop ? ' top-member' : ''}">${item.member}${item.isTop ? '<span class="material-symbols-outlined">chess_queen</span>' : ''}</span></td>
      <td><span class="view-count">${formatNumber(item.viewCount)}</span></td>
      <td><span class="like-count">${formatNumber(item.likeCount)}</span></td>
      <td><span class="like-ratio">${item.likeRatio}</span></td>
    `;

    tbody.appendChild(row);
    lastVideoKey = item.videoKey;
  });
}

// Load summary data when page loads
document.addEventListener('DOMContentLoaded', async function () {
  // Check authentication first
  if (!checkAuthentication()) {
    return;
  }
  
  // Ensure config is loaded before loading summary data
  await loadConfig();
  loadSummaryData();
});