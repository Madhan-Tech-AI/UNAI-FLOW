from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import auth, automations, connections
import os

app = FastAPI(title="UNAI Flow API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(automations.router)
app.include_router(connections.router)

@app.get("/health")
def health_check():
    return {"status": "ok"}
