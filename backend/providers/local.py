from __future__ import annotations

"""Local generation provider: Ollama for prompt expansion, ComfyUI for images.

The ComfyUI workflows in backend/comfyui_workflows/ have been run end-to-end against
a live ComfyUI instance (CPU-only, no GPU passthrough) and fixed for real issues
found along the way: a non-tiled 4x AI upscale step OOM-killed ComfyUI (removed, see
COMFYUI_FINAL_WIDTH/HEIGHT below), a non-tiled VAEEncode/VAEDecode of large images
also OOM-killed it (switched to VAEEncodeTiled/VAEDecodeTiled), and Ollama's own
cold-start latency exceeded a too-short hardcoded HTTP timeout (fixed). Sampling
parameter defaults (steps/cfg/sampler) still assume a turbo/lightning-distilled SDXL
checkpoint -- a standard checkpoint at these settings runs faster but looks visibly
undertrained; see README.md.
"""

import asyncio
import json
import mimetypes
import os
import random
import uuid
from pathlib import Path

import httpx

from providers._storage import BACKEND_ROOT, save_image_bytes
from providers.prompts import NEGATIVE_PROMPT, SYSTEM_PROMPT

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://ollama:11434")
OLLAMA_TEXT_MODEL = os.environ.get("OLLAMA_TEXT_MODEL", "llama3.1:8b")

COMFYUI_BASE_URL = os.environ.get("COMFYUI_BASE_URL", "http://comfyui:8188")
COMFYUI_CHECKPOINT = os.environ.get("COMFYUI_CHECKPOINT", "juggernautXL_v10.safetensors")

# Sampling params, tunable without a code change since the right values depend on
# which checkpoint is actually installed. Defaults assume a few-step turbo/lightning
# SDXL checkpoint (steps/cfg tuned for that), not a standard 20-30 step checkpoint --
# CPU-only inference measured ~60s/step here, so 30 steps was ~25-30 min for one
# image alone. Swap COMFYUI_CHECKPOINT to a turbo/lightning model and adjust these to
# match its model card if you use a different one.
COMFYUI_STEPS = int(os.environ.get("COMFYUI_STEPS", "8"))
COMFYUI_CFG = float(os.environ.get("COMFYUI_CFG", "1.5"))
COMFYUI_SAMPLER = os.environ.get("COMFYUI_SAMPLER", "euler")
COMFYUI_SCHEDULER = os.environ.get("COMFYUI_SCHEDULER", "sgm_uniform")
# Square by default, matching the source images previews are meant to look like.
# Finalize intentionally targets a different (16:9) aspect ratio -- see
# COMFYUI_FINAL_WIDTH below and the img2img workflow's ImageScale crop="center",
# which center-crops rather than stretching when the shapes don't match.
COMFYUI_WIDTH = int(os.environ.get("COMFYUI_WIDTH", "1024"))
COMFYUI_HEIGHT = int(os.environ.get("COMFYUI_HEIGHT", "1024"))
COMFYUI_UPSCALE_DENOISE = float(os.environ.get("COMFYUI_UPSCALE_DENOISE", "0.35"))
# finalize doesn't run a separate AI upscale model (ImageUpscaleWithModel): applying
# one at its native factor (e.g. 4x) to a 1024x1024 preview produces a 4096x4096
# intermediate image whose forward pass was confirmed in testing to OOM-kill ComfyUI
# even with 24GB allocated to Docker, with no tiling node available to bound it.
# Instead the preview is resized directly to this target and refined via the img2img
# KSampler pass below (denoise < 1.0 preserves composition while adding detail). Since
# this is 16:9 while the square preview above isn't, the resize node center-crops
# (crop="center" in img2img_upscale.json) rather than stretching.
# Reaching this target resolution safely depends on VAEEncodeTiled/VAEDecodeTiled
# (see COMFYUI_VAE_TILE_SIZE below) -- a non-tiled VAE pass OOM'd even at 2048x2048.
# 1280x720 (16:9) has roughly the same pixel count as the old 1024x1024 default that
# was measured at ~7 min on CPU -- see .agents/docs/overview.md's Measured performance
# section before raising this.
COMFYUI_FINAL_WIDTH = int(os.environ.get("COMFYUI_FINAL_WIDTH", "1280"))
COMFYUI_FINAL_HEIGHT = int(os.environ.get("COMFYUI_FINAL_HEIGHT", "720"))

# VAEEncodeTiled/VAEDecodeTiled process the image in tile_size x tile_size chunks
# (overlap-blended) instead of all at once, bounding peak VAE memory regardless of
# the final image resolution -- this is what makes COMFYUI_FINAL_WIDTH/HEIGHT above
# reachable on CPU-only inference. ComfyUI's own node defaults (512/64).
COMFYUI_VAE_TILE_SIZE = int(os.environ.get("COMFYUI_VAE_TILE_SIZE", "512"))
COMFYUI_VAE_TILE_OVERLAP = int(os.environ.get("COMFYUI_VAE_TILE_OVERLAP", "64"))

# How long to keep polling ComfyUI's /history endpoint before giving up. Local CPU
# inference (e.g. Docker Desktop on Apple Silicon, which has no GPU passthrough) can
# be far slower than Gemini's latency, so this is configurable rather than hardcoded.
LOCAL_GENERATION_TIMEOUT_SECONDS = float(os.environ.get("LOCAL_GENERATION_TIMEOUT_SECONDS", "900"))
POLL_INTERVAL_SECONDS = 2.0

PREVIEW_COUNT = 4

_WORKFLOWS_DIR = Path(__file__).parent.parent / "comfyui_workflows"
_TXT2IMG_WORKFLOW_PATH = _WORKFLOWS_DIR / "txt2img_batch.json"
_IMG2IMG_WORKFLOW_PATH = _WORKFLOWS_DIR / "img2img_upscale.json"

# Node IDs shared by both workflow JSON files (see backend/comfyui_workflows/).
_CHECKPOINT_NODE = "4"
_POSITIVE_PROMPT_NODE = "6"
_NEGATIVE_PROMPT_NODE = "7"
_SAMPLER_NODE = "3"
_VAE_DECODE_NODE = "8"
_SAVE_IMAGE_NODE = "9"
# txt2img-only
_LATENT_NODE = "5"
# img2img-only
_LOAD_IMAGE_NODE = "10"
_VAE_ENCODE_NODE = "13"
_DOWNSCALE_NODE = "14"

_http_client: httpx.AsyncClient | None = None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        # Shares LOCAL_GENERATION_TIMEOUT_SECONDS rather than a separate hardcoded
        # value: Ollama's cold-start model load alone took ~82s in testing, and
        # generation speed drops further under CPU contention from other running
        # containers, so a short fixed timeout (previously 120s) fails requests that
        # are still legitimately in progress.
        _http_client = httpx.AsyncClient(timeout=httpx.Timeout(LOCAL_GENERATION_TIMEOUT_SECONDS))
    return _http_client


class ComfyUIError(Exception):
    """Raised when ComfyUI rejects a workflow outright (validation/queue error)."""


async def expand_prompt(user_prompt: str) -> str:
    client = _get_http_client()
    response = await client.post(
        f"{OLLAMA_BASE_URL}/api/generate",
        json={
            "model": OLLAMA_TEXT_MODEL,
            "system": SYSTEM_PROMPT,
            # Treat user input as data, not instructions (prompt injection defense),
            # matching providers/gemini.py.
            "prompt": f'User input: """{user_prompt}"""',
            "stream": False,
        },
    )
    response.raise_for_status()
    return response.json()["response"].strip()


def _load_workflow(path: Path) -> dict:
    return json.loads(path.read_text())


async def _queue_and_wait(client: httpx.AsyncClient, workflow: dict) -> dict | None:
    """Queue a workflow and poll until it completes, fails, or times out.

    Returns the /history entry dict on success, or None on timeout (treated as a
    generation failure by callers, same as a caught Gemini APIError).
    """
    client_id = str(uuid.uuid4())
    queue_response = await client.post(
        f"{COMFYUI_BASE_URL}/prompt",
        json={"prompt": workflow, "client_id": client_id},
    )
    if queue_response.status_code >= 400:
        raise ComfyUIError(f"ComfyUI rejected the workflow: {queue_response.text}")
    body = queue_response.json()
    if body.get("node_errors"):
        raise ComfyUIError(f"ComfyUI workflow validation failed: {body['node_errors']}")
    prompt_id = body["prompt_id"]

    elapsed = 0.0
    while elapsed < LOCAL_GENERATION_TIMEOUT_SECONDS:
        history_response = await client.get(f"{COMFYUI_BASE_URL}/history/{prompt_id}")
        history_response.raise_for_status()
        history = history_response.json()
        entry = history.get(prompt_id)
        if entry is not None and entry.get("outputs"):
            return entry
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
        elapsed += POLL_INTERVAL_SECONDS
    return None


def _extract_output_images(history_entry: dict) -> list[dict]:
    save_node_output = history_entry.get("outputs", {}).get(_SAVE_IMAGE_NODE, {})
    return save_node_output.get("images", [])


async def _fetch_image(client: httpx.AsyncClient, image_ref: dict) -> tuple[bytes, str]:
    params = {
        "filename": image_ref["filename"],
        "subfolder": image_ref.get("subfolder", ""),
        "type": image_ref.get("type", "output"),
    }
    response = await client.get(f"{COMFYUI_BASE_URL}/view", params=params)
    response.raise_for_status()
    mime_type = response.headers.get("content-type") or "image/png"
    return response.content, mime_type


async def _upload_reference_image(client: httpx.AsyncClient, path: Path) -> dict:
    mime_type = mimetypes.guess_type(path.name)[0] or "image/png"
    files = {"image": (path.name, path.read_bytes(), mime_type)}
    response = await client.post(f"{COMFYUI_BASE_URL}/upload/image", files=files)
    response.raise_for_status()
    return response.json()


async def _generate_one_preview(client: httpx.AsyncClient, enhanced_prompt: str) -> str | None:
    workflow = _load_workflow(_TXT2IMG_WORKFLOW_PATH)
    workflow[_CHECKPOINT_NODE]["inputs"]["ckpt_name"] = COMFYUI_CHECKPOINT
    workflow[_POSITIVE_PROMPT_NODE]["inputs"]["text"] = enhanced_prompt
    workflow[_NEGATIVE_PROMPT_NODE]["inputs"]["text"] = NEGATIVE_PROMPT
    workflow[_LATENT_NODE]["inputs"]["batch_size"] = 1
    workflow[_LATENT_NODE]["inputs"]["width"] = COMFYUI_WIDTH
    workflow[_LATENT_NODE]["inputs"]["height"] = COMFYUI_HEIGHT
    workflow[_SAMPLER_NODE]["inputs"]["seed"] = random.randint(0, 2**32 - 1)
    workflow[_SAMPLER_NODE]["inputs"]["steps"] = COMFYUI_STEPS
    workflow[_SAMPLER_NODE]["inputs"]["cfg"] = COMFYUI_CFG
    workflow[_SAMPLER_NODE]["inputs"]["sampler_name"] = COMFYUI_SAMPLER
    workflow[_SAMPLER_NODE]["inputs"]["scheduler"] = COMFYUI_SCHEDULER
    workflow[_VAE_DECODE_NODE]["inputs"]["tile_size"] = COMFYUI_VAE_TILE_SIZE
    workflow[_VAE_DECODE_NODE]["inputs"]["overlap"] = COMFYUI_VAE_TILE_OVERLAP

    try:
        entry = await _queue_and_wait(client, workflow)
    except (ComfyUIError, httpx.HTTPError):
        # Covers both workflow-validation errors and connection-level failures (e.g.
        # ComfyUI crashing/OOMing mid-request, which surfaces as a dropped connection
        # rather than an HTTP error status).
        return None
    if entry is None:
        return None

    image_refs = _extract_output_images(entry)
    if not image_refs:
        return None
    try:
        data, mime_type = await _fetch_image(client, image_refs[0])
    except (httpx.HTTPError, KeyError):
        return None
    return save_image_bytes(data, mime_type)


async def generate_preview_batch(enhanced_prompt: str) -> list[str | None]:
    """Generate the 4 previews as 4 sequential single-image ComfyUI jobs.

    Deliberately not one batch_size=4 job: ComfyUI's queue already serializes work
    (one job at a time regardless), and requesting all 4 images in a single job
    multiplies peak memory for the latents -- a real risk on CPU-only inference,
    where it has caused ComfyUI to be OOM-killed mid-request. Sequential
    batch_size=1 jobs use far less peak memory and, as a bonus, restore Gemini-like
    per-candidate failure isolation (one crashed job doesn't take down the other 3).
    """
    client = _get_http_client()
    return [await _generate_one_preview(client, enhanced_prompt) for _ in range(PREVIEW_COUNT)]


async def generate_one_preview(enhanced_prompt: str) -> str | None:
    """Public single-image entry point (used by the individual-retry endpoint).
    Fetches its own client rather than taking one as a param, matching the other
    three providers' public interface -- the internal _generate_one_preview above
    keeps the client param so generate_preview_batch's sequential loop can reuse
    one client across all 4 jobs instead of opening a new one per call."""
    client = _get_http_client()
    return await _generate_one_preview(client, enhanced_prompt)


async def generate_final_image(enhanced_prompt: str, reference_image_path: str) -> str | None:
    client = _get_http_client()
    reference_path = BACKEND_ROOT / reference_image_path.lstrip("/")

    try:
        uploaded = await _upload_reference_image(client, reference_path)
    except httpx.HTTPError:
        return None

    workflow = _load_workflow(_IMG2IMG_WORKFLOW_PATH)
    workflow[_CHECKPOINT_NODE]["inputs"]["ckpt_name"] = COMFYUI_CHECKPOINT
    workflow[_POSITIVE_PROMPT_NODE]["inputs"]["text"] = enhanced_prompt
    workflow[_NEGATIVE_PROMPT_NODE]["inputs"]["text"] = NEGATIVE_PROMPT
    workflow[_LOAD_IMAGE_NODE]["inputs"]["image"] = uploaded["name"]
    workflow[_DOWNSCALE_NODE]["inputs"]["width"] = COMFYUI_FINAL_WIDTH
    workflow[_DOWNSCALE_NODE]["inputs"]["height"] = COMFYUI_FINAL_HEIGHT
    workflow[_SAMPLER_NODE]["inputs"]["seed"] = random.randint(0, 2**32 - 1)
    workflow[_SAMPLER_NODE]["inputs"]["steps"] = COMFYUI_STEPS
    workflow[_SAMPLER_NODE]["inputs"]["cfg"] = COMFYUI_CFG
    workflow[_SAMPLER_NODE]["inputs"]["sampler_name"] = COMFYUI_SAMPLER
    workflow[_SAMPLER_NODE]["inputs"]["scheduler"] = COMFYUI_SCHEDULER
    workflow[_SAMPLER_NODE]["inputs"]["denoise"] = COMFYUI_UPSCALE_DENOISE
    workflow[_VAE_ENCODE_NODE]["inputs"]["tile_size"] = COMFYUI_VAE_TILE_SIZE
    workflow[_VAE_ENCODE_NODE]["inputs"]["overlap"] = COMFYUI_VAE_TILE_OVERLAP
    workflow[_VAE_DECODE_NODE]["inputs"]["tile_size"] = COMFYUI_VAE_TILE_SIZE
    workflow[_VAE_DECODE_NODE]["inputs"]["overlap"] = COMFYUI_VAE_TILE_OVERLAP

    try:
        entry = await _queue_and_wait(client, workflow)
    except (ComfyUIError, httpx.HTTPError):
        return None
    if entry is None:
        return None

    image_refs = _extract_output_images(entry)
    if not image_refs:
        return None
    try:
        data, mime_type = await _fetch_image(client, image_refs[0])
    except (httpx.HTTPError, KeyError):
        return None
    return save_image_bytes(data, mime_type)
