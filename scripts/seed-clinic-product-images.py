"""
One-shot seeder: generate catalogue thumbnails for clinic inventory products
and upload them to the product-images bucket. Does not invent brand packaging;
creates clean per-product tiles so the Flipkart-style catalogue has images.
Safe to re-run: upserts files and updates image_path only when empty or when
--force is passed.
"""

from __future__ import annotations

import argparse
import sys
import uuid
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

try:
    from supabase import create_client
except ImportError:
    create_client = None  # type: ignore

ROOT = Path(__file__).resolve().parents[1]
ORG = "60584727-8073-4d7e-8a80-51828db08381"
WS = "8d5ecf49-2ebc-4500-8b9e-65ae411bcf7b"

CATEGORY_THEME = {
    "Face Wash & Cleansers": ((232, 245, 250), (14, 116, 144), "cleanser"),
    "Moisturizers": ((240, 249, 255), (37, 99, 235), "jar"),
    "Sunscreens": ((255, 251, 235), (217, 119, 6), "tube"),
    "Serums": ((245, 243, 255), (109, 40, 217), "dropper"),
    "Night Creams & Skin-Care": ((253, 242, 248), (190, 24, 93), "jar"),
    "Hair Care": ((236, 253, 245), (5, 150, 105), "bottle"),
    "Foot Care": ((255, 247, 237), (194, 65, 12), "tube"),
}

SKU_CATEGORY = {
    "CLN-FW": "Face Wash & Cleansers",
    "CLN-MZ": "Moisturizers",
    "CLN-SS": "Sunscreens",
    "CLN-SR": "Serums",
    "CLN-NC": "Night Creams & Skin-Care",
    "CLN-HC": "Hair Care",
    "CLN-FC": "Foot Care",
}


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for name in (".env", ".env.local"):
        path = ROOT / name
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def wrap_text(text: str, max_chars: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        trial = f"{current} {word}".strip()
        if len(trial) <= max_chars:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines[:3]


def draw_silhouette(draw: ImageDraw.ImageDraw, kind: str, accent: tuple[int, int, int], cx: int, cy: int) -> None:
    soft = (*accent, 40)
    fill = (*accent, 210)
    if kind == "dropper":
        draw.rounded_rectangle((cx - 18, cy - 70, cx + 18, cy + 55), radius=10, fill=fill)
        draw.ellipse((cx - 28, cy - 95, cx + 28, cy - 55), fill=accent)
        draw.rectangle((cx - 6, cy - 110, cx + 6, cy - 90), fill=accent)
    elif kind == "jar":
        draw.rounded_rectangle((cx - 48, cy - 35, cx + 48, cy + 55), radius=16, fill=fill)
        draw.rounded_rectangle((cx - 36, cy - 58, cx + 36, cy - 28), radius=8, fill=accent)
    elif kind == "tube":
        draw.rounded_rectangle((cx - 22, cy - 70, cx + 22, cy + 60), radius=12, fill=fill)
        draw.polygon([(cx - 22, cy - 70), (cx + 22, cy - 70), (cx + 12, cy - 95), (cx - 12, cy - 95)], fill=accent)
    elif kind == "cleanser":
        draw.rounded_rectangle((cx - 28, cy - 55, cx + 28, cy + 60), radius=18, fill=fill)
        draw.ellipse((cx - 16, cy - 85, cx + 16, cy - 50), fill=accent)
    else:  # bottle
        draw.rounded_rectangle((cx - 30, cy - 50, cx + 30, cy + 60), radius=14, fill=fill)
        draw.rectangle((cx - 14, cy - 85, cx + 14, cy - 48), fill=accent)
        draw.rounded_rectangle((cx - 18, cy - 100, cx + 18, cy - 82), radius=4, fill=accent)
    draw.ellipse((cx - 90, cy + 70, cx + 90, cy + 95), fill=soft)


def render_tile(name: str, sku: str, category: str) -> bytes:
    theme = CATEGORY_THEME.get(category, ((248, 250, 252), (71, 85, 105), "bottle"))
    bg, accent, kind = theme
    img = Image.new("RGB", (640, 640), bg)
    draw = ImageDraw.Draw(img, "RGBA")

    # soft corner wash
    draw.ellipse((-80, -120, 320, 280), fill=(*accent, 28))
    draw.ellipse((380, 420, 760, 780), fill=(*accent, 22))

    draw_silhouette(draw, kind, accent, 320, 250)

    try:
        title_font = ImageFont.truetype("arial.ttf", 34)
        meta_font = ImageFont.truetype("arial.ttf", 18)
        badge_font = ImageFont.truetype("arialbd.ttf", 16)
    except OSError:
        title_font = ImageFont.load_default()
        meta_font = title_font
        badge_font = title_font

    badge = category.split("&")[0].strip()
    badge = badge if len(badge) < 22 else badge[:20] + "…"
    bw = draw.textlength(badge, font=badge_font)
    draw.rounded_rectangle((40, 40, 40 + bw + 28, 78), radius=999, fill=(*accent, 235))
    draw.text((54, 50), badge, fill=(255, 255, 255), font=badge_font)

    lines = wrap_text(name, 22)
    y = 430
    for line in lines:
        tw = draw.textlength(line, font=title_font)
        draw.text(((640 - tw) / 2, y), line, fill=(15, 23, 42), font=title_font)
        y += 42

    draw.text((40, 590), sku, fill=(100, 116, 139), font=meta_font)

    out = BytesIO()
    img.convert("RGB").save(out, format="JPEG", quality=88, optimize=True)
    return out.getvalue()


def category_for(sku: str, db_category: str | None) -> str:
    prefix = "-".join(sku.split("-")[:2]) if sku else ""
    return SKU_CATEGORY.get(prefix) or db_category or "Night Creams & Skin-Care"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Replace existing product images")
    args = parser.parse_args()

    env = load_env()
    url = env.get("SUPABASE_URL") or env.get("VITE_SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env", file=sys.stderr)
        return 1

    if create_client is None:
        print("pip install supabase", file=sys.stderr)
        return 1

    sb = create_client(url, key)
    result = (
        sb.table("inventory_products")
        .select("id, name, sku, category, image_path, organization_id, workspace_id")
        .eq("workspace_id", WS)
        .is_("deleted_at", "null")
        .order("sku")
        .execute()
    )
    products = result.data or []
    if len(products) != 44:
        print(f"Expected 44 clinic products, found {len(products)}")

    uploaded = 0
    skipped = 0
    failed = 0

    for product in products:
        existing = (product.get("image_path") or "").strip()
        if existing and not args.force:
            skipped += 1
            continue

        sku = product["sku"] or "UNKNOWN"
        name = product["name"]
        category = category_for(sku, product.get("category"))
        jpeg = render_tile(name, sku, category)
        path = f"{product['organization_id']}/{product['workspace_id']}/{product['id']}/{uuid.uuid4().hex}.jpg"

        try:
            sb.storage.from_("product-images").upload(
                path,
                jpeg,
                file_options={"content-type": "image/jpeg", "upsert": "true"},
            )
            sb.table("inventory_products").update({"image_path": path}).eq("id", product["id"]).execute()
            uploaded += 1
            print(f"OK  {sku}  {name}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"FAIL {sku}  {exc}", file=sys.stderr)

    print(f"\nDone. uploaded={uploaded} skipped={skipped} failed={failed}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
