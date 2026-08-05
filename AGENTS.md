# AGENTS.md

このリポジトリで作業するAIエージェント向けの指示書。詳細な設計は [.agents/docs/DESIGN.md](.agents/docs/DESIGN.md) を参照。

## プロジェクト概要

Gemini APIを使い、短いテキスト入力から実写表現限定の画像を生成するローカルWebアプリ（MVP）。将来的に画像以外の生成（テキスト/動画等）にも拡張予定のため、リポジトリ名は`generative-app`。

- バックエンド: `backend/`（FastAPI, Python, SQLAlchemy, SQLite, Alembic）
- フロントエンド: `frontend/`（Next.js App Router, TypeScript, Tailwind CSS）
- 実行環境: Docker / docker-compose（MVP環境構築の段階から導入。当面はクラウドにデプロイせずローカル実行のみ）

## セットアップ・実行コマンド

まだscaffolding前のため未確定。`backend/`・`frontend/`・`docker-compose.yml`を作成した時点で、以下を実際のコマンドに更新すること。

```
# ローカル実行はdocker-compose経由が基本(予定)
docker-compose up

# 個別のデバッグ時のみ(予定)
cd backend && pip install -r requirements.txt && uvicorn main:app --reload
cd frontend && npm install && npm run dev
```

## 絶対に守るべき制約

1. **画像生成モデルはNano Banana系を使う。Imagen系（`imagen-3`, `imagen-4`等）は使用禁止。**
   Imagen系は2026年8月17日にシャットダウン済み/予定。`gemini-3-pro-image`（Nano Banana Pro）を使用する。
2. **モデルID・APIパラメーターは実装直前に必ず最新の公式ドキュメントで確認する。**
   参考: https://ai.google.dev/gemini-api/docs/models 、 https://ai.google.dev/gemini-api/docs/image-generation
   Googleの画像生成モデルは数ヶ月単位で名称・非推奨化が進むため、コード内のモデル名を鵜呑みにしない。
3. **プロンプト拡張のシステムプロンプトには必ず以下を含める**（`.agents/docs/DESIGN.md` 6章参照）:
   - 出力は画像生成用の英語プロンプトのみ
   - 実写表現（Photorealistic, live-action style）を必須指定
   - アニメ調・イラスト調は除外
   - レンズ・被写界深度・ライティング等で実写の質感を強化
4. **APIキーは`.env`（`backend/.env`）にのみ保存し、コミットしない。** `.gitignore`に必ず含める。
5. **画像生成は「4枚プレビュー（1K）→選択→本番（4K）」の2段階フローとする。** 単発で4K画像だけを生成する実装にはしない。プレビュー4枚は`candidateCount`非対応のため個別に4回呼び出す。本番生成は選択したプレビューを参照画像として渡し、構図を保持したまま4K化する。いずれもレイテンシが長いため、バックエンド/フロントともタイムアウトを十分に確保する。
6. **全APIエンドポイント（`/api/generate/preview`・`/api/generate/finalize`・`/api/history`）に共有トークン認証を必須とする。** `Authorization: Bearer <APP_API_TOKEN>`を検証する`backend/auth.py`の依存関数を必ず経由させる。認証なしでの実装・デプロイは行わない（実務利用時に誰でも課金APIを呼べてしまうため）。
7. **画像生成系エンドポイントには`slowapi`でレート制限をかける。** デフォルト1時間あたり10リクエスト（`RATE_LIMIT_PER_HOUR`で調整）。
8. **各コンテナーは非rootユーザーで実行し、ポートは`127.0.0.1`にのみバインドする。** ローカル実行時に意図せず外部公開しない。
9. **DBスキーマ変更は必ずAlembicのマイグレーションファイルを作成する。** `Base.metadata.create_all()`だけで済ませない。外部キーには`ondelete`ポリシーと`index=True`を明記し、`status`系カラムは自由文字列ではなくEnumで値を制約する（`.agents/docs/DESIGN.md` 4章参照）。

## コード規約

- コメントは「なぜ」を説明する場合のみ最小限に。「何をしているか」の説明コメントは書かない。
- タスクの要求範囲を超えた抽象化・将来対応のための拡張は行わない（YAGNI）。
- 既存ファイルの編集を優先し、新規ファイル作成は必要な場合のみ。

## ディレクトリ構成

`.agents/docs/DESIGN.md` 3章の構成に従う。変更する場合は設計書側も更新すること。DB設計・APIエンドポイント設計は同ドキュメント4章・5章を参照。
