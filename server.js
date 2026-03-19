const express = require("express");
const YTDlpWrap = require("yt-dlp-wrap").default;
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Thư mục tạm để lưu video đã merge
const TEMP_DIR = path.join(__dirname, "temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Đường dẫn yt-dlp binary
const ytDlpBinary = path.join(__dirname, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const ytDlp = new YTDlpWrap(ytDlpBinary);

// Tự động tải yt-dlp nếu chưa có
async function ensureYtDlp() {
  if (!fs.existsSync(ytDlpBinary)) {
    console.log("⏬ Đang tải yt-dlp binary tự động...");
    await YTDlpWrap.downloadFromGithub(ytDlpBinary);
    console.log("✅ Đã tải yt-dlp xong!");
  } else {
    console.log("✅ yt-dlp đã sẵn sàng!");
  }
}

// Helper: Lấy video info (dùng execPromise + --dump-json để không bị treo)
async function getVideoInfo(url) {
  console.log("📡 Đang lấy info cho:", url);
  const stdout = await ytDlp.execPromise([
    url,
    "--dump-json",
    "--no-playlist",
    "--no-warnings",
  ]);
  console.log("✅ Đã nhận JSON.");
  return JSON.parse(stdout);
}

// Helper: Chạy yt-dlp download ra file tạm và trả về đường dẫn file
function downloadToTempFile(args) {
  return new Promise((resolve, reject) => {
    execFile(ytDlpBinary, args, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) {
        console.error("yt-dlp stderr:", stderr);
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// Dọn dẹp file tạm cũ hơn 10 phút (chạy mỗi 5 phút)
function cleanupTempFiles() {
  try {
    const files = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > 10 * 60 * 1000) {
        fs.unlinkSync(filePath);
        console.log("🧹 Đã xóa file tạm:", file);
      }
    }
  } catch (e) { /* ignore */ }
}
setInterval(cleanupTempFiles, 5 * 60 * 1000);

// ─── GET VIDEO INFO ───────────────────────────────────────────────────────────
app.post("/api/info", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Thiếu URL" });

  try {
    const info = await getVideoInfo(url);
    const allFormats = info.formats || [];

    // === VIDEO: lọc các quality level phổ biến ===
    const qualityLevels = [2160, 1440, 1080, 720, 480, 360];
    const videoFormats = [];

    for (const height of qualityLevels) {
      const match = allFormats.find(
        (f) => f.vcodec !== "none" && f.height === height
      );
      if (match) {
        const bestAudio = allFormats
          .filter((f) => f.acodec !== "none" && f.vcodec === "none")
          .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

        const videoSize = match.filesize || match.filesize_approx || 0;
        const audioSize = bestAudio
          ? bestAudio.filesize || bestAudio.filesize_approx || 0
          : 0;

        videoFormats.push({
          quality: height,
          qualityLabel: `${height}p`,
          filesize: videoSize + audioSize || null,
        });
      }
    }

    // === AUDIO: lấy best audio ===
    const bestAudio = allFormats
      .filter((f) => f.acodec !== "none" && f.vcodec === "none")
      .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

    const audioInfo = bestAudio
      ? {
          abr: bestAudio.abr,
          ext: bestAudio.ext,
          filesize: bestAudio.filesize || bestAudio.filesize_approx || null,
        }
      : null;

    res.json({
      title: info.title,
      author: info.uploader || info.channel,
      duration: info.duration,
      thumbnail: info.thumbnail,
      videoFormats,
      audioInfo,
    });
  } catch (err) {
    console.error("❌ Lỗi getInfo:", err.message);
    res
      .status(500)
      .json({ error: "Không lấy được thông tin video: " + err.message });
  }
});

// ─── DOWNLOAD VIDEO (MP4) ─────────────────────────────────────────────────────
// Tải xuống file tạm trước để ffmpeg merge video+audio, rồi gửi cho client
app.get("/api/download/video", async (req, res) => {
  const { url, quality, title } = req.query;
  if (!url) return res.status(400).json({ error: "Thiếu URL" });

  const safeTitle = (title || "video").replace(/[<>:"/\\|?*]/g, "").trim();
  const q = parseInt(quality) || 720;
  const tempId = crypto.randomBytes(8).toString("hex");
  const tempOutput = path.join(TEMP_DIR, `${tempId}.mp4`);

  try {
    console.log(`📥 Tải video ${q}p (merge vào file tạm):`, url);

    // Tải video+audio merge thành mp4 ra file tạm
    const args = [
      url,
      "-f",
      `bestvideo[height<=${q}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${q}]+bestaudio/best[height<=${q}]`,
      "--merge-output-format",
      "mp4",
      "-o",
      tempOutput,
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
    ];

    await downloadToTempFile(args);

    // Kiểm tra file tạm có tồn tại
    if (!fs.existsSync(tempOutput)) {
      return res.status(500).json({ error: "Không thể tải video" });
    }

    const stat = fs.statSync(tempOutput);

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeTitle} (${q}p).mp4"`
    );
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", stat.size);

    // Stream file tạm cho client
    const fileStream = fs.createReadStream(tempOutput);
    fileStream.pipe(res);

    // Xóa file tạm sau khi gửi xong
    fileStream.on("end", () => {
      fs.unlink(tempOutput, () => {
        console.log("🧹 Đã xóa file tạm:", tempId);
      });
    });

    fileStream.on("error", (err) => {
      console.error("File stream error:", err.message);
      fs.unlink(tempOutput, () => {});
      if (!res.headersSent) res.status(500).end();
    });

    req.on("close", () => {
      fileStream.destroy();
      // Xóa file tạm nếu client ngắt kết nối
      setTimeout(() => {
        fs.unlink(tempOutput, () => {});
      }, 1000);
    });
  } catch (err) {
    console.error("❌ Lỗi download video:", err.message);
    // Dọn file tạm nếu lỗi
    fs.unlink(tempOutput, () => {});
    if (!res.headersSent) {
      res.status(500).json({ error: "Lỗi tải video: " + err.message });
    }
  }
});

// ─── DOWNLOAD AUDIO (MP3) ────────────────────────────────────────────────────
// MP3 cần ffmpeg convert nên dùng file tạm
app.get("/api/download/audio", async (req, res) => {
  const { url, title } = req.query;
  if (!url) return res.status(400).json({ error: "Thiếu URL" });

  const safeTitle = (title || "audio").replace(/[<>:"/\\|?*]/g, "").trim();
  const tempId = crypto.randomBytes(8).toString("hex");
  const tempOutput = path.join(TEMP_DIR, `${tempId}.mp3`);

  try {
    console.log("🎵 Tải audio MP3:", url);

    const args = [
      url,
      "-f",
      "bestaudio",
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
      "-o",
      tempOutput,
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
    ];

    await downloadToTempFile(args);

    if (!fs.existsSync(tempOutput)) {
      return res.status(500).json({ error: "Không thể tải audio" });
    }

    const stat = fs.statSync(tempOutput);

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeTitle}.mp3"`
    );
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", stat.size);

    const fileStream = fs.createReadStream(tempOutput);
    fileStream.pipe(res);

    fileStream.on("end", () => {
      fs.unlink(tempOutput, () => {
        console.log("🧹 Đã xóa file tạm audio:", tempId);
      });
    });

    fileStream.on("error", (err) => {
      console.error("File stream error:", err.message);
      fs.unlink(tempOutput, () => {});
      if (!res.headersSent) res.status(500).end();
    });

    req.on("close", () => {
      fileStream.destroy();
      setTimeout(() => {
        fs.unlink(tempOutput, () => {});
      }, 1000);
    });
  } catch (err) {
    console.error("❌ Lỗi download audio:", err.message);
    fs.unlink(tempOutput, () => {});
    if (!res.headersSent) {
      res.status(500).json({ error: "Lỗi tải audio: " + err.message });
    }
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

ensureYtDlp()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Không thể tải yt-dlp:", err.message);
    process.exit(1);
  });