"""Generate pitch-preserving Polly speed variants offline, or verify a release without FFmpeg."""
import argparse
import hashlib
import json
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "content/audio-rates-v1.json"
SPEEDS = (50, 75, 125)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def process(resource, directory, index, ffmpeg):
    source = directory / resource["asset"]["path"]
    if digest(source.read_bytes()) != resource["asset"]["sha256"]:
        raise ValueError(f"Original audio changed: {source}")
    voice = resource["voice"].lower()
    hashes = {}
    if ffmpeg:
        # Count decoded samples so padded tempo processing includes the last syllable.
        pcm = subprocess.check_output([ffmpeg, "-v", "error", "-i", str(source), "-ac", "1", "-ar", "24000", "-f", "s16le", "-"])
    for percent in SPEEDS:
        folder = directory / "audio/rates" / voice / str(percent)
        if ffmpeg:
            count = round(len(pcm) / 2 * 100 / percent)
            filters = f"apad=pad_dur=0.25,atempo={percent / 100},atrim=end_sample={count}"
            data = subprocess.check_output([ffmpeg, "-v", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "-", "-af", filters, "-codec:a", "libmp3lame", "-b:a", "64k", "-f", "mp3", "-"], input=pcm)
            sha = digest(data)
            folder.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=folder, delete=False) as out:
                out.write(data)
            Path(out.name).replace(folder / (sha + ".mp3"))
        else:
            sha = index[resource["id"]][str(percent)]
            if digest((folder / (sha + ".mp3")).read_bytes()) != sha:
                raise ValueError(f"Invalid speed variant: {resource['id']} at {percent}%")
        hashes[str(percent)] = sha
    return resource["id"], hashes

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg", help="Generate from original MP3 files using this FFmpeg executable")
    parser.add_argument("--dist", action="store_true")
    args = parser.parse_args()
    if args.dist and args.ffmpeg:
        parser.error("Generate in public before building")
    directory = ROOT / ("dist" if args.dist else "public")
    resources = json.loads((directory / "data/audio-manifest.json").read_text("utf8"))["resources"]
    index = {} if args.ffmpeg else json.loads(INDEX.read_text("utf8"))
    with ThreadPoolExecutor(max_workers=4) as pool:
        result = dict(pool.map(lambda r: process(r, directory, index, args.ffmpeg), resources))
    if args.ffmpeg:
        tmp = INDEX.with_suffix(".tmp")
        tmp.write_text(json.dumps(result, indent=2) + "\n", "utf8")
        tmp.replace(INDEX)
    elif result != index:
        raise ValueError("Speed variants do not match production resources")
    print(f"{len(result)} originals, {len(result) * len(SPEEDS)} speed variants")

if __name__ == "__main__":
    main()
