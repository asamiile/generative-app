# CAVEAT: this has not been run in the sandbox that authored it (no Docker/GPU
# access there). See backend/providers/local.py's module docstring and README.md
# for what still needs live verification (checkpoint/upscale model placement, GPU
# passthrough, workflow JSON tuning).
FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 appuser

WORKDIR /app

RUN git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git . \
    && pip install --no-cache-dir -r requirements.txt

RUN mkdir -p models/checkpoints models/upscale_models output input \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8188

# --cpu is the safe default: without it, ComfyUI's torch build tries to
# initialize CUDA unconditionally and crashes with "Found no NVIDIA driver" on
# any host without a passed-through GPU (confirmed on Docker Desktop/Apple
# Silicon -- it does NOT fall back to CPU automatically). Linux hosts with
# nvidia-container-toolkit should override this via docker-compose.yml's
# commented-out `command:` (drop --cpu) alongside the GPU `deploy.resources`
# block -- see README.md.
CMD ["python", "main.py", "--listen", "0.0.0.0", "--port", "8188", "--cpu"]
