import Link from "next/link";

export default function Home() {
  return (
    <main className="container">
      <h2>欢迎</h2>
      <p className="muted">通用型 AI 视频生成 agent 平台。当前 P0 聚焦长纪录片最小可用闭环：完整大纲、章节计划、项目记忆、参考图提示词、第一章连续分镜与即梦提示词。</p>

      <section className="card" style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>快速上手</h3>
        <ol style={{ lineHeight: 1.8 }}>
          <li>
            <Link href="/projects/new">创建项目</Link>:选择 documentary 方向,写一段 brief。
          </li>
          <li>进入项目页,粘贴或上传非遗资料(文本/md)。</li>
          <li>点"启动 Pipeline",研究 → 编剧 → 记忆 → 分镜 → 质检 顺序执行。</li>
          <li>先到"项目记忆/参考图"复制主体、环境、物品和状态参考图提示词。</li>
          <li>再到"分镜与即梦桥"复制第一章每个镜头的即梦提示词。</li>
          <li>视频回传后人工评分,质检 Agent 给出重跑建议。</li>
        </ol>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>当前里程碑</h3>
        <ul style={{ lineHeight: 1.8 }}>
          <li>✅ M0 基础设施(后端/前端骨架、数据模型、ModelRouter)</li>
          <li>✅ M1 编排引擎(GraphRun / StepEmitter / SSE)</li>
          <li>✅ M2 5 个 Agent(研究/编剧/记忆/分镜/质检)</li>
          <li>✅ M3 前端可视化(可见性三档 / 实时事件流 / 重跑)</li>
          <li>✅ M4 即梦手动桥与资产管理(提示词复制 / 视频回传 / 评分)</li>
          <li>✅ M5 重做为长纪录片第一章生产链路(18 镜头 / 约 3 分钟)</li>
          <li>⏳ M6 扩展为全片逐章生成、参考图实图回填、剪辑导出</li>
        </ul>
      </section>
    </main>
  );
}
