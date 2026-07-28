from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import catalog, config, runs, ws

app = FastAPI(title="architecture-agent-ui backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(catalog.router)
app.include_router(config.router)
app.include_router(runs.router)
app.include_router(ws.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
