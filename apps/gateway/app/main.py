from __future__ import annotations

import logging
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.router import api_router
from app.core.config import get_settings
from app.core.lifespan import lifespan

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
)


@app.middleware("http")
async def log_requests_middleware(request: Request, call_next):
    logger = logging.getLogger("app.middleware")
    logger.info(f">>> Request: {request.method} {request.url.path}")
    try:
        response = await call_next(request)
        logger.info(f"<<< Response: {response.status_code}")
        return response
    except Exception as exc:
        logger.error(f"!!! Middleware caught exception: {exc}", exc_info=True)
        raise


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logging.error(f"Unhandled exception for {request.method} {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": f"Internal server error: {str(exc)}"},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    logging.error(f"Validation error for {request.method} {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors()},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router)


@app.get("/")
async def root() -> dict[str, str]:
    import datetime
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "docs": "/docs",
        "reload_test": f"Code reloaded at {datetime.datetime.now().isoformat()}",
    }
