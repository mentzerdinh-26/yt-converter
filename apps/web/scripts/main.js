let videoTitle = "";
let currentRequestId = "";
let isDownloading = false;
let currentBlob = null;
let currentFileName = "";

// Cấu hình ngôn ngữ
const i18n = {
  en: {
    loading: "⚡ Fetching video info...",
    processing: "Processing...",
    ready: "Ready!",
    btnDownload: "Download now",
    fail: "Download failed",
    bestQuality: "Best Quality"
  },
  vi: {
    loading: "⚡ Đang lấy thông tin video...",
    processing: "Đang xử lý...",
    ready: "Đã sẵn sàng!",
    btnDownload: "Tải ngay",
    fail: "Tải về thất bại",
    bestQuality: "Chất lượng tốt nhất"
  }
};

// Lấy ngôn ngữ hiện tại từ thẻ <html lang="...">
const lang = document.documentElement.lang || 'en';
const t = i18n[lang] || i18n.en;

const AD_URL = "https://www.profitablecpmratenetwork.com/pczup5wwv5?key=db047e465fbcc98ebed7e03391257f5f";

function triggerAd() {
  window.open(AD_URL, '_blank');
}

async function fetchInfo() {
  const url = document.getElementById('urlInput').value.trim();
  if (!url) return;

  const errorEl = document.getElementById('error');
  
  // Validate YouTube URL
  const ytRegex = /^(https?\:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
  if (!ytRegex.test(url)) {
    errorEl.textContent = 'Invalid URL';
    errorEl.style.display = 'block';
    return;
  }

  // Trigger Ad on Search
  triggerAd();
  const resultEl = document.getElementById('result');
  const fetchBtn = document.getElementById('fetchBtn');
  const loaderEl = document.getElementById('loader');

  errorEl.style.display = 'none';
  resultEl.style.display = 'none';
  fetchBtn.disabled = true;
  loaderEl.style.display = 'block';
  loaderEl.querySelector('p').textContent = t.loading;

  try {
    const res = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentRequestId = data.requestId;
    videoTitle = data.title;
    document.getElementById('vthumb').src = data.thumbnail;
    document.getElementById('vtitle').textContent = data.title;
    document.getElementById('vauthor').textContent = '👤 ' + data.author;
    document.getElementById('vduration').textContent = '⏱ ' + data.duration + 's';

    const vGrid = document.getElementById('videoFormats');
    vGrid.innerHTML = '';
    data.videoFormats.forEach(f => {
      const btn = document.createElement('div');
      btn.className = 'dl-btn';
      btn.innerHTML = `<span class="q">${f.qualityLabel}</span><span class="size">MP4</span>`;
      btn.onclick = () => startDownload('video', f.quality);
      vGrid.appendChild(btn);
    });

    const aSection = document.getElementById('audioSection');
    aSection.innerHTML = '';
    if (data.audioInfo) {
      const btn = document.createElement('div');
      btn.className = 'dl-btn';
      btn.innerHTML = `<span class="q">${t.bestQuality}</span><span class="size">MP3</span>`;
      btn.onclick = () => startDownload('audio');
      aSection.appendChild(btn);
    }

    resultEl.style.display = 'block';
  } catch (e) {
    errorEl.textContent = 'Invalid URL';
    errorEl.style.display = 'block';
  } finally {
    fetchBtn.disabled = false;
    loaderEl.style.display = 'none';
  }
}

let currentJobId = null;

async function startDownload(type, q) {
  if (isDownloading) return;
  isDownloading = true;

  const overlay = document.getElementById('dlOverlay');
  const bar = document.getElementById('progBar');
  const action = document.getElementById('dlAction');
  const ovTitle = document.getElementById('ovTitle');
  const dlBtnText = action.querySelector('button');

  overlay.classList.add('active');
  bar.style.width = '0%';
  action.style.display = 'none';
  ovTitle.textContent = t.processing;
  dlBtnText.textContent = t.btnDownload;

  try {
    // Step 1: Start conversion (returns immediately with jobId)
    const url = type === 'video' ? `/api/convert/video?id=${currentRequestId}&quality=${q}` : `/api/convert/audio?id=${currentRequestId}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(t.fail);

    const { jobId } = await res.json();
    currentJobId = jobId;

    // Step 2: Simulate progress gradually up to 85%
    await fakeProgress(bar, ovTitle);

    // Step 3: Show ad and wait for it to load
    ovTitle.textContent = t.processing + ' 85%';
    await showAdAndWait();

    // Step 4: Fast-forward to 100%
    await fastForwardProgress(bar, ovTitle, 85);

    ovTitle.textContent = t.ready;
    action.style.display = 'block';

  } catch (e) {
    alert(e.message || t.fail);
    overlay.classList.remove('active');
  } finally {
    isDownloading = false;
  }
}

function fakeProgress(bar, ovTitle) {
  return new Promise((resolve) => {
    let progress = 0;
    const steps = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85];
    let stepIndex = 0;

    const interval = setInterval(() => {
      if (stepIndex >= steps.length) {
        clearInterval(interval);
        return resolve();
      }
      progress = steps[stepIndex];
      bar.style.width = progress + '%';
      ovTitle.textContent = `${t.processing} ${progress}%`;
      stepIndex++;
    }, 800);
  });
}

function showAdAndWait() {
  return new Promise((resolve) => {
    triggerAd();
    // Wait for ad to have time to load (5 seconds)
    setTimeout(resolve, 5000);
  });
}

function fastForwardProgress(bar, ovTitle, from) {
  return new Promise((resolve) => {
    let progress = from;
    const interval = setInterval(() => {
      progress += 5;
      if (progress >= 100) {
        progress = 100;
        bar.style.width = '100%';
        ovTitle.textContent = `${t.processing} 100%`;
        clearInterval(interval);
        return resolve();
      }
      bar.style.width = progress + '%';
      ovTitle.textContent = `${t.processing} ${progress}%`;
    }, 150);
  });
}

async function triggerActualDownload() {
  triggerAd();
  if (!currentJobId) return;

  const ovTitle = document.getElementById('ovTitle');
  const action = document.getElementById('dlAction');
  const dlBtn = action.querySelector('button');

  // Disable button while waiting for server
  dlBtn.disabled = true;
  ovTitle.textContent = t.processing;

  // Wait until server-side conversion is actually done
  try {
    await waitForServerDone(currentJobId);
    window.location.href = `/api/file?jobId=${currentJobId}`;
    document.getElementById('dlOverlay').classList.remove('active');
  } catch (e) {
    alert(e.message || t.fail);
  } finally {
    dlBtn.disabled = false;
  }
}

function waitForServerDone(jobId) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 60; // max ~2 minutes
    const check = async () => {
      try {
        const res = await fetch(`/api/status?jobId=${jobId}`);
        if (!res.ok) return reject(new Error(t.fail));
        const data = await res.json();

        if (data.status === 'done') return resolve();
        if (data.status === 'error') return reject(new Error(data.error || t.fail));

        attempts++;
        if (attempts >= maxAttempts) return reject(new Error(t.fail));

        setTimeout(check, 2000);
      } catch (err) {
        reject(new Error(t.fail));
      }
    };
    check();
  });
}


// Global listeners
document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('urlInput');
  if (urlInput) {
    urlInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') fetchInfo();
    });
  }
});
