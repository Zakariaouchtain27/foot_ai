"""Deploy the PitchSight Live video worker on a GPU with Modal (https://modal.com).

One-time setup:
    pip install modal
    modal token new
    # Store your Supabase creds as a Modal secret named "pitchsight":
    modal secret create pitchsight \
        SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
        SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY

Drain the queue once (process all currently-queued uploads on a T4 GPU):
    modal run modal_app.py

Run it on a schedule (checks every 2 minutes) by deploying:
    modal deploy modal_app.py
"""

import modal

image = (
    modal.Image.debian_slim()
    # OpenCV runtime libs + ffmpeg (yt-dlp uses it to clip URL downloads)
    .apt_install("libgl1", "libglib2.0-0", "ffmpeg")
    .pip_install_from_requirements("requirements.txt")
    .add_local_python_source("process_job")
)

app = modal.App("pitchsight-worker")


@app.function(
    image=image,
    gpu="T4",
    timeout=3600,  # allow long clips; raise if you process full matches
    secrets=[modal.Secret.from_name("pitchsight")],
    schedule=modal.Period(minutes=2),  # auto-drain the queue; remove for manual-only
)
def drain():
    import process_job

    handled = process_job.drain_once()
    print(f"[modal] drained {handled} job(s)")


@app.local_entrypoint()
def main():
    # `modal run modal_app.py` -> process the queue once, right now.
    drain.remote()
