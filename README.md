# blog-assets

文章原圖與本機預先產生的 responsive image variants 存放在這個 repo，正式網址是 <https://assets.christorng.idv.tw>。

## 安裝與建置

```powershell
npm install
npm run build
```

建置腳本會：

1. 讀取 `images/` 下的 JPG、PNG 與 WebP 原圖。
2. 將 AVIF/JPEG variants 寫入 `responsive/`。
3. 更新 sibling `christorng.github.io/data/responsive-images.json` manifest。

兩個 repo 的輸出都應一起 commit。若網站 repo 不在預設 sibling 路徑，可設定 `BLOG_REPO` 環境變數，或傳入 `--website-root=<path>`。

## 啟動本機伺服器

```powershell
npm start
```

網站開發環境會讓 `<picture>` 直接使用 `http://localhost:3002`，也會將 `/blog-assets/*` rewrite 到這個伺服器。伺服器固定使用 port `3002`、只監聽本機，並停用快取。
