import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // LINE webhook 需要原始 body 做簽章驗證；route handler 內用 req.text() 取得。

  // dev 與 build 共用 .next 時，build 會蓋掉 dev 正在服務的 chunks，
  // 開著的頁面當場炸「Cannot find module './xxx.js'」。開發時要驗 build
  // 請跑 pnpm build:check（落在 .next-build）；pnpm build 維持預設，
  // Vercel 那邊才不會因為非標準 distDir 出意外。
  distDir: process.env.NEXT_DIST_DIR || ".next",

  // Chromium 那包裡是壓縮過的瀏覽器二進位檔，不能讓打包器去解析它——
  // 標成 external，執行時直接從 node_modules 讀（PDF 匯出用，見 lib/pdf.ts）。
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],

  // 光是 external 還不夠：bin/ 裡那幾包（chromium.br 等）是執行時用路徑讀的，
  // Next 的檔案追蹤靜態分析看不到，部署上去就少了那個目錄，Chromium 起不來
  // （2026-08-23 正式站實測：500，"The input directory .../bin does not exist"）。
  // 只掛在兩支匯出路由上——70MB 不該進每一個函式。
  // 路徑只能寫 .pnpm 底下的「真身」：node_modules/@sparticuz/chromium 是 symlink，
  // 把它一起收進來 Vercel 會拒收整個部署（2026-08-23 實測：
  // "The framework produced an invalid deployment package ... symlinked directories"）。
  outputFileTracingIncludes: {
    "/api/m/[id]/export": [
      "./node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**",
    ],
    "/api/s/[token]/export": [
      "./node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**",
    ],
  },
};

export default nextConfig;
