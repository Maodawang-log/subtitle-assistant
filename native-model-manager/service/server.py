"""Loopback-only OpenAI-compatible multilingual ASR with a cancellable GPU worker."""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import multiprocessing as mp
import os
from pathlib import Path
import sys
import tempfile
import time
import uuid

BASE = Path(os.environ.get("LOCAL_ASR_BASE", Path(__file__).resolve().parent)).resolve()
for name in ("cache", "logs", "models", "cache/tmp"):
    (BASE / name).mkdir(parents=True, exist_ok=True)
os.environ["HF_HOME"] = str(BASE / "cache/huggingface")
os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TMP"] = os.environ["TEMP"] = str(BASE / "cache/tmp")
tempfile.tempdir = str(BASE / "cache/tmp")

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from starlette.datastructures import UploadFile

SETTINGS = BASE / "settings.json"
CONFIG = json.loads(SETTINGS.read_text(encoding="utf-8")) if SETTINGS.exists() else {}
MANAGER_CONFIG = os.environ.get("LOCAL_ASR_MANAGER_CONFIG")
if MANAGER_CONFIG:
    CONFIG.update(json.loads(Path(MANAGER_CONFIG).read_text(encoding="utf-8")))
MANAGER_INSTANCE = os.environ.get("LOCAL_ASR_MANAGER_INSTANCE", "")
OTHER_CONSUMER_AT = 0.0
MODEL_ID = CONFIG.get("default_model", "small")
MODEL_DIRS = {name: Path(value) for name, value in CONFIG.get("model_dirs", {}).items()} or {name: BASE / f"models/faster-whisper-{name}" for name in ("small", "medium")}
MODEL_DIR = MODEL_DIRS[MODEL_ID]
MAX_BODY = 16 * 1024 * 1024
MAX_DURATION = 60.0
PORT = int(os.environ.get("LOCAL_ASR_PORT", "18766"))
LOG = logging.getLogger("local-asr")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    handlers=[logging.StreamHandler(), logging.FileHandler(BASE / "logs/service.log", encoding="utf-8")])


def dll_paths():
    """Use only this venv's NVIDIA DLLs, without changing system PATH."""
    handles = []
    root = Path(sys.prefix) / "Lib/site-packages/nvidia"
    paths = [p for p in root.glob("*/*") if p.name in {"bin", "lib"} and p.is_dir()]
    os.environ["PATH"] = os.pathsep.join(map(str, paths)) + os.pathsep + os.environ.get("PATH", "")
    if hasattr(os, "add_dll_directory"):
        handles = [os.add_dll_directory(str(p)) for p in paths]
    return handles


def bounded_decode(path):
    """Decode at most 60 s; bound decompressed audio as well as the upload."""
    import av
    import numpy as np
    samples, total = [], 0
    with av.open(path, metadata_errors="ignore") as container:
        if not container.streams.audio:
            raise ValueError("The upload has no audio stream")
        resampler = av.audio.resampler.AudioResampler(format="fltp", layout="mono", rate=16000)
        for frame in container.decode(audio=0):
            for output in resampler.resample(frame):
                data = output.to_ndarray().reshape(-1)
                total += len(data)
                if total > int((MAX_DURATION + .02) * 16000):
                    raise ValueError("Audio is longer than 60 seconds; use 30-second chunks")
                samples.append(data)
        for output in resampler.resample(None):
            data = output.to_ndarray().reshape(-1)
            total += len(data)
            if total > int((MAX_DURATION + .02) * 16000):
                raise ValueError("Audio is longer than 60 seconds; use 30-second chunks")
            samples.append(data)
    if total == 0:
        raise ValueError("The upload contains no decoded audio")
    return np.concatenate(samples).astype(np.float32, copy=False)


def load_model(device, model_id):
    from faster_whisper import WhisperModel
    compute_type = CONFIG.get("compute_types", {}).get(model_id, "int8_float16") if device == "cuda" else "int8"
    model = WhisperModel(str(MODEL_DIRS[model_id]), device=device, compute_type=compute_type,
                         cpu_threads=6, num_workers=1, local_files_only=True)
    # Loading a model does not exercise cuDNN. Warm it with an actual 1s decode.
    import numpy as np
    chunks, _ = model.transcribe(np.zeros(16000, dtype=np.float32), language="ja" if "ja" in model.supported_languages else "en", task="transcribe", beam_size=1,
                                vad_filter=False, condition_on_previous_text=False)
    list(chunks)
    return model, compute_type


def sentence_segments(chunk, duration):
    """Whisper can group multiple sentences; align shorter cues to word timing."""
    import re
    words = [{"start": round(max(0., min(w.start, duration)), 3),
              "end": round(max(0., min(w.end, duration)), 3), "word": w.word,
              "probability": round(w.probability, 4)} for w in (chunk.words or [])]
    if not words:
        start, end = max(0., chunk.start), min(duration, chunk.end)
        return [{"start": round(start, 3), "end": round(end, 3), "text": chunk.text.strip(), "words": []}] if end > start and chunk.text.strip() else []
    result, group = [], []

    def emit():
        if group:
            text = "".join(w["word"] for w in group).strip()
            if text and group[-1]["end"] > group[0]["start"]:
                result.append({"start": group[0]["start"], "end": group[-1]["end"], "text": text, "words": list(group)})
            group.clear()

    for word in words:
        if group and word["start"] - group[-1]["end"] >= .8:
            emit()
        group.append(word)
        if re.search(r"[。！？!?][\s」』）)]*$", word["word"]) or word["end"] - group[0]["start"] >= 7:
            emit()
    emit()
    return result


def gpu_worker(pipe, preferred, model_id):
    dll_handles = dll_paths()
    fallback = None
    try:
        device = preferred
        try:
            model, compute = load_model(device, model_id)
        except Exception as exc:
            if device == "cpu":
                raise
            fallback = f"CUDA failed; CPU fallback: {type(exc).__name__}: {exc}"
            LOG.warning(fallback)
            device = "cpu"
            model, compute = load_model(device, model_id)
        pipe.send({"kind": "ready", "model": model_id, "device": device, "compute_type": compute, "fallback": fallback})
        while True:
            job = pipe.recv()
            if job is None:
                break
            started = time.perf_counter()
            try:
                if job["language"] is not None and job["language"] not in model.supported_languages:
                    raise ValueError("The selected model does not support the requested language")
                download = None
                if job.get("window"):
                    from window_audio import decode_window
                    audio, download = decode_window(job["urls"], job["start"], job["duration"])
                else:
                    audio = bounded_decode(job["path"])
                duration = len(audio) / 16000
                chunks, info = model.transcribe(
                    audio, language=job["language"], task="transcribe", beam_size=5,
                    temperature=0, vad_filter=True,
                    vad_parameters={"min_silence_duration_ms": 300, "speech_pad_ms": 200},
                    word_timestamps=True, condition_on_previous_text=False,
                )
                segments = []
                for chunk in chunks:
                    for cue in sentence_segments(chunk, duration):
                        segments.append({"id": len(segments), **cue})
                opening = None
                if job.get("window"):
                    from opening_repair import repair_opening
                    segments, opening = repair_opening(model, audio, job["language"], segments, sentence_segments, window_start=job["start"])
                    segments = [{**cue, "id": i} for i, cue in enumerate(segments)]
                result = {
                    "task": "transcribe", "language": info.language, "duration": round(duration, 3),
                    "text": (" " if info.language == "en" else "").join(s["text"] for s in segments), "segments": segments,
                    "model": model_id, "device": device, "compute_type": compute,
                    "processing_seconds": round(time.perf_counter() - started, 3),
                }
                if job.get("window"):
                    offset = job["start"]
                    for item in segments:
                        item["start"] = round(item["start"] + offset, 3)
                        item["end"] = round(item["end"] + offset, 3)
                        for word in item["words"]:
                            word["start"] = round(word["start"] + offset, 3)
                            word["end"] = round(word["end"] + offset, 3)
                    result.update(timestamp_origin="absolute", start=offset,
                                  requested_duration=job["duration"], request_id=job["request_id"], download=download, opening_repair=opening)
                pipe.send({"kind": "result", "result": result})
            except ValueError as exc:
                pipe.send({"kind": "error", "status": 400, "message": str(exc)})
            except Exception as exc:
                LOG.exception("ASR failed")
                pipe.send({"kind": "error", "status": 500,
                           "message": f"{type(exc).__name__}: {exc}"})
    except Exception as exc:
        LOG.exception("Worker startup failed")
        with contextlib.suppress(Exception):
            pipe.send({"kind": "error", "status": 503, "message": f"{type(exc).__name__}: {exc}"})
    finally:
        pipe.close()


class ClientGone(Exception):
    pass


class EngineError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class Engine:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.proc = self.pipe = None
        self.backend = None
        self.active = None
        self.completed = self.cancelled = self.started = 0
        self.queue = 0
        self.requests = {}
        self.last_backend = None
        self.cancelled_ids = {}

    def stop(self):
        # Terminate precisely the worker created by this service. Native GPU calls
        # cannot be cancelled safely by cancelling a Python thread.
        if self.proc:
            if self.proc.is_alive():
                self.proc.terminate()
            self.proc.join(timeout=5)
            if self.proc.is_alive():
                self.proc.kill()
                self.proc.join(timeout=2)
            self.proc.close()
        if self.pipe:
            self.pipe.close()
        self.proc = self.pipe = None
        self.backend = None

    async def receive(self, request=None, timeout=120, cancel=None):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if (cancel and cancel.is_set()) or (request is not None and await request.is_disconnected()):
                raise ClientGone()
            if self.pipe.poll():
                try:
                    return self.pipe.recv()
                except EOFError:
                    raise EngineError(503, "ASR worker exited unexpectedly; retry the request")
            if not self.proc.is_alive():
                raise EngineError(503, f"ASR worker exited ({self.proc.exitcode}); see logs")
            await asyncio.sleep(.05)
        raise EngineError(504, "ASR worker timed out")

    async def ensure(self, request=None, cancel=None, model_id=MODEL_ID):
        if self.proc and self.proc.is_alive() and self.backend and self.backend.get("model") == model_id:
            return
        await asyncio.to_thread(self.stop)
        if (cancel and cancel.is_set()) or (request is not None and await request.is_disconnected()):
            raise ClientGone()
        ctx = mp.get_context("spawn")
        self.pipe, child = ctx.Pipe()
        self.proc = ctx.Process(target=gpu_worker, args=(child, os.environ.get("LOCAL_ASR_DEVICE", "cuda"), model_id), daemon=True)
        self.proc.start()
        child.close()
        msg = await self.receive(request, cancel=cancel)
        if msg["kind"] != "ready":
            raise EngineError(msg.get("status", 503), msg.get("message", "Worker failed"))
        self.backend = msg
        self.last_backend = msg
        LOG.info("Model ready: %s", json.dumps(msg, ensure_ascii=False))

    async def transcribe(self, path, language, request, *, window=None, model_id=MODEL_ID):
        acquired = False
        request_id = window["request_id"] if window else uuid.uuid4().hex
        self.cancelled_ids = {key: stamp for key, stamp in self.cancelled_ids.items() if time.monotonic() - stamp < 120}
        if request_id in self.cancelled_ids:
            self.cancelled += 1
            raise ClientGone()
        if request_id in self.requests:
            raise EngineError(409, "request_id is already in use")
        cancel = asyncio.Event()
        self.requests[request_id] = cancel
        self.queue += 1
        try:
            # Poll a lock acquisition so a cancelled queued request never dispatches.
            while not acquired:
                if cancel.is_set() or await request.is_disconnected():
                    self.cancelled += 1
                    raise ClientGone()
                try:
                    await asyncio.wait_for(self.lock.acquire(), timeout=.1)
                    acquired = True
                except asyncio.TimeoutError:
                    pass
            self.queue -= 1
            await self.ensure(request, cancel, model_id)
            if cancel.is_set() or await request.is_disconnected():
                raise ClientGone()
            self.active = request_id
            self.started += 1
            LOG.info("job_start id=%s", self.active)
            self.pipe.send({"path": str(path), "language": language, **(window or {})})
            msg = await self.receive(request, timeout=240, cancel=cancel)
            if msg["kind"] == "error":
                raise EngineError(msg["status"], msg["message"])
            self.completed += 1
            LOG.info("job_complete id=%s elapsed=%s", self.active, msg["result"]["processing_seconds"])
            return msg["result"]
        except (ClientGone, asyncio.CancelledError):
            if acquired:
                self.cancelled += 1
                LOG.info("job_cancel id=%s worker_terminated=true", self.active)
                await asyncio.to_thread(self.stop)
            raise
        except EngineError as exc:
            if acquired and exc.status >= 500:
                await asyncio.to_thread(self.stop)
            raise
        finally:
            self.requests.pop(request_id, None)
            if acquired:
                self.active = None
                self.lock.release()
            else:
                self.queue -= 1


engine = Engine()


@contextlib.asynccontextmanager
async def lifespan(app):
    try:
        await engine.ensure()
    except EngineError as exc:
        LOG.error("Model unavailable: %s", exc.message)
        await asyncio.to_thread(engine.stop)
    try:
        yield
    finally:
        await asyncio.to_thread(engine.stop)


app = FastAPI(title="Local Subtitle ASR", version="1.2.1", lifespan=lifespan)
app.add_middleware(CORSMiddleware,
    allow_origin_regex=r"^chrome-extension://[a-p]{32}$",
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-BiliScript-Consumer"], allow_credentials=False,
)


class LimitBody:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        # Host protection prevents a remote site's DNS rebinding to this service.
        host = headers.get(b"host", b"").decode("latin1").split(":")[0]
        if host not in {"127.0.0.1", "localhost"}:
            return await JSONResponse({"error": {"message": "Loopback Host required"}}, 400)(scope, receive, send)
        origin = headers.get(b"origin", b"").decode("latin1")
        import re
        if origin and not re.fullmatch(r"chrome-extension://[a-p]{32}", origin):
            return await JSONResponse({"error": {"message": "Origin is not allowed"}}, 403)(scope, receive, send)
        try:
            declared = int(headers.get(b"content-length", b"0"))
        except ValueError:
            return await JSONResponse({"error": {"message": "Invalid Content-Length"}}, 400)(scope, receive, send)
        if declared > MAX_BODY:
            return await JSONResponse({"error": {"message": "Request exceeds 16 MiB"}}, 413)(scope, receive, send)
        received = 0

        async def bounded_receive():
            nonlocal received
            message = await receive()
            received += len(message.get("body", b""))
            if received > MAX_BODY:
                raise EngineError(413, "Request exceeds 16 MiB")
            return message
        return await self.app(scope, bounded_receive, send)


app.add_middleware(LimitBody)


@app.exception_handler(EngineError)
async def engine_error(request, exc):
    return JSONResponse({"error": {"message": exc.message, "type": "local_asr_error"}}, exc.status)


@app.middleware("http")
async def shared_consumer_guard(request, call_next):
    global OTHER_CONSUMER_AT
    if request.method == "POST" and request.url.path in ("/v1/audio/transcriptions", "/v1/audio/window"):
        if MANAGER_CONFIG:
            intent_path = Path(MANAGER_CONFIG).parent / "stop-intent.json"
            try:
                intent = json.loads(intent_path.read_text(encoding="utf-8"))
                if intent.get("instance") == MANAGER_INSTANCE and 0 <= time.time() - intent.get("at", 0) < 30:
                    return JSONResponse({"error": {"message": "Service is stopping; retry after starting it."}}, 503)
            except (OSError, ValueError, TypeError):
                pass
        if request.headers.get("x-biliscript-consumer") != "study-extension":
            OTHER_CONSUMER_AT = time.time()
    return await call_next(request)


@app.get("/health")
async def health():
    return {"status": "ok" if engine.last_backend else "model_unavailable", "service": "local-japanese-asr",
            "version": "1.2.1", "window_languages": ["ja", "en"], "opening_repair_version": 1,
            "base_path": str(BASE), "default_model": MODEL_ID, "manager_instance": MANAGER_INSTANCE,
            "other_consumer_recent": bool(OTHER_CONSUMER_AT and time.time() - OTHER_CONSUMER_AT < 900),
            "available_models": [name for name, path in MODEL_DIRS.items() if (path / "model.bin").is_file()],
            "model": MODEL_ID, "model_path": str(MODEL_DIR), "backend": engine.backend or engine.last_backend,
            "model_ready": bool(engine.backend),
            "worker_pid": engine.proc.pid if engine.proc else None,
            "active": bool(engine.active), "queue": engine.queue,
            "jobs_started": engine.started, "jobs_completed": engine.completed, "jobs_cancelled": engine.cancelled,
            "max_audio_seconds": MAX_DURATION, "recommended_chunk_seconds": 30, "max_body_bytes": MAX_BODY}


@app.get("/v1/models")
async def models():
    return {"object": "list", "data": [{"id": name, "object": "model", "owned_by": "local"}
                                          for name, path in MODEL_DIRS.items() if (path / "model.bin").is_file()]}


def requested_model(value):
    model = str(value or MODEL_ID)
    model = {"whisper-1": MODEL_ID, "faster-whisper-small": "small", "faster-whisper-medium": "medium"}.get(model, model)
    if model not in MODEL_DIRS or not (MODEL_DIRS[model] / "model.bin").is_file():
        raise EngineError(400, "Requested model is not installed; see GET /v1/models")
    return model


@app.post("/v1/audio/transcriptions")
async def transcriptions(request: Request):
    if engine.queue >= 8:
        raise EngineError(429, "Local ASR queue is full; retry later")
    path = None
    try:
        async with request.form(max_files=1, max_fields=12, max_part_size=MAX_BODY) as form:
            upload = form.get("file")
            if not isinstance(upload, UploadFile):
                raise EngineError(400, "multipart file is required")
            model = requested_model(form.get("model"))
            language = str(form.get("language") or request.query_params.get("language") or "ja").lower()
            language = {"japanese": "ja", "english": "en"}.get(language, language)
            if language in {"auto", ""}:
                language = None
            elif language not in {"ja", "zh", "en"}:
                raise EngineError(400, "language must be ja, zh, en, or auto")
            fmt = str(form.get("response_format") or "verbose_json")
            if fmt not in {"verbose_json", "json", "text"}:
                raise EngineError(400, "response_format must be verbose_json, json, or text")
            fd, name = tempfile.mkstemp(suffix=".audio", prefix="upload-")
            path = Path(name)
            with os.fdopen(fd, "wb") as target:
                while chunk := await upload.read(1024 * 1024):
                    target.write(chunk)
        result = await engine.transcribe(path, language, request, model_id=model)
        if fmt == "text":
            return PlainTextResponse(result["text"])
        if fmt == "json":
            return {"text": result["text"]}
        return result
    except ClientGone:
        return JSONResponse({"error": {"message": "Client disconnected; transcription cancelled"}}, 499)
    finally:
        if path:
            with contextlib.suppress(FileNotFoundError, PermissionError):
                path.unlink()


async def read_small_json(request):
    body = await request.body()
    if len(body) > 65536:
        raise EngineError(413, "JSON request exceeds 64 KiB")
    try:
        data = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise EngineError(400, "Invalid JSON")
    if not isinstance(data, dict):
        raise EngineError(400, "JSON object required")
    return data


def validate_request_id(data):
    import re
    value = data.get("request_id")
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9:_-]{1,100}", value):
        raise EngineError(400, "request_id must contain 1-100 letters, digits, colon, underscore, or hyphen")
    return value


@app.post("/v1/audio/cancel")
async def cancel_window(request: Request):
    data = await read_small_json(request)
    request_id = validate_request_id(data)
    event = engine.requests.get(request_id)
    # Remember early cancellation too: a cancel can race ahead of its window POST.
    engine.cancelled_ids[request_id] = time.monotonic()
    if len(engine.cancelled_ids) > 256:
        engine.cancelled_ids.pop(next(iter(engine.cancelled_ids)))
    if event:
        event.set()
    return {"request_id": request_id, "cancelled": bool(event)}


@app.post("/v1/audio/window")
async def window(request: Request):
    import math
    from window_audio import validate_audio_url, RemoteAudioError
    if engine.queue >= 8:
        raise EngineError(429, "Local ASR queue is full; retry later")
    data = await read_small_json(request)
    request_id = validate_request_id(data)
    language = data.get("language", "ja")
    if language not in ("ja", "en"):
        raise EngineError(400, "The bounded study endpoint requires language=ja or en")
    model = requested_model(data.get("model"))
    try:
        start, duration = float(data.get("start", -1)), float(data.get("duration", -1))
    except (TypeError, ValueError):
        raise EngineError(400, "Invalid window start/duration")
    if not math.isfinite(start) or not math.isfinite(duration) or start < 0 or start > 86400 or not 0 < duration <= 30:
        raise EngineError(400, "start must be 0-86400 seconds and duration must be >0 and <=30 seconds")
    backup = data.get("backup_urls") or []
    if not isinstance(backup, list) or len(backup) > 3:
        raise EngineError(400, "backup_urls must contain at most three URLs")
    urls = [data.get("audio_url")] + backup
    try:
        # Only parse syntax here. DNS/network work begins in the cancellable worker.
        for url in urls:
            validate_audio_url(url, resolve=False)
    except (RemoteAudioError, ValueError) as exc:
        raise EngineError(400, str(exc)) from None
    async def response_body():
        # MV3 workers can time out while waiting for fetch response headers.
        # JSON permits whitespace before the one final object; flush immediately
        # and keep the body alive while the bounded worker is running.
        yield b"\n"
        task = asyncio.create_task(engine.transcribe(None, language, request, model_id=model, window={
            "window": True, "request_id": request_id, "urls": urls, "start": start, "duration": duration,
        }))
        try:
            while not task.done():
                done, _ = await asyncio.wait({task}, timeout=10)
                if not done:
                    yield b"\n"
            try:
                result = task.result()
            except ClientGone:
                result = {"error": {"code": "499", "message": "Request cancelled; audio and ASR worker stopped"}}
            except EngineError as exc:
                result = {"error": {"code": str(exc.status), "message": exc.message}}
            yield json.dumps(result, ensure_ascii=False).encode("utf-8")
        finally:
            if not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

    return StreamingResponse(response_body(), media_type="application/json",
                             headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


if __name__ == "__main__":
    mp.freeze_support()
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=PORT, workers=1, access_log=True)
