from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import db
from app.errors import install_error_handlers


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await db.connect()
    yield
    await db.disconnect()


app = FastAPI(title="STRVX Airport Inspection Backend", lifespan=lifespan)
install_error_handlers(app)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
