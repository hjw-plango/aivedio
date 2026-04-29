import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: 32, maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 8 }}>aivedio</h1>
      <p style={{ marginTop: 0, opacity: 0.7 }}>
        通用型 AI 视频生成 agent 平台 · P0 非遗纪录片 pilot
      </p>
      <ul style={{ lineHeight: 2 }}>
        <li>
          <Link href="/projects">项目列表</Link>
        </li>
        <li>
          <a href="/health">后端健康检查</a>
        </li>
      </ul>
      <p style={{ opacity: 0.6, fontSize: 14 }}>
        M0 骨架 — pipeline / assets / 微调配置后续里程碑接入。
      </p>
    </main>
  );
}
