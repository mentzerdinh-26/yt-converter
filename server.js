const express = require("express");
const YTDlpWrap = require("yt-dlp-wrap").default;
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

const app = express();
app.set('trust proxy', 1); // Bắt buộc khi chạy sau Cloudflare Tunnel

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 200, 
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." }
});
app.use("/api/", limiter);

const requestCache = new Map();
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
];
function getSRUA() { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]; }

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/scripts", express.static(path.join(__dirname, "apps/web/scripts")));
app.use("/styles", express.static(path.join(__dirname, "apps/web/styles")));

// --- ROUTES ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'apps/web/pages', 'index.html')));
app.get('/en', (req, res) => res.sendFile(path.join(__dirname, 'apps/web/pages', 'index.html')));
app.get('/youtube-to-mp4', (req, res) => res.sendFile(path.join(__dirname, 'apps/web/pages/tool', 'youtube-to-mp4.html')));
app.get('/youtube-to-mp3', (req, res) => res.sendFile(path.join(__dirname, 'apps/web/pages/tool', 'youtube-to-mp3.html')));
app.get("/vi", (req, res) => res.sendFile(path.join(__dirname, "apps/web/pages", "index_vi.html")));

// New Informational Pages
app.get("/about", (req, res) => res.sendFile(path.join(__dirname, "apps/web/pages", "about.html")));
app.get("/contact", (req, res) => res.sendFile(path.join(__dirname, "apps/web/pages", "contact.html")));
app.get("/terms", (req, res) => res.sendFile(path.join(__dirname, "apps/web/pages", "terms.html")));
app.get("/privacy", (req, res) => res.sendFile(path.join(__dirname, "apps/web/pages", "privacy.html")));

// Load keyword database for SEO pages
const keywords = require("./data/keywords.json");
const keywordMap = new Map(keywords.map(k => [k.slug, k.keyword]));

// Dynamic SEO Pages (Programmatic)
app.get("/:slug", (req, res) => {
    const slug = req.params.slug;

    // Ignore static files, api routes, or our generic routes
    if (slug.includes('.') || slug === 'api' || slug === 'scripts' || slug === 'styles') {
        return res.status(404).sendFile(path.join(__dirname, "apps/web/pages", "index.html"));
    }

    // Use keyword from database, fallback to slug conversion
    const keyword = keywordMap.get(slug) || slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const keywordLower = keyword.toLowerCase();

    const templatePath = path.join(__dirname, "apps/web/pages/seo", "template.html");
    fs.readFile(templatePath, 'utf8', (err, data) => {
        if (err) return res.status(500).send("Error loading SEO template");

        // Generate SEO content paragraphs
        const content = `
          <p>Looking for the best way to <strong>${keywordLower}</strong>? SnapYT is your go-to tool for downloading YouTube videos in MP4 and MP3 formats. Our free online converter makes it easy to save any YouTube video in HD quality — no software installation required.</p>
          <p>Whether you need ${keywordLower} on your phone, tablet, or computer, SnapYT works seamlessly across all devices and browsers. Simply paste a YouTube URL, choose your preferred format and quality, and download instantly.</p>
          <p>SnapYT supports resolutions up to 4K for video and up to 320kbps for MP3 audio. All conversions are fast, secure, and completely free with no limits on the number of downloads.</p>`;

        // Generate internal links to related pages
        const relatedPages = keywords
          .filter(k => k.slug !== slug)
          .sort(() => Math.random() - 0.5)
          .slice(0, 5);
        const internalLinks = `<div style="margin-top: 40px; padding: 20px; border: 1px solid var(--border); border-radius: 10px;">
          <h3>Related Tools</h3>
          ${relatedPages.map(k => `<a href="/${k.slug}" style="display: inline-block; margin: 5px 10px 5px 0; color: var(--accent); text-decoration: none;">${k.keyword}</a>`).join('')}
          <br><a href="/" style="margin-top: 10px; display: inline-block; color: var(--accent); text-decoration: none;">Back to Homepage</a>
        </div>`;

        const html = data
            .replace(/{{keyword}}/g, keyword)
            .replace(/{{keyword_lower}}/g, keywordLower)
            .replace(/{{slug}}/g, slug)
            .replace(/{{content}}/g, content)
            .replace(/{{internal_links}}/g, internalLinks);

        res.send(html);
    });
});


// API Endpoints
const TEMP_DIR = path.join(__dirname, "temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Use system yt-dlp if available, fallback to local binary
const { execSync } = require("child_process");
let ytDlpBinary;
try {
  ytDlpBinary = execSync("which yt-dlp", { encoding: "utf8" }).trim();
} catch {
  ytDlpBinary = path.join(__dirname, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
}
const ytDlp = new YTDlpWrap(ytDlpBinary);

// Detect system ffmpeg location for yt-dlp
let ffmpegDir = "";
try {
  const ffmpegPath = execSync("which ffmpeg", { encoding: "utf8" }).trim();
  ffmpegDir = path.dirname(ffmpegPath);
} catch {}

app.post("/api/info", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Missing URL" });
  try {
    const args = [url, "--dump-json", "--no-playlist", "--no-warnings", "--user-agent", getSRUA()];
    if (ffmpegDir) args.push("--ffmpeg-location", ffmpegDir);
    const stdout = await ytDlp.execPromise(args);
    const info = JSON.parse(stdout);
    const allFormats = info.formats || [];
    const videoFormats = [];
    [2160, 1440, 1080, 720, 480, 360].forEach(h => {
        const m = allFormats.find(f => f.vcodec !== "none" && f.height === h);
        if (m) videoFormats.push({ quality: h, qualityLabel: `${h}p`, filesize: (m.filesize || m.filesize_approx || 0) });
    });

    let bestAudio = allFormats.filter(f => f.acodec !== "none" && f.vcodec === "none").sort((a,b) => (b.abr||0)-(a.abr||0))[0];
    if (!bestAudio && allFormats.some(f => f.acodec !== "none")) {
        bestAudio = { quality: 'bestaudio', abr: 128 };
    }

    const requestId = crypto.randomBytes(16).toString("hex");
    requestCache.set(requestId, { url, title: info.title });
    res.json({ requestId, title: info.title, author: info.uploader, duration: info.duration, thumbnail: info.thumbnail, videoFormats, audioInfo: bestAudio });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const activeJobs = new Map();

// Helper: sanitize filename for safe downloads
function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').substring(0, 200);
}

// Helper: find the actual output file (yt-dlp may alter extensions)
function findOutputFile(basePath, ext) {
  if (fs.existsSync(basePath)) return basePath;
  // Check for common yt-dlp output variations
  const dir = path.dirname(basePath);
  const base = path.basename(basePath, ext);
  const candidates = [
    basePath,
    path.join(dir, base + ext),
    path.join(dir, base + ".mkv"),
    path.join(dir, base + ".webm"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Glob fallback: find any file matching the jobId prefix
  try {
    const files = fs.readdirSync(dir).filter(f => f.startsWith(base));
    if (files.length > 0) return path.join(dir, files[0]);
  } catch {}
  return null;
}

// Async convert: returns jobId immediately, processes in background
app.get("/api/convert/video", (req, res) => {
  const { id, quality } = req.query;
  const cached = requestCache.get(id);
  if (!cached) return res.status(404).json({ error: "Expired" });

  const jobId = crypto.randomBytes(8).toString("hex");
  const tempOutput = path.join(TEMP_DIR, `${jobId}.mp4`);

  // Return jobId immediately so client can poll
  activeJobs.set(jobId, { status: "processing", file: null, filename: `${sanitizeFilename(cached.title)}.mp4` });
  res.json({ jobId });

  const args = [cached.url, "-f", `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]`, "--merge-output-format", "mp4", "-o", tempOutput, "--no-warnings", "--user-agent", getSRUA()];
  if (ffmpegDir) args.push("--ffmpeg-location", ffmpegDir);

  const proc = ytDlp.exec(args);

  // Parse progress from yt-dlp stderr
  let lastProgress = 0;
  proc.on('progress', (progress) => {
    if (progress && progress.percent) {
      lastProgress = Math.min(progress.percent, 99);
      const job = activeJobs.get(jobId);
      if (job) job.progress = lastProgress;
    }
  });

  proc.on('close', (code) => {
    const actualFile = findOutputFile(tempOutput, ".mp4");
    if (actualFile) {
      activeJobs.set(jobId, { status: "done", file: actualFile, filename: `${sanitizeFilename(cached.title)}.mp4`, progress: 100 });
    } else {
      activeJobs.set(jobId, { status: "error", error: "Conversion failed. FFmpeg missing or video restricted.", progress: 0 });
    }
  });

  proc.on('error', (err) => {
    activeJobs.set(jobId, { status: "error", error: err.message || "Failed", progress: 0 });
  });
});

app.get("/api/convert/audio", (req, res) => {
  const { id } = req.query;
  const cached = requestCache.get(id);
  if (!cached) return res.status(404).json({ error: "Expired" });

  const jobId = crypto.randomBytes(8).toString("hex");
  const tempOutput = path.join(TEMP_DIR, `${jobId}.mp3`);

  // Return jobId immediately
  activeJobs.set(jobId, { status: "processing", file: null, filename: `${sanitizeFilename(cached.title)}.mp3` });
  res.json({ jobId });

  const args = [cached.url, "-f", "bestaudio", "-x", "--audio-format", "mp3", "-o", tempOutput, "--no-warnings", "--user-agent", getSRUA()];
  if (ffmpegDir) args.push("--ffmpeg-location", ffmpegDir);

  const proc = ytDlp.exec(args);

  let lastProgress = 0;
  proc.on('progress', (progress) => {
    if (progress && progress.percent) {
      lastProgress = Math.min(progress.percent, 99);
      const job = activeJobs.get(jobId);
      if (job) job.progress = lastProgress;
    }
  });

  proc.on('close', (code) => {
    const actualFile = findOutputFile(tempOutput, ".mp3");
    if (actualFile) {
      activeJobs.set(jobId, { status: "done", file: actualFile, filename: `${sanitizeFilename(cached.title)}.mp3`, progress: 100 });
    } else {
      activeJobs.set(jobId, { status: "error", error: "Conversion failed. Please try a different video.", progress: 0 });
    }
  });

  proc.on('error', (err) => {
    activeJobs.set(jobId, { status: "error", error: err.message || "Failed", progress: 0 });
  });
});

// Polling endpoint for job status
app.get("/api/status", (req, res) => {
  const job = activeJobs.get(req.query.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({ status: job.status, progress: job.progress || 0, error: job.error || null });
});

app.get("/api/file", (req, res) => {
   const job = activeJobs.get(req.query.jobId);
   if (!job || job.status !== 'done') return res.status(404).send("File not ready");

   res.download(job.file, job.filename, (err) => {
       try { fs.unlinkSync(job.file); } catch(e){}
       activeJobs.delete(req.query.jobId);
   });
});

// Cleanup stale jobs every 10 minutes
setInterval(() => {
  for (const [jobId, job] of activeJobs) {
    if (job.status === "done" || job.status === "error") {
      if (job.file) try { fs.unlinkSync(job.file); } catch(e){}
      activeJobs.delete(jobId);
    }
  }
}, 10 * 60 * 1000);

app.listen(3000, () => console.log("🚀 Server running at http://localhost:3000"));