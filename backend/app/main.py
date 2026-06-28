from fastapi import FastAPI

app = FastAPI(title="STRVX Airport Inspection Backend")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
