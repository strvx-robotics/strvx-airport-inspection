import logging
import re

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("app.errors")

_NOT_FOUND = re.compile(r"not found", re.IGNORECASE)


class AppError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.message = message
        # Optional explicit HTTP status. When None, the handler infers 404 for
        # "not found" messages and 400 otherwise. Set it when that inference is
        # wrong — e.g. an invalid id in a POST body is a 400 validation error
        # even though the message reads "… not found".
        self.status = status


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_req: Request, exc: AppError):
        status = exc.status or (404 if _NOT_FOUND.search(exc.message) else 400)
        return JSONResponse({"error": exc.message}, status_code=status)

    @app.exception_handler(Exception)
    async def _unhandled(_req: Request, exc: Exception):
        # Never leak DB/internal details (mirrors http.ts isInternalError → 500).
        logger.exception("[api] unhandled error: %r", exc)
        return JSONResponse({"error": "Internal error"}, status_code=500)
