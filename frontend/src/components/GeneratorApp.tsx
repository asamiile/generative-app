"use client";

import { useEffect, useState } from "react";
import {
  generateFinalize,
  generatePreview,
  getHistory,
  resolveImageUrl,
  type GeneratePreviewResponse,
  type HistoryItem,
} from "@/lib/api";

type Phase = "idle" | "generating-preview" | "preview-ready" | "finalizing" | "done";

export function GeneratorApp() {
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<GeneratePreviewResponse | null>(null);
  const [finalImagePath, setFinalImagePath] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const loadHistory = async () => {
    try {
      setHistory(await getHistory());
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const isBusy = phase === "generating-preview" || phase === "finalizing";

  const handleGeneratePreview = async () => {
    if (!prompt.trim()) return;
    setError(null);
    setPreview(null);
    setFinalImagePath(null);
    setPhase("generating-preview");
    try {
      setPreview(await generatePreview(prompt));
      setPhase("preview-ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "プレビュー生成に失敗しました");
      setPhase("idle");
    }
  };

  const handleSelectPreview = async (previewId: number) => {
    if (!preview) return;
    setError(null);
    setPhase("finalizing");
    try {
      const result = await generateFinalize(preview.session_id, previewId);
      if (result.status !== "success" || !result.image_path) {
        throw new Error("4K本番画像の生成に失敗しました");
      }
      setFinalImagePath(result.image_path);
      setPhase("done");
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "4K本番画像の生成に失敗しました");
      setPhase("preview-ready");
    }
  };

  return (
    <main className="mx-auto max-w-3xl space-y-10 px-4 py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">実写画像ジェネレーター</h1>
        <p className="text-sm text-neutral-400">
          短いテキストから実写表現の画像を生成します。まず4枚のプレビューを作成し、選んだ1枚を4Kで仕上げます。
        </p>
      </header>

      <section className="space-y-3">
        <textarea
          className="w-full rounded-md border border-neutral-700 bg-neutral-900 p-3 text-sm focus:border-indigo-500 focus:outline-none disabled:opacity-50"
          rows={3}
          maxLength={200}
          placeholder="例: 夜の東京、雨上がりの交差点"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={isBusy}
        />
        <button
          type="button"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleGeneratePreview}
          disabled={isBusy || !prompt.trim()}
        >
          {phase === "generating-preview" ? "プレビュー生成中…" : "プレビューを生成"}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>

      {preview && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">プレビューを選択</h2>
          <p className="break-words text-xs text-neutral-500">{preview.enhanced_prompt}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {preview.previews.map((p) => (
              <button
                key={p.preview_id}
                type="button"
                className="group relative aspect-square overflow-hidden rounded-md border border-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={p.status !== "success" || !p.image_path || isBusy}
                onClick={() => handleSelectPreview(p.preview_id)}
              >
                {p.status === "success" && p.image_path ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={resolveImageUrl(p.image_path)}
                    alt={`プレビュー候補 ${p.candidate_index + 1}`}
                    className="h-full w-full object-cover transition group-hover:opacity-80"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-red-400">
                    生成失敗
                  </div>
                )}
              </button>
            ))}
          </div>
          {phase === "finalizing" && (
            <p className="text-sm text-neutral-400">4K本番画像を生成中です。しばらくお待ちください…</p>
          )}
        </section>
      )}

      {finalImagePath && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">本番画像(4K)</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={resolveImageUrl(finalImagePath)}
            alt="4K本番画像"
            className="w-full rounded-md border border-neutral-700"
          />
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">履歴</h2>
        {history.length === 0 ? (
          <p className="text-sm text-neutral-500">まだ履歴がありません。</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {history.map((item) => (
              <div key={item.session_id} className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resolveImageUrl(item.image_path)}
                  alt={item.original_prompt}
                  className="aspect-square w-full rounded-md border border-neutral-700 object-cover"
                />
                <p className="truncate text-xs text-neutral-400">{item.original_prompt}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
