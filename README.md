# mineru-batch

A batch conversion console for [MinerU](https://github.com/opendatalab/MinerU):
upload documents, convert a tree to mirrored Markdown, download the results.

- `batch_api.py` — FastAPI control plane (upload, run, status, results)
- `batch-convert.py` — the conversion engine (unchanged by the console)
- `batch_webui/` — the browser console
- `docs/superpowers/` — design and plan

Storage defaults to `$MINERU_HOME/batch` (`ee-in/` → `ee-md/`).
