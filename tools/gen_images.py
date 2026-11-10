"""Realistic photos + 3D logo for the WaBridge site, generated locally with FLUX.2 klein 4B (free, offline).
Run: <fluxenv>/bin/python tools/gen_images.py [name ...]   (HF_HUB_OFFLINE=1)
"""
import glob, os, sys, time
from mflux.models.common.config.model_config import AVAILABLE_MODELS
from mflux.models.common.resolution.config_resolution import ConfigResolution
from mflux.models.flux2.variants import Flux2Klein

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "raw-images")
SNAP = glob.glob(os.path.expanduser("~/.cache/huggingface/hub/models--Runpod--FLUX.2-klein-4B-mflux-4bit/snapshots/*"))[0]

PHOTO = ("photorealistic editorial photograph, natural soft daylight, airy bright mint green and white colour palette, "
         "shallow depth of field, 50mm lens, high detail, no text, no logos")

PLATES = {
    "logo": (1024, 1024, [7, 21, 33],
             "3D app icon render: a rounded square tile made of frosted mint green glass with soft inner glow, a glossy "
             "white arched suspension bridge with two small towers embossed in the centre, a tiny white speech bubble "
             "dot above the arch, soft studio lighting, subtle reflections, gentle soft shadow underneath, centred on a "
             "pure white background, clean premium product render, high detail"),
    "hero": (1344, 896, [11, 27],
             "A smiling young Indian woman boutique owner standing in her bright modern clothing store, holding a "
             "smartphone and reading a message on it, mint green plants and pastel shelves softly blurred behind her, "
             + PHOTO),
    "team": (1344, 896, [5, 19],
             "A small customer support team of three young Indian professionals working at laptops at a long white desk "
             "in a bright modern office with glass partitions and green plants, one woman wearing a headset smiling, "
             + PHOTO),
    "bakery": (1024, 1024, [3],
               "A cheerful Indian bakery owner in an apron behind a white counter packing cupcakes into a paper box, a "
               "smartphone resting on the counter, mint green tiled wall behind, " + PHOTO),
    "realestate": (1024, 1024, [14, 22],
                   "A young Indian property consultant in a crisp light blue shirt standing in a bright empty modern "
                   "apartment living room with large windows and a city view, smiling while talking on a smartphone held "
                   "to his ear, a tall potted plant in the corner, " + PHOTO),
    "tutor": (1024, 1024, [4],
              "An Indian teacher sitting at a light wooden desk in a bright coaching classroom with plants, smiling while "
              "typing on a smartphone, a laptop and notebooks on the desk, " + PHOTO),
    "agency": (1024, 1024, [6],
               "Two young Indian digital marketers discussing ideas beside a large monitor in a bright creative studio "
               "with green plants and white walls, the screen softly blurred, " + PHOTO),
    "laptop": (1344, 896, [2],
               "A modern silver laptop open on a light oak desk in a bright home office, the screen softly blurred and "
               "glowing, a smartphone lying beside it, a small potted plant and a cup of tea, morning sunlight, " + PHOTO),
    "support": (896, 1152, [9],
                "Portrait of a friendly young Indian customer success manager wearing a light headset, smiling at the "
                "camera in a bright office with a soft mint green wall and plants, " + PHOTO),
    "og": (1344, 704, [12],
           "Abstract soft background of layered frosted glass panels in pale mint green and white, gentle light "
           "gradients and soft glowing curves, minimal, clean, premium, no text"),
}

def main():
    names = sys.argv[1:] or list(PLATES)
    os.makedirs(OUT, exist_ok=True)
    keys = tuple(k for k in AVAILABLE_MODELS if k.startswith("flux2-") and k != "flux2-klein-4b")
    cfg = ConfigResolution.resolve_restricted("flux2-klein-4b", "flux2-klein-4b", model_path=SNAP, extra_keys=keys)
    model = Flux2Klein(model_config=cfg, quantize=None, model_path=SNAP)
    for n in names:
        w, h, seeds, prompt = PLATES[n]
        for s in seeds:
            path = os.path.join(OUT, f"{n}_{s}.png")
            if os.path.exists(path):
                continue
            t0 = time.time()
            img = model.generate_image(seed=s, prompt=prompt, width=w, height=h, num_inference_steps=4)
            img.save(path=path, export_json_metadata=False)
            print(f"{n} seed {s}: {time.time() - t0:.0f}s", flush=True)

if __name__ == "__main__":
    main()
