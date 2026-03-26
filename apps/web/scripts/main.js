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

    // Step 2: Poll for job status with real progress
    await pollJobStatus(jobId, bar, ovTitle);

    bar.style.width = '100%';
    ovTitle.textContent = t.ready;
    action.style.display = 'block';

  } catch (e) {
    alert(e.message || t.fail);
    overlay.classList.remove('active');
  } finally {
    isDownloading = false;
  }
}

function pollJobStatus(jobId, bar, ovTitle) {
  return new Promise((resolve, reject) => {
    let fakeProgress = 0;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/status?jobId=${jobId}`);
        if (!res.ok) { clearInterval(poll); return reject(new Error(t.fail)); }
        const data = await res.json();

        if (data.status === 'done') {
          clearInterval(poll);
          return resolve();
        }
        if (data.status === 'error') {
          clearInterval(poll);
          return reject(new Error(data.error || t.fail));
        }

        // Use real progress from server if available, otherwise fake it
        let displayProgress = data.progress > 0 ? data.progress : fakeProgress;
        fakeProgress += Math.random() * 5;
        if (fakeProgress > 90) fakeProgress = 90;
        displayProgress = Math.max(displayProgress, fakeProgress);
        if (displayProgress > 99) displayProgress = 99;

        bar.style.width = displayProgress.toFixed(0) + '%';
        ovTitle.textContent = `${t.processing} ${displayProgress.toFixed(0)}%`;
      } catch (err) {
        clearInterval(poll);
        reject(new Error(t.fail));
      }
    }, 1000);
  });
}

function triggerActualDownload() {
  triggerAd();
  if (currentJobId) {
    window.location.href = `/api/file?jobId=${currentJobId}`;
  }
  document.getElementById('dlOverlay').classList.remove('active');
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
