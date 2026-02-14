# 測試 `/api/summarize`（POST + curl）

先啟動本機 Worker：

```bash
npm run dev
```

## 用 POST 測試

```bash
curl -X POST "http://127.0.0.1:8787/api/summarize" \
  -H "Content-Type: application/json" \
  -d '{"text":"今天會議重點：第一，確認上線時程。第二，修正 CORS。第三，補上 API 文件。請整理重點。"}'
```

預期回傳（JSON）：

```json
{
  "text": "..."
}
```
