import Link from "next/link";

export default function Home() {
  return (
    <main className="container">
      <h2>欢迎</h2>
      <p className="muted">通用型 AI 视频生成 agent 平台。P0 阶段聚焦非遗纪录片 15 镜 pilot 验证。</p>

      <section className="card" style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>快速上手</h3>
        <ol style={{ lineHeight: 1.8 }}>
          <li>
            <Link href="/projects/new">创建项目</Link>:选择 documentary 方向,写一段 brief。
          </li>
          <li>进入项目页,粘贴或上传非遗资料(文本/md)。</li>
          <li>点"启动 Pipeline",研究 → 编剧 → 分镜 → 质检 顺序执行。</li>
          <li>每步可暂停、查看 progress_note、tool_call、产物。</li>
          <li>分镜阶段产出即梦提示词,用户复制到即梦官网手动生成。</li>
          <li>视频回传后人工评分,质检 Agent 给出重跑建议。</li>
        </ol>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>当前里程碑</h3>
        <ul style={{ lineHeight: 1.8 }}>
          <li>✅ M0 基础设施(后端/前端骨架、数据模型、ModelRouter)</li>
          <li>✅ M1 编排引擎(GraphRun / StepEmitter / SSE)</li>
          <li>✅ M2 4 个 Agent(研究/编剧/分镜/质检)</li>
          <li>✅ M3 前端可视化(可见性三档 / 实时事件流 / 重跑)</li>
          <li>✅ M4 即梦手动桥与资产管理(提示词复制 / 视频回传 / 评分)</li>
          <li>✅ M5 端到端 15 镜 pilot 验证(3 主题 × 15 shot)</li>
          <li>⏳ M6 通用平台完善(P1:多方向、配置热加载、对象存储)</li>
        </ul>
      </section>
    </main>
  );
}
