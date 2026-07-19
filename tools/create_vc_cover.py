from pathlib import Path
import math

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SRC = Path(
    r"C:\Users\User\.codex\generated_images\019e8430-e403-7913-bf31-28e4ca47b1f4"
    r"\ig_016fd8c534d12536016a1dbf10ca048191aa2fab74a7dd033d.png"
)
OUT_DIR = ROOT / "assets" / "vc-cover"
OUT = OUT_DIR / "comment-max-vc-cover-2560x800.png"
OUT_SMALL = OUT_DIR / "comment-max-vc-cover-1280x400.png"
SOURCE_COPY = OUT_DIR / "comment-max-vc-cover-background.png"

W, H = 2560, 800


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    base = Image.new("RGB", (W, H), "#070b15")
    pix = base.load()
    for y in range(H):
        for x in range(W):
            t = x / (W - 1)
            glow = math.exp(-((x - 620) ** 2 / (2 * 520**2) + (y - 470) ** 2 / (2 * 340**2)))
            pix[x, y] = (
                int(7 + 5 * t + 9 * glow),
                int(11 + 11 * t + 18 * glow),
                int(21 + 28 * t + 40 * glow),
            )

    img = Image.open(SRC).convert("RGB")
    scale = H / img.height
    resized = img.resize((int(img.width * scale), H), Image.Resampling.LANCZOS)
    base.paste(resized, (W - resized.width + 10, 0))

    shade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    for x in range(W):
        if x < 1220:
            alpha = int(150 * (1 - x / 1220) + 40)
        elif x < 1650:
            alpha = int(40 * (1 - (x - 1220) / 430))
        else:
            alpha = 0
        sd.line([(x, 0), (x, H)], fill=(4, 8, 16, max(0, min(190, alpha))))
    base = Image.alpha_composite(base.convert("RGBA"), shade)

    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    points = [(110, 640), (270, 640), (360, 604), (500, 604), (610, 575), (760, 575), (860, 540)]
    d.line(points, fill=(64, 196, 255, 105), width=3)
    for px, py in points:
        d.ellipse((px - 5, py - 5, px + 5, py + 5), fill=(82, 207, 255, 180))
    for x, y, w, h, a in [
        (108, 105, 74, 74, 50),
        (205, 105, 74, 74, 25),
        (110, 195, 156, 44, 40),
        (278, 195, 74, 44, 22),
    ]:
        d.rounded_rectangle(
            (x, y, x + w, y + h),
            radius=14,
            fill=(42, 74, 110, a),
            outline=(100, 190, 255, a + 24),
            width=1,
        )
    base = Image.alpha_composite(base, layer.filter(ImageFilter.GaussianBlur(0.2)))

    draw = ImageDraw.Draw(base)
    font_bold = font(r"C:\Windows\Fonts\segoeuib.ttf", 114)
    font_semibold = font(r"C:\Windows\Fonts\segoeuib.ttf", 54)
    font_regular = font(r"C:\Windows\Fonts\segoeui.ttf", 36)
    font_small = font(r"C:\Windows\Fonts\segoeui.ttf", 30)

    x, y = 108, 270
    accent = (75, 205, 255, 255)
    white = (246, 250, 255, 255)
    muted = (179, 196, 216, 255)

    draw.rounded_rectangle((x, y - 92, x + 370, y - 38), radius=27, fill=(28, 69, 106, 150), outline=(88, 207, 255, 120), width=1)
    draw.text((x + 26, y - 84), "MINI APP ДЛЯ MAX", font=font_small, fill=(195, 235, 255, 255))

    headline = "Comment"
    draw.text((x, y), headline, font=font_bold, fill=white)
    w1 = draw.textbbox((0, 0), headline, font=font_bold)[2]
    draw.text((x + w1 + 8, y), " MAX", font=font_bold, fill=accent)

    sub_y = y + 138
    draw.text((x, sub_y), "Комментарии для MAX-каналов", font=font_semibold, fill=white)
    body_y = sub_y + 82
    draw.text((x, body_y), "Обсуждения, модерация, уведомления и аналитика", font=font_regular, fill=muted)
    draw.text((x, body_y + 50), "в одном рабочем интерфейсе.", font=font_regular, fill=muted)

    chip_y = 672
    cx = x
    for label in ["Комментарии", "Реакции", "Модерация", "Аналитика"]:
        bbox = draw.textbbox((0, 0), label, font=font_small)
        tw = bbox[2] - bbox[0]
        draw.rounded_rectangle((cx, chip_y, cx + tw + 42, chip_y + 48), radius=24, fill=(13, 25, 43, 180), outline=(75, 205, 255, 70), width=1)
        draw.text((cx + 21, chip_y + 7), label, font=font_small, fill=(212, 226, 242, 255))
        cx += tw + 60

    final = base.convert("RGB")
    final.save(OUT, quality=95, optimize=True)
    final.resize((1280, 400), Image.Resampling.LANCZOS).save(OUT_SMALL, quality=95, optimize=True)
    Image.open(SRC).save(SOURCE_COPY)
    print(OUT)
    print(OUT_SMALL)
    print(SOURCE_COPY)


if __name__ == "__main__":
    main()
