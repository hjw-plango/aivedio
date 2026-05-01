# AI Video Studio

当前主工程是：

```text
waoowaoo-main
```

本项目已经收束为基于 `waoowaoo` 底座的本地自用 AI 影视生产工作台。旧 Python/Next 原型和 `AIComicBuilder-main` 暂时保留为历史参考，不再作为当前测试入口。

## 快速入口

```text
RUNNING.md                 启动方式
STATUS.md                  当前状态
docs/README.md             项目总览
docs/input-checklist.md    测试内容准备清单
waoowaoo-main/README.md    主工程说明
```

## 启动

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
