# Upstream image runs as root by default; add a non-root user on top (same
# wrapper pattern as ollama/Dockerfile and comfyui/Dockerfile).
FROM ghcr.io/coleifer/sqlite-web:latest

RUN addgroup -g 1000 appuser && adduser -D -u 1000 -G appuser appuser

USER appuser

EXPOSE 8080

# -r: read-only, matching the :ro volume mount in docker-compose.yml.
CMD ["history.db", "-r"]
