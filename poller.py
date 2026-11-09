"""Shared stdlib poller for GET /status — the one wire the whole plugin shares."""
import json
import urllib.request

def fetch_status(base_url: str, timeout: float = 3.0):
    """Fetch GET <base_url>/status. Returns (data, error) — exactly one is None."""
    url = base_url.rstrip("/") + "/status"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            if resp.status != 200:
                return None, f"HTTP {resp.status}"
            return json.loads(resp.read().decode("utf-8", "replace")), None
    except Exception as exc:  # URLError, timeout, JSON decode
        return None, str(exc)
