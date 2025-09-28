from fastapi import FastAPI
from .routers import health
from .config import settings
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title=settings.APP_NAME, version=settings.APP_VERSION)

# Allow extension to call localhost API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "chrome-extension://*","http://127.0.0.1:8000","http://localhost:3000","*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)

@app.get("/")
async def root():
    return {"message": "GuardianCore backend alive"}
