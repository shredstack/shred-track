"""
Convert a source watch app image into Apple App Store compliant
watchOS screenshots for the requested device targets.

App Store Connect screenshot sizes (watchOS):
  Ultra 3            -> 422 x 514 px
  Series 11          -> 416 x 496 px  (same display as Series 10)
  Series 9 / 8 / 7   -> 396 x 484 px
  Series 6 / 5 / 4   -> 368 x 448 px
  Series 3           -> 312 x 390 px

Output: True PNG files, RGB mode (no alpha), with correct extensions.
"""

from PIL import Image
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = REPO_ROOT / "claude_code_instructions" / "watch_screenshots"
OUT_DIR = SOURCE_DIR / "apple_approved_screenshots"
OUT_DIR.mkdir(parents=True, exist_ok=True)

SOURCE_EXTS = {".png", ".jpg", ".jpeg"}

# Sarah's requested device targets, mapped to App Store Connect dimensions.
# Series 11 shares the Series 10 display, so 416x496 covers both.
TARGETS = [
    ("ShredTrack_watch_Ultra3",   422, 514),
    ("ShredTrack_watch_Series11", 416, 496),
    ("ShredTrack_watch_Series9",  396, 484),
    ("ShredTrack_watch_Series6",  368, 448),
    ("ShredTrack_watch_Series3",  312, 390),
]


def fit_to_canvas(src: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """
    Fit the source image into the target canvas preserving aspect ratio,
    then pad with black (matches the watchOS device bezel).
    Avoids stretching, which would distort the UI and could trigger
    App Store review rejection for non-representative screenshots.
    """
    src_w, src_h = src.size
    scale = min(target_w / src_w, target_h / src_h)
    new_w = int(round(src_w * scale))
    new_h = int(round(src_h * scale))

    # Lanczos gives the best result when upscaling a small source.
    resized = src.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new("RGB", (target_w, target_h), (0, 0, 0))
    offset = ((target_w - new_w) // 2, (target_h - new_h) // 2)
    canvas.paste(resized, offset)
    return canvas


def main() -> None:
    sources = sorted(
        p for p in SOURCE_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in SOURCE_EXTS
    )
    if not sources:
        print(f"No source images found in {SOURCE_DIR}")
        return

    for src_path in sources:
        src = Image.open(src_path)
        print(f"\nSource: {src_path.name}  {src.size[0]}x{src.size[1]} px, format={src.format}, mode={src.mode}")

        # Force RGB. App Store Connect rejects images with alpha channels
        # for screenshots.
        if src.mode != "RGB":
            src = src.convert("RGB")

        stem = src_path.stem
        for name, w, h in TARGETS:
            out = fit_to_canvas(src, w, h)
            out_path = OUT_DIR / f"{stem}_{name}_{w}x{h}.png"
            out.save(out_path, format="PNG", optimize=True)
            print(f"  wrote {out_path.name}  ({w}x{h})")

    print(f"\nDone. Files in: {OUT_DIR}")


if __name__ == "__main__":
    main()
