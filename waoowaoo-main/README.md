# AI Video Studio

本目录是当前主工程，基于 `waoowaoo` 代码底座整理为本地自用的 AI 影视生产工作台。

当前目标不是重写底层，也不是融合旧原型，而是先保留 `waoowaoo` 成熟工作流，直接进入真实内容测试。

## 当前保留能力

- 项目、剧集、故事文本管理。
- 角色、别名、角色档案。
- 多套角色外观和参考图。
- 场景库、场景参考图、选中场景图。
- 道具和资产中心。
- 多阶段分镜。
- 面板图候选生成。
- 视频生成。
- 语音和口型同步。
- 任务队列、Worker、失败重试。
- 模型 API 配置。
- 成本估算和使用记录。

## 当前不做

- 不融合旧 Python 原型。
- 不融合 AIComicBuilder。
- 不新增完整项目记忆系统。
- 不新增连续性状态机。
- 不迁入 Review、评分、即梦手动桥。
- 不删除会员和计费代码。

计费默认关闭：

```text
BILLING_MODE=OFF
```

## 本地开发模式

环境要求：

- Node.js 20+
- npm 9+
- Docker Desktop

启动：

```powershell
cd c:\Users\admin\Desktop\aivedio\waoowaoo-main
Copy-Item .env.example .env
npm install
docker compose up mysql redis minio -d
npx prisma db push
npm run dev
```

访问：

```text
http://localhost:3000
```

任务队列面板：

```text
http://localhost:3010/admin/queues
```

## Docker 模式

```powershell
cd c:\Users\admin\Desktop\aivedio\waoowaoo-main
docker compose up -d
```

访问：

```text
http://localhost:13000
```

任务队列面板：

```text
http://localhost:13010/admin/queues
```

## 首次使用顺序

1. 启动服务。
2. 注册或登录本地账号。
3. 进入设置中心配置模型 API Key。
4. 创建一个小型测试项目。
5. 导入 800-2000 字故事或剧本。
6. 检查角色、场景、道具抽取结果。
7. 为主要人物生成或上传参考图。
8. 为主要场景生成或上传参考图。
9. 生成分镜。
10. 生成面板图候选并观察一致性。

## 测试内容准备

测试前按根目录文档准备：

```text
docs/input-checklist.md
```

优先准备一个小项目，不要直接上长片。推荐规模：

```text
2-4 个主要人物
2-3 个主要场景
3-6 个关键道具
8-16 个分镜面板
```

## 验证命令

```powershell
cd c:\Users\admin\Desktop\aivedio\waoowaoo-main
npm run typecheck
npm run build
```

更完整的单元测试：

```powershell
npm run test:unit:all
```
