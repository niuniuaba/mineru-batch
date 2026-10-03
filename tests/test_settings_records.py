"""The settings panel renders whatever the server declares, so records must be complete."""

from __future__ import annotations

from fastapi.testclient import TestClient

REQUIRED_KEYS = {"key", "label", "value", "source", "env_var", "config_file", "effect"}
VALID_EFFECTS = {"restart", "next_run", "read_only"}


def _records(api: TestClient) -> dict[str, dict]:
    payload = api.get("/api/status").json()
    return {record["key"]: record for record in payload["config"]["records"]}


def test_service_parameters_are_declared(api: TestClient) -> None:
    records = _records(api)
    for key in ("tier", "image_mode", "host", "port", "root", "max_upload_bytes", "token_required"):
        assert key in records, key
        assert REQUIRED_KEYS <= set(records[key])
        assert records[key]["effect"] == "restart"


def test_every_effect_is_one_the_console_knows(api: TestClient) -> None:
    for record in _records(api).values():
        assert record["effect"] in VALID_EFFECTS


def test_tier_and_image_mode_report_live_values(api: TestClient) -> None:
    records = _records(api)
    assert records["tier"]["value"] == "basic"
    assert records["image_mode"]["value"] == "marker"


def test_mineru_parameters_declare_their_source_and_knob(api: TestClient) -> None:
    records = _records(api)
    for key in ("small_backend", "vlm_engine"):
        record = records[key]
        assert record["effect"] == "next_run"
        assert record["source"] in {"default", "file", "env"}
        assert record["env_var"].startswith("MINERU_")


def test_token_value_is_never_exposed(monkeypatch) -> None:
    monkeypatch.setenv("MINERU_BATCH_TOKEN", "super-secret")
    import batch_api
    import batch_settings

    batch_settings.reset_settings()
    batch_api.state = batch_api.RunState()
    try:
        with TestClient(batch_api.app) as client:
            response = client.get("/api/status", headers={"Authorization": "Bearer super-secret"})
        assert response.status_code == 200
        assert "super-secret" not in response.text
        assert next(r for r in response.json()["config"]["records"] if r["key"] == "token_required")["value"] is True
    finally:
        batch_settings.reset_settings()


def test_token_required_is_false_by_default(api: TestClient) -> None:
    assert _records(api)["token_required"]["value"] is False


def test_environment_facts_are_present(api: TestClient) -> None:
    config = api.get("/api/status").json()["config"]
    assert config["environment"]["mineru_version"]
    assert config["environment"]["device"]
    assert config["environment"]["resolved_small_backend"] in {"onnx", "torch"}
    assert config["disk"]["free"] is not None
    assert config["queued_in_input"] == 0


def test_storage_paths_are_reported(api: TestClient, tmp_path) -> None:
    config = api.get("/api/status").json()["config"]
    assert config["input_dir"] == str(tmp_path / "ee-in")
    assert config["output_dir"] == str(tmp_path / "ee-md")
