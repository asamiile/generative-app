# Wraps the official image (which runs as root) with a non-root user, since every
# container in this project must run as non-root (see AGENTS.md).
#
# CAVEAT: this has not been run in the sandbox that authored it (no Docker/GPU
# access there). Named-volume ownership on first mount depends on this Dockerfile's
# mkdir+chown of OLLAMA_MODELS running before the volume is attached; if the
# container fails to write models on first `docker compose up`, see the
# troubleshooting note in README.md.
FROM ollama/ollama:latest

# The base image ships a Ubuntu-derived "ubuntu" user/group already at uid/gid 1000
# (not an "ollama" user) -- remove it first so appuser can take uid 1000.
RUN userdel -r ubuntu 2>/dev/null; \
    useradd --create-home --uid 1000 appuser

ENV HOME=/home/appuser
ENV OLLAMA_MODELS=/home/appuser/.ollama/models
ENV OLLAMA_HOST=0.0.0.0

RUN mkdir -p "$OLLAMA_MODELS" && chown -R appuser:appuser /home/appuser

USER appuser

EXPOSE 11434

ENTRYPOINT ["/bin/ollama"]
CMD ["serve"]
