from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import accounts, apm, auth, catalog, runs, settings, workspace, ws

app = FastAPI(title="architecture-agent-ui backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5274", "http://127.0.0.1:5274"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(settings.router)
app.include_router(accounts.router)
app.include_router(apm.router)
app.include_router(catalog.router)
app.include_router(runs.router)
app.include_router(workspace.router)
app.include_router(ws.router)


@app.on_event("shutdown")
def _stop_sidecars() -> None:
    # 백엔드가 내려가면 옆에 띄운 Scouter webapp 도 함께 내린다 — 고아 JVM 을 남기지 않는다.
    from .scouter_webapp import sidecar

    sidecar.stop("백엔드 종료")


@app.get("/api/health")
def health():
    return {"status": "ok"}
