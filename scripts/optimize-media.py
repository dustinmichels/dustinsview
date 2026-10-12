import os
import glob
import subprocess
import hashlib
import json

def get_hash_and_size(filepath):
    h = hashlib.sha256()
    size = os.path.getsize(filepath)
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest(), size

# 1. Images to optimize
# Targets: large original photos (>500KB JPEG)
# Strategy: auto-orient, max bounding box 2048x2048, strip EXIF metadata, quality 82
# Visual loss: imperceptible at 2048px on web displays.
images_to_optimize = [
    'public/media/2016/11/IMG_2599.jpg',
    'public/media/2016/07/food.jpg',
    'public/media/2016/01/IMG_0188.jpg',
    'public/media/2015/09/IMG_2777-3.jpg',
    'public/media/2016/09/walking.jpg',
    'public/media/2015/09/IMG_20160730_152131.jpg',
    'public/media/2015/09/guitar.jpg',
    'public/media/2016/11/bike-1.jpg',
    'public/media/2015/10/P1020091.jpg',
    'public/media/2016/06/20160618_180149.jpg',
    'public/media/2016/06/houses_on_canal.jpg',
    'public/media/2016/06/bernie.jpg',
    'public/media/2016/08/Amsterdam_Gay_Pride_2004_Canal_parade_-009.jpg',
    'public/media/2016/08/london_pic.jpg',
    'public/media/2016/08/appeal_to_tourists.jpg',
    'public/media/2017/06/clock.jpg',
    'public/media/2017/03/16005864174_3f50481d81_k.jpg',
    'public/media/2016/01/hobart.jpg',
    'public/media/2016/04/fart.jpg'
]

# 2. Videos to optimize
# Screen recordings & presentations: H.264 CRF 24, preset medium, AAC 128k, faststart
# Preserves resolution and sharpness of UI text/slides.
videos_to_optimize = [
    'public/media/2016/06/Bernie-Sanders-The-President-We-Need.mp4',
    'public/media/2017/05/dylan-web-scraping.m4v',
    'public/media/2017/05/web-scraping.m4v',
    'public/media/2017/04/web-scraping.mp4',
]

print("=== Optimizing Images ===")
total_img_orig = 0
total_img_new = 0

for img in images_to_optimize:
    if not os.path.exists(img):
        print(f"Skipping missing: {img}")
        continue
    orig_sz = os.path.getsize(img)
    total_img_orig += orig_sz
    tmp = img + ".tmp.jpg"
    subprocess.run(['magick', img, '-auto-orient', '-resize', '2048x2048>', '-strip', '-quality', '82', tmp], check=True)
    new_sz = os.path.getsize(tmp)
    total_img_new += new_sz
    os.replace(tmp, img)
    print(f"{os.path.basename(img):45s} | {orig_sz/1024:7.1f} KB -> {new_sz/1024:7.1f} KB ({(1-new_sz/orig_sz)*100:4.1f}% saved)")

print(f"\nImage optimization complete: {total_img_orig/(1024*1024):.2f} MB -> {total_img_new/(1024*1024):.2f} MB (saved {(total_img_orig-total_img_new)/(1024*1024):.2f} MB)\n")

print("=== Optimizing Videos ===")
total_vid_orig = 0
total_vid_new = 0

for vid in videos_to_optimize:
    if not os.path.exists(vid):
        print(f"Skipping missing: {vid}")
        continue
    orig_sz = os.path.getsize(vid)
    total_vid_orig += orig_sz
    ext = os.path.splitext(vid)[1]
    tmp = vid + ".tmp" + ext
    cmd = [
        'ffmpeg', '-y', '-i', vid,
        '-c:v', 'libx264', '-crf', '24', '-preset', 'medium',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        tmp
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    new_sz = os.path.getsize(tmp)
    total_vid_new += new_sz
    os.replace(tmp, vid)
    print(f"{os.path.basename(vid):45s} | {orig_sz/(1024*1024):7.2f} MB -> {new_sz/(1024*1024):7.2f} MB ({(1-new_sz/orig_sz)*100:4.1f}% saved)")

print(f"\nVideo optimization complete: {total_vid_orig/(1024*1024):.2f} MB -> {total_vid_new/(1024*1024):.2f} MB (saved {(total_vid_orig-total_vid_new)/(1024*1024):.2f} MB)\n")

# Update mediaManifest.json
manifest_path = "src/_data/mediaManifest.json"
if os.path.exists(manifest_path):
    print("=== Updating src/_data/mediaManifest.json ===")
    with open(manifest_path, "r") as f:
        manifest = json.load(f)
    
    updated_count = 0
    total_bytes = 0
    for asset in manifest["assets"]:
        fp = asset["filePath"]
        if os.path.exists(fp):
            h, sz = get_hash_and_size(fp)
            if asset.get("fileSize") != sz or asset.get("sha256") != h:
                asset["fileSize"] = sz
                asset["sha256"] = h
                updated_count += 1
            total_bytes += sz
        else:
            total_bytes += asset.get("fileSize", 0)
    
    manifest["totalBytes"] = total_bytes
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"Updated {updated_count} entries in mediaManifest.json. Total bytes now: {total_bytes/(1024*1024):.2f} MB")

