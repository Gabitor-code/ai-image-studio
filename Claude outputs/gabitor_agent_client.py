"""
Gabitor AI - egyszerű Python kliens AI agenteknek.

Ezt a fájlt bármelyik agented meghívhatja (importálva vagy szkriptként futtatva),
hogy képet vagy videót generáljon a Gabitor stúdióban - pontosan úgy, mintha
te kattintanál a weboldalon, csak API-n keresztül.

Beállítás előtte:
1. Hozz létre egy külön Gabitor fiókot az agent csapatnak (email+jelszó),
   és tölts rá krediteket.
2. Töltsd ki alább a GABITOR_DOMAIN, SUPABASE_URL, SUPABASE_ANON_KEY értékeket
   (ezek a Vercel projekt env változói / a Supabase projekt Settings > API oldalán).
3. Add meg az agent fiók email/jelszó párosát (pl. környezeti változóból,
   ne írd bele a kódba éles használatra).
"""

import os
import time
import requests

# --- Ide írd be a saját adataidat -----------------------------------------
GABITOR_DOMAIN = "https://YOUR-GABITOR-DOMAIN.com"          # pl. https://gabitor.ai
SUPABASE_URL = "https://YOUR-PROJECT.supabase.co"           # Supabase projekt URL
SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY"                 # Supabase "anon" / publishable key

AGENT_EMAIL = os.environ.get("GABITOR_AGENT_EMAIL", "agent@example.com")
AGENT_PASSWORD = os.environ.get("GABITOR_AGENT_PASSWORD", "")
# ----------------------------------------------------------------------------


def get_access_token() -> str:
    """Bejelentkezik az agent-fiókkal, és visszaadja a Supabase access tokent."""
    resp = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
        json={"email": AGENT_EMAIL, "password": AGENT_PASSWORD},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def generate_image(prompt: str, token: str, **settings) -> str:
    """Kép generálása. Visszaadja a kész kép URL-jét."""
    body = {"prompt": prompt, "workflowMode": "image", **settings}
    resp = requests.post(
        f"{GABITOR_DOMAIN}/api/generate2",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=body,
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise RuntimeError(data["error"])
    return data["image"]


def generate_video(prompt: str, token: str, video_tier: str = "cinematic",
                    duration: int = 5, aspect_ratio: str = "16:9",
                    reference_image: str | None = None, poll_seconds: int = 5,
                    timeout_seconds: int = 300, **settings) -> str:
    """
    Videó generálása (szöveg->videó, vagy ha reference_image-et is adsz,
    kép->videó). Visszaadja a kész videó URL-jét, addig várva/pollozva,
    amíg el nem készül.

    video_tier: 'cinematic' (Kling, 4 kredit/mp - ez a legolcsóbb) vagy
                'standard' (Wan, 5-8 kredit/mp).
    """
    workflow_mode = "video" if reference_image else "text-video"
    body = {
        "prompt": prompt,
        "workflowMode": workflow_mode,
        "videoTier": video_tier,
        "duration": duration,
        "aspectRatio": aspect_ratio,
        **({"referenceImage": reference_image} if reference_image else {}),
        **settings,
    }
    resp = requests.post(
        f"{GABITOR_DOMAIN}/api/generate2",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=body,
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise RuntimeError(data["error"])

    job_id = data["jobId"]
    provider = data["provider"]

    # Pollozás, amíg a videó el nem készül.
    waited = 0
    while waited < timeout_seconds:
        time.sleep(poll_seconds)
        waited += poll_seconds
        status_resp = requests.get(
            f"{GABITOR_DOMAIN}/api/video-status",
            params={"jobId": job_id, "provider": provider},
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        status_resp.raise_for_status()
        status_data = status_resp.json()
        if status_data.get("video"):
            return status_data["video"]
        if status_data.get("error"):
            raise RuntimeError(status_data["error"])
        # egyébként még dolgozik rajta -> tovább várunk

    raise TimeoutError("A videó nem készült el a megadott időn belül.")


if __name__ == "__main__":
    token = get_access_token()

    # Példa: kép generálása
    image_url = generate_image("Neon-fényű futurisztikus város éjszaka", token)
    print("Kép kész:", image_url)

    # Példa: videó generálása (legolcsóbb, Cinematic tier, 5 mp)
    video_url = generate_video(
        "Egy sárkány repül a hegyek felett napnyugtakor",
        token,
        video_tier="cinematic",
        duration=5,
        aspect_ratio="16:9",
    )
    print("Videó kész:", video_url)
