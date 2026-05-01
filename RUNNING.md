# 跑起来

## 当前主入口

当前主工程是：

```text
c:\Users\admin\Desktop\aivedio\waoowaoo-main
```

根目录旧 Python/Next 原型暂时不作为测试入口。

## 环境要求

- Node.js 20+
- npm 9+
- Docker Desktop

## 本地开发模式

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

## 关键配置

`.env` 中保持：

```text
BILLING_MODE=OFF
```

首次启动后，在设置中心配置模型 API Key。

## 基础验证

```powershell
cd c:\Users\admin\Desktop\aivedio\waoowaoo-main
npm run typecheck
npm run build
```

更完整的测试命令：

```powershell
npm run test:unit:all
```

## 当前不再使用

下面旧命令属于历史原型，不作为当前主线：

```powershell
.\.venv\Scripts\python.exe -m scripts.run_pilot
.\.venv\Scripts\python.exe -m scripts.run_flow_stepwise
cd web
npm run dev
```
