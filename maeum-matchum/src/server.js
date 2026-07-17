import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrate } from "./db/index.js";
import { api } from "./routes/api.js";
import { aiInfo } from "./services/aiClient.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

migrate();

const app = express();
app.use(express.json({ limit: "1mb" }));

// API
app.use("/api", api);

// 정적 프론트엔드
app.use(express.static(join(__dirname, "..", "public")));

// SPA 폴백
app.get("*", (_req, res) => {
  res.sendFile(join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, () => {
  const info = aiInfo();
  console.log("\n💗 마음맞춤 서버 실행 중");
  console.log(`   → http://localhost:${PORT}`);
  console.log(`   AI 모델: ${info.model} (${info.disabled ? "비활성" : info.baseUrl})`);
  console.log("   AI 서버 미연결 시 규칙 엔진으로 자동 폴백됩니다.\n");
});
