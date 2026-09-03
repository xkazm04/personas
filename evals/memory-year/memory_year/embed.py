"""Local embeddings with a cache. The embedder's name travels with every number."""
from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path

import numpy as np

DEFAULT_EMBEDDER = "sentence-transformers/all-MiniLM-L6-v2"


class Embedder:
    def __init__(self, name: str = DEFAULT_EMBEDDER, cache_path: Path | None = None):
        self.name = name
        self._model = None
        self.calls = 0
        self.db = None
        if cache_path:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.db = sqlite3.connect(str(cache_path))
            self.db.execute("CREATE TABLE IF NOT EXISTS emb (k TEXT PRIMARY KEY, v BLOB)")

    def _load(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer(self.name)
        return self._model

    def embed(self, texts: list[str]) -> np.ndarray:
        out = [None] * len(texts)
        todo = []
        for i, t in enumerate(texts):
            k = hashlib.sha256((self.name + "\n" + t).encode()).hexdigest()
            row = self.db.execute("SELECT v FROM emb WHERE k=?", (k,)).fetchone() if self.db else None
            if row:
                out[i] = np.frombuffer(row[0], dtype=np.float32)
            else:
                todo.append((i, k, t))
        if todo:
            vecs = self._load().encode([t for _, _, t in todo], normalize_embeddings=True, batch_size=64, show_progress_bar=False)
            self.calls += len(todo)
            for (i, k, _), v in zip(todo, vecs):
                v = np.asarray(v, dtype=np.float32)
                out[i] = v
                if self.db:
                    self.db.execute("INSERT OR REPLACE INTO emb VALUES (?,?)", (k, v.tobytes()))
            if self.db:
                self.db.commit()
        return np.vstack(out)
