import re

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

_NOT_FOUND = re.compile(r"not found", re.IGNORECASE)


class AppError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_req: Request, exc: AppError):
        status = 404 if _NOT_FOUND.search(exc.message) else 400
        return JSONResponse({"error": exc.message}, status_code=status)

    @app.exception_handler(Exception)
    async def _unhandled(_req: Request, exc: Exception):
        # Never leak DB/internal details (mirrors http.ts isInternalError → 500).
        return JSONResponse({"error": "Internal error"}, status_code=500)
