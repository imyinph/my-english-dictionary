"""Regenerate the prototype's code-drawn book icons (optional: Python + Pillow).

The checked-in PNGs are build inputs; Python is not needed to run the app.
"""
from pathlib import Path
from PIL import Image, ImageDraw

output = Path(__file__).resolve().parent.parent / "public" / "icons"
output.mkdir(parents=True, exist_ok=True)
for filename, size, maskable in [
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("icon-maskable-512.png", 512, True),
    ("apple-touch-icon.png", 180, True),
]:
    canvas = Image.new("RGB", (1024, 1024), "#234c3d")
    draw = ImageDraw.Draw(canvas)
    ink = "#f7f6f0"
    # Essential content stays in the centre safe zone of the maskable icon.
    draw.line([(285, 320), (445, 320), (512, 355), (579, 320),
               (739, 320), (739, 690), (579, 690), (512, 725),
               (445, 690), (285, 690), (285, 320)], fill=ink, width=34, joint="curve")
    draw.line([(512, 355), (512, 717)], fill=ink, width=28)
    for left in [345, 579]:
        for top in [430, 520]:
            draw.line([(left, top), (left + 100, top)], fill=ink, width=25)
    canvas.resize((size, size), Image.Resampling.LANCZOS).save(output / filename)
    print(filename, f"{size}x{size}")
