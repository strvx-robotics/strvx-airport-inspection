# STRVX Airport Inspection Frontend

Next.js App Router frontend and BFF for the runway inspection app.

Use the root `README.md` for full local setup. Use `frontend/docs.md` for
frontend-specific routes, env vars, data flow, and remaining BFF-owned routes.

Quick start:

```bash
npm install
npm run db:setup
npm run db:bootstrap
npm run dev
```

Required local env:

```bash
DATABASE_URL=postgresql://postgres:strvx@localhost:54432/strvx
BACKEND_URL=http://localhost:8080
```
