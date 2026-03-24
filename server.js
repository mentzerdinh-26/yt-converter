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

// Dynamic SEO Pages (Programmatic)
app.get("/:slug", (req, res) => {
    const slug = req.params.slug;
    
    // Ignore static files, api routes, or our generic routes
    if (slug.includes('.') || slug === 'api' || slug === 'scripts' || slug === 'styles') {
        return res.status(404).sendFile(path.join(__dirname, "apps/web/pages", "index.html")); // Fallback
    }

    // Convert slug to keyword: youtube-to-mp3 -> Youtube To Mp3
    const keyword = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    
    const templatePath = path.join(__dirname, "apps/web/pages/seo", "template.html");
    fs.readFile(templatePath, 'utf8', (err, data) => {
        if (err) return res.status(500).send("Error loading SEO template");
        
        // Placeholder content for M1
        const content = `<p>Use SnapYT to download the best ${keyword} videos in HD quality. Fast, free, and secure.</p>`;
        
        const html = data
            .replace(/{{keyword}}/g, keyword)
            .replace(/{{content}}/g, content);
            
        res.send(html);
    });
});


// API Endpoints
const TEMP_DIR = path.join(__dirname, "temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
const ytDlpBinary = path.join(__dirname, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const ytDlp = new YTDlpWrap(ytDlpBinary);

app.post("/api/info", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Missing URL" });
  try {
    const stdout = await ytDlp.execPromise([url, "--dump-json", "--no-playlist", "--no-warnings", "--user-agent", getSRUA()]);
    const info = JSON.parse(stdout);
    const allFormats = info.formats || [];
    const videoFormats = [];
    [2160, 1440, 1080, 720, 480, 360].forEach(h => {
        const m = allFormats.find(f => f.vcodec !== "none" && f.height === h);
        if (m) videoFormats.push({ quality: h, qualityLabel: `${h}p`, filesize: (m.filesize || m.filesize_approx || 0) });
    });
    
    // Fix: Provide a fallback bestAudio if vcodec == none filtering fails due to yt-dlp changes
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

app.get("/api/convert/video", async (req, res) => {
  const { id, quality } = req.query;
  const cached = requestCache.get(id);
  if (!cached) return res.status(404).json({ error: "Expired" });
  
  const jobId = crypto.randomBytes(8).toString("hex");
  const tempOutput = path.join(TEMP_DIR, `${jobId}.mp4`);
  
  const args = [cached.url, "-f", `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${quality}]`, "--merge-output-format", "mp4", "-o", tempOutput, "--no-warnings", "--user-agent", getSRUA()];
  
  ytDlp.exec(args)
    .on('close', (code) => {
       if (fs.existsSync(tempOutput)) {
           activeJobs.set(jobId, { status: "done", file: tempOutput, filename: `${cached.title}.mp4` });
           res.json({ jobId });
       } else {
           res.status(500).json({ error: "Conversion failed. FFmpeg missing or video restricted." });
       }
    })
    .on('error', () => {
       res.status(500).json({ error: "Failed" });
    });
});

app.get("/api/convert/audio", async (req, res) => {
  const { id } = req.query;
  const cached = requestCache.get(id);
  if (!cached) return res.status(404).json({ error: "Expired" });
  
  const jobId = crypto.randomBytes(8).toString("hex");
  const tempOutput = path.join(TEMP_DIR, `${jobId}.mp3`);
  
  const args = [cached.url, "-f", "bestaudio", "-x", "--audio-format", "mp3", "-o", tempOutput, "--no-warnings", "--user-agent", getSRUA()];
  
  ytDlp.exec(args)
    .on('close', (code) => {
       if (fs.existsSync(tempOutput)) {
           activeJobs.set(jobId, { status: "done", file: tempOutput, filename: `${cached.title}.mp3` });
           res.json({ jobId });
       } else {
           res.status(500).json({ error: "Conversion failed. Please try a different video." });
       }
    })
    .on('error', () => {
       res.status(500).json({ error: "Failed" });
    });
});

app.get("/api/file", (req, res) => {
   const job = activeJobs.get(req.query.jobId);
   if (!job || job.status !== 'done') return res.status(404).send("File not ready");
   
   res.download(job.file, job.filename, (err) => {
       try { fs.unlinkSync(job.file); } catch(e){}
       activeJobs.delete(req.query.jobId);
   });
});

app.listen(3000, () => console.log("🚀 Server running at http://localhost:3000"));