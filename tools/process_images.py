"""Turn the raw photos/screenshots into fast responsive AVIF + WebP files and the Open Graph card.
python3 tools/process_images.py      (writes src/assets/img/* and src/assets/img/manifest.json)
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, '..', 'raw-images')
OUT = os.path.join(HERE, '..', 'src', 'assets', 'img')
os.makedirs(OUT, exist_ok=True)

# slug: (source, widths, kind)  kind = photo | ui
IMAGES = {
    'boutique-owner-reading-whatsapp-order': ('hero_11.png', [640, 960, 1344], 'photo'),
    'support-team-shared-whatsapp-inbox': ('team_5.png', [640, 960, 1344], 'photo'),
    'bakery-owner-packing-whatsapp-order': ('bakery_3.png', [480, 768, 1024], 'photo'),
    'property-consultant-on-phone': ('realestate_14.png', [480, 768, 1024], 'photo'),
    'tutor-replying-to-parents': ('tutor_4.png', [480, 768, 1024], 'photo'),
    'marketing-agency-client-campaigns': ('agency_6.png', [480, 768, 1024], 'photo'),
    'wabridge-dashboard-on-laptop': ('laptop_wabridge.png', [640, 960, 1344], 'photo'),
    'customer-success-manager': ('support_9.png', [480, 720, 896], 'photo'),
    'app-overview': ('app/app-overview.png', [720, 1200, 1800, 2400], 'ui'),
    'app-inbox': ('app/app-inbox.png', [720, 1200, 1800, 2400], 'ui'),
    'app-campaign': ('app/app-campaign.png', [720, 1200, 1800, 2400], 'ui'),
    'app-campaign-editor': ('app/app-campaign-editor.png', [720, 1200, 1800, 2400], 'ui'),
    'app-automations': ('app/app-automations.png', [720, 1200, 1800, 2400], 'ui'),
    'app-contacts': ('app/app-contacts.png', [720, 1200, 1800, 2400], 'ui'),
    'app-numbers': ('app/app-numbers.png', [720, 1200, 1800, 2400], 'ui'),
    'app-inbox-mobile': ('app/app-inbox-mobile.png', [400, 800, 1170], 'ui'),
}

manifest = {}
OG_ONLY = '--og-only' in sys.argv
for slug, (src, widths, kind) in ({} if OG_ONLY else IMAGES).items():
    path = os.path.join(RAW, src)
    if not os.path.exists(path):
        print('missing', src)
        continue
    im = Image.open(path).convert('RGB')
    widths = [w for w in widths if w <= im.width] or [im.width]
    for w in widths:
        h = round(im.height * w / im.width)
        r = im.resize((w, h), Image.Resampling.LANCZOS)
        if kind == 'ui':
            r.save(os.path.join(OUT, f'{slug}-{w}.webp'), quality=86, method=6)
            r.save(os.path.join(OUT, f'{slug}-{w}.avif'), quality=74, speed=5)
        else:
            r.save(os.path.join(OUT, f'{slug}-{w}.webp'), quality=78, method=6)
            r.save(os.path.join(OUT, f'{slug}-{w}.avif'), quality=58, speed=5)
    manifest[slug] = {'width': im.width, 'height': im.height, 'widths': widths}
    print(slug, widths)

# ---- Open Graph card 1200x630 ----
bg = Image.open(os.path.join(RAW, 'og_12.png')).convert('RGB').resize((1200, 629)).crop((0, 0, 1200, 629))
og = Image.new('RGB', (1200, 630), (242, 250, 245)); og.paste(bg, (0, 0))
veil = Image.new('RGBA', (1200, 630), (242, 250, 245, 120)); og = Image.alpha_composite(og.convert('RGBA'), veil)
shot = Image.open(os.path.join(RAW, 'app/app-inbox.png')).convert('RGB').resize((640, 400), Image.Resampling.LANCZOS)
mask = Image.new('L', shot.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, *shot.size), 18, fill=255)
shadow = Image.new('RGBA', (700, 460), (0, 0, 0, 0)); ImageDraw.Draw(shadow).rounded_rectangle((30, 40, 670, 440), 22, fill=(6, 78, 59, 90))
shadow = shadow.filter(ImageFilter.GaussianBlur(18)); og.alpha_composite(shadow, (600, 150))
og.paste(shot, (630, 170), mask)
logo = Image.open(os.path.join(OUT, 'logo-512.png')).convert('RGBA').resize((132, 132), Image.Resampling.LANCZOS)
og.alpha_composite(logo, (64, 70))
fdir = os.path.expanduser('~/Library/Fonts')
def font(w, size):
    for name in (f'dm sans-{w}.ttf', 'dm sans-700.ttf', 'dm sans-600.ttf'):
        p = os.path.join(fdir, name)
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()
d = ImageDraw.Draw(og)
d.text((72, 230), 'WaBridge', font=font(800, 76), fill=(11, 42, 32))
lines = ['Self-hosted WhatsApp', 'team inbox, safe campaigns', '& AI replies']
for i, t in enumerate(lines):
    d.text((74, 330 + i * 46), t, font=font(500, 34), fill=(36, 70, 58))
d.rounded_rectangle((74, 492, 474, 548), 28, fill=(5, 150, 105))
d.text((98, 504), 'Link by QR · No Meta App ID', font=font(600, 25), fill=(255, 255, 255))
og.convert('RGB').save(os.path.join(OUT, 'og-wabridge.jpg'), quality=86, optimize=True, progressive=True)
print('og ok')

if not OG_ONLY:
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
print('manifest', len(manifest))
