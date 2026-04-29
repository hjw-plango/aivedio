import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "aivedio",
  description: "AI 视频生成 agent 平台 · 非遗纪录片 pilot",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>
        <header className="app-header">
          <h1>
            <Link href="/" style={{ color: "inherit" }}>
              aivedio
            </Link>
          </h1>
          <span className="tag">P0 · 非遗 pilot</span>
          <nav>
            <Link href="/projects">项目</Link>
            <Link href="/runs">流水线</Link>
            <a href="/health" target="_blank">
              健康检查
            </a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
