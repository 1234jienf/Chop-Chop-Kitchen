"""Lightweight GPT guest-review server; does not load Whisper or TensorFlow."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

try:
    from .review_api import router as review_router
except ImportError:
    from review_api import router as review_router


app = FastAPI(title="Chop-Chop Kitchen Review API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://127.0.0.1:8080"],
    allow_credentials=True,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)
app.include_router(review_router)


@app.get("/health")
async def health():
    return {"ok": True, "service": "guest-review"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
