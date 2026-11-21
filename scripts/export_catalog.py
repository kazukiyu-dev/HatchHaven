"""Refresh the website's public catalogue from the HatchHaven v8 release archive.

Run: python scripts/export_catalog.py /path/to/HatchHaven.zip
Python 3.10+ and Pillow with WebP support are required only for regenerating assets.
Only named game artwork and literal catalogue fields are read. Bot code is never run.
"""

import argparse
import ast
from collections import Counter
import hashlib
from io import BytesIO
import json
from pathlib import Path
import tempfile
from zipfile import ZipFile

from PIL import Image, ImageDraw

PUBLIC = Path(__file__).resolve().parents[1] / "public"
BASE = "/assets/catalog"
FIELDS = set("""
    CATALOG_VERSION RARITIES HATCH_SECONDS RANKS RANK_COSTS SPAWN_WEIGHTS
    WEEKEND_SPAWN_MULTIPLIER EGG_DESIGNS REWARD_EGGS COSMETICS ITEM_FAMILIES
    NAMES LORE COMMON_NAMES COMMON_LORE RARE_NAMES EPIC_NAMES NEW_LORE
    RARE_ADDITIONS EPIC_ADDITIONS EXPANSION_LORE LEGENDARY_NAMES LEGENDARY_LORE
    MYTHIC_NAMES MYTHIC_LORE CELESTIAL_SPECIES DIVINE_SPECIES ETERNAL_SPECIES
""".split())
# Digest of the AST for the v8 loops/formulas used below. Literal name, lore,
# price and rarity tables can change without changing this fingerprint.
RULES_SHA256 = "276fd12151dcfc76ba1aa8e1445675c00ab920c8ab0979888081de4baf83361b"

EGG_LORE = [
    "A plain white shell with soft grey shading. A familiar farm or woodland animal waits inside.",
    "A smooth blue shell holds one of the haven’s small fantasy creatures.",
    "Silver bands cross a violet shell around a sapphire at its centre.",
    "Bright runes trace the dark purple surface of this egg.",
    "Golden filigree curls around an amber-coloured shell.",
    "A deep red shell surrounds a ruby, with fiery markings across its surface.",
    "A tiny starfield crosses the navy shell, encircled by a luminous orbit.",
    "Golden wings and a halo frame this ivory egg.",
    "Prismatic cracks and an orbit of light break across an obsidian shell.",
]

COSMETIC_INFO = {
    "Meadow": ("Background", "A sunny farm with a windmill, a barn and a broad oak. Every new collector starts with Meadow."),
    "Midnight": ("Background", "A lantern-lit cottage in the midnight woods for your haven’s backdrop."),
    "Rose": ("Background", "Pink blossom trees catch the sunset across this farm backdrop."),
    "Ocean": ("Background", "A coastal farm and lighthouse look out over turquoise water."),
    "Gold frame": ("Frame", "Equip a gold border around your collector profile."),
    "Star badge": ("Badge", "Add the golden Star Collector badge to your profile."),
    "Bloom nameplate": ("Nameplate", "A pink blossom-coloured accent runs beneath your profile name."),
}


def read_member(archive, name, limit=3_000_000):
    entry = archive.getinfo(name)
    if entry.file_size > limit:
        raise ValueError(f"Unexpected uncompressed size for {name}.")
    return archive.read(entry)


def public_config(archive):
    tree = ast.parse(read_member(archive, "config.py", 256_000))
    fields = {}
    rules = []
    for n in tree.body:
        if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name):
            key = n.targets[0].id
            if key in FIELDS:
                fields[key] = ast.literal_eval(n.value)
            elif key == "CREATURES":
                rules.append(n)
        elif isinstance(n, (ast.For, ast.AugAssign)):
            rules.append(n)
        elif isinstance(n, ast.FunctionDef) and n.name == "income_bounds":
            rules.append(n)
    # Source-segment text with whitespace/comments removed is stable across supported
    # Python versions, unlike AST dumps which can add fields between releases.
    import io
    import tokenize
    import token
    source = read_member(archive, "config.py", 256_000).decode("utf-8")
    tokens = []
    for rule in rules:
        segment = ast.get_source_segment(source, rule)
        for t in tokenize.generate_tokens(io.StringIO(segment).readline):
            if t.type in (token.NAME, token.NUMBER, token.STRING, token.OP):
                tokens.append((t.type, t.string))
    fingerprint = hashlib.sha256(json.dumps(tokens, separators=(",", ":")).encode()).hexdigest()
    if FIELDS - fields.keys() or fields.get("CATALOG_VERSION") != 8 or fingerprint != RULES_SHA256:
        raise ValueError("This release changed its catalogue schema or pricing rules. Update the v8 exporter first.")
    return fields


def creatures_for(c):
    result = []

    def add(tier, name, lore, weight, sale, income):
        species = len(result)
        result.append({
            "id": species, "name": name, "rarity": c["RARITIES"][tier], "tier": tier,
            "description": lore, "image": f"{BASE}/creatures/{species}.webp",
            "sale": sale, "incomeMin": max(1, (85 * income + 50) // 100),
            "incomeMax": (125 * income + 50) // 100, "weight": weight,
        })

    for i, (name, lore) in enumerate(zip(c["NAMES"], c["LORE"], strict=True)):
        add(1, name, lore, 30-i, 100+10*i, 30+3*i)
    for i, (name, lore) in enumerate(zip(c["COMMON_NAMES"], c["COMMON_LORE"], strict=True)):
        add(0, name, lore, 30-i, 100+5*i, 30+2*i)
    for i, (name, lore) in enumerate(zip(c["RARE_NAMES"] + c["EPIC_NAMES"], c["NEW_LORE"], strict=True)):
        tier, pos = (2 if i < 5 else 3), i % 5
        add(tier, name, lore, 30-pos, (500 if tier == 2 else 1500)+100*pos, (150 if tier == 2 else 350)+25*pos)
    for i, (name, lore) in enumerate(zip(c["RARE_ADDITIONS"] + c["EPIC_ADDITIONS"], c["EXPANSION_LORE"], strict=True)):
        tier, pos = (2 if i < 20 else 3), 5 + i % 20
        add(tier, name, lore, 30-pos, (500 if tier == 2 else 1500)+20*pos, (150 if tier == 2 else 350)+5*pos)
    for tier, stem, base_sale, base_income in [(4, "LEGENDARY", 5000, 800), (5, "MYTHIC", 15000, 1800)]:
        for i, (name, lore) in enumerate(zip(c[stem + "_NAMES"], c[stem + "_LORE"], strict=True)):
            add(tier, name, lore, 30-i, base_sale+100*i, base_income+20*i)
    for tier, stem, sale, step, income, rate_step in [
        (6, "CELESTIAL", 45000, 350, 4000, 40),
        (7, "DIVINE", 135000, 1000, 8000, 80),
        (8, "ETERNAL", 450000, 5000, 28000, 400),
    ]:
        for i, (name, lore) in enumerate(c[stem + "_SPECIES"]):
            add(tier, name, lore, 30 - (i//2 if tier == 8 else i), sale+step*i, income+rate_step*i)
    if Counter(s["tier"] for s in result) != {**dict.fromkeys(range(8), 25), 8: 50}:
        raise ValueError("The v8 species slots changed. Check the release IDs before exporting.")
    return result


def eggs_for(c, creatures):
    counts = Counter(s["tier"] for s in creatures)
    weights = c["SPAWN_WEIGHTS"]
    result = []
    for tier, rarity in enumerate(c["RARITIES"]):
        rank = c["RANKS"][tier]
        sources = [f"Steal a wild egg in an enabled spawn channel at {rank} rank or higher."]
        if tier == 0:
            sources.append("Use /start to receive three Common eggs when you first join the game in a server.")
        for cmd, reward_tier in c["REWARD_EGGS"].items():
            if tier == reward_tier:
                sources.append(f"Claim the /{cmd} reward chest.")
        if tier < 2:
            period = ["daily", "weekly"][tier]
            sources.append(f"Claim an egg-bearing {period} objective in /quest.")
        result.append({
            "id": tier, "name": f"{rarity} Egg", "rarity": rarity, "tier": tier,
            "description": EGG_LORE[tier], "image": f"{BASE}/eggs/{tier}.webp",
            "design": c["EGG_DESIGNS"][tier], "hatchSeconds": c["HATCH_SECONDS"][tier],
            "rank": rank, "rankCost": c["RANK_COSTS"][tier],
            "spawnPercent": 100 * weights[tier] / sum(weights), "speciesCount": counts[tier],
            "sources": sources,
        })
    return result


def slug(name):
    return name.lower().replace(" ", "-")


def items_for(c):
    result = []
    for family, kind, base, step, charges, price in c["ITEM_FAMILIES"]:
        if family not in {"Clover Charm", "Moonflower Tea", "Ember Dust", "Sunstone Heater", "Clockwork Feather"}:
            raise ValueError(f"Supply an icon for new family {family!r}.")
        for level in range(1, 11):
            power = round(base + step*(level-1), 3)
            if kind == "luck":
                description = f"Multiplies the hatch weight of less common species by {power:.2f}× for the next {charges} wild eggs you claim."
            elif kind == "speed":
                description = f"Reduces incubation time by {power:.1%} for the next {charges} eggs you start."
            else:
                description = f"Removes {power:.1%} of the remaining time from every running incubator when used."
            result.append({
                "id": f"{kind}-{len(result)+1:02}", "name": f"{family} {level}",
                "family": family, "level": level, "kind": kind, "description": description,
                "image": f"{BASE}/shop/{slug(family)}.webp", "price": price * level**2,
                "power": power, "charges": charges,
            })
    return result


def cosmetics_for(c):
    result = []
    for name, price in c["COSMETICS"].items():
        kind, description = COSMETIC_INFO[name]
        result.append({"id": slug(name), "name": name, "kind": kind,
                       "description": description, "image": f"{BASE}/shop/{slug(name)}.webp", "price": price})
    return result


def resized_sprite(archive, name, native_triples=False):
    with Image.open(BytesIO(read_member(archive, name))) as src:
        im = src.convert("RGBA")
    bounds = im.getchannel("A").getbbox()
    if not bounds:
        raise ValueError(f"Missing artwork in {name}.")
    im = im.crop(bounds)
    if native_triples and im.width % 3 == 0 and im.height % 3 == 0:
        small = im.resize((im.width//3, im.height//3), Image.Resampling.NEAREST)
        enlarged = small.resize(im.size, Image.Resampling.NEAREST)
        if enlarged.tobytes() == im.tobytes():
            return small
    return im


def export_assets(archive, root, data):
    for name in ("creatures", "eggs", "shop"):
        (root / name).mkdir(parents=True, exist_ok=True)
    for group in ("creatures", "eggs"):
        for row in data[group]:
            i = row["id"]
            sprite = resized_sprite(archive, f"assets/{group}/{i:02}.png", group == "creatures" and i >= 150)
            sprite.save(root / group / f"{i}.webp", lossless=True, method=4)
    coin = resized_sprite(archive, "assets/currency/sb_coin.png")
    coin.thumbnail((100, 100), Image.Resampling.LANCZOS)
    coin.save(root / "shop" / "shellbit.webp", quality=90, method=5)
    for item in data["cosmetics"]:
        if item["kind"] == "Background":
            with Image.open(BytesIO(read_member(archive, "assets/backgrounds/" + item["name"] + ".png"))) as scene:
                scene.resize((400, 280), Image.Resampling.BOX).save(root / "shop" / (item["id"] + ".webp"), quality=88, method=5)
    names = list(dict.fromkeys(i["family"] for i in data["items"]))
    names += [i["name"] for i in data["cosmetics"] if i["kind"] != "Background"]
    for name in names:
        shop_icon(name).save(root / "shop" / (slug(name)+".webp"), lossless=True, method=4)


def shop_icon(name):
    """Pixel portraits for the native shop glyphs and profile accessories."""
    im = Image.new("RGBA", (40, 40))
    d = ImageDraw.Draw(im)
    ink, gold, light = "#271f38", "#d69858", "#ffe4a0"

    def shape(points, fill, outline=None):
        d.polygon(points, fill=fill, outline=outline)

    def line(points, col, w=1):
        d.line(points, fill=col, width=w)

    def box(x0, y0, x1, y1, col):
        d.rectangle((x0, y0, x1, y1), fill=col)

    def star(x, y, colour):
        box(x-1, y, x+1, y, colour)
        box(x, y-1, x, y+1, colour)

    if name == "Clover Charm":
        line([(18, 22), (19, 28), (22, 32), (27, 34)], ink, 5)
        line([(18, 21), (19, 27), (23, 32), (27, 33)], "#61845e", 3)
        d.ellipse((25, 30, 33, 37), outline=ink, width=3)
        d.ellipse((26, 31, 32, 36), outline=gold, width=2)
        leaf = [(0, 1), (-3, 0), (-7,-3), (-11,-6), (-13,-11), (-12,-14), (-8,-15), (-5,-13),
                (-3,-16), (1,-16), (3,-13), (3,-10), (2,-5)]
        for rot in range(4):
            def rotate(x, y):
                for _ in range(rot):
                    x, y = -y, x
                return (18+x, 18+y)
            shape([rotate(x,y) for x,y in leaf], ["#64ae63", "#9ec965", "#57a274", "#7dbf65"][rot], ink)
            line([rotate(-8,-13), rotate(-10,-12), rotate(-10,-10)], "#cae895", 2)
            line([rotate(-7,-8), rotate(-5,-7), rotate(-1,-2)], "#4c8861")
        box(17,16,19,19,"#e2d779")
    elif name in {"Moonflower Tea", "Ember Dust"}:
        tea = name == "Moonflower Tea"
        shadow, liquid, glow = (("#426888", "#78aaa7", "#ccdb9d") if tea else ("#9f4a44", "#e78348", "#ffda78"))
        shape([(14,4),(24,4),(25,7),(25,12),(24,14),(30,19),(31,22),(31,31),(28,35),(12,35),
               (9,32),(8,29),(8,22),(10,18),(15,14),(15,10),(13,9)], ink)
        box(15,5,23,9,gold);box(16,5,21,6,light);box(15,9,23,10,"#946044")
        box(15,11,24,13,"#b6cbd2");box(17,14,22,16,"#8298a7")
        shape([(16,16),(23,16),(29,21),(29,31),(26,33),(13,33),(10,30),(10,22)], "#8aa0ae")
        shape([(11,23),(16,22),(20,23),(27,21),(29,22),(29,30),(26,33),(14,33),(11,30)], shadow)
        shape([(12,24),(17,23),(21,24),(27,22),(28,25),(25,30),(15,31),(12,29)], liquid)
        box(11,20,12,24,"#e6e8cf");box(12,18,14,19,"#e6e8cf")
        box(13,31,16,32,glow);line([(26,27),(28,25)], glow)
        if tea:
            for x,y in [(20,25),(22,24),(22,27),(19,28),(18,26)]:
                box(x,y,x+1,y+1,"#fff0cc")
            box(20,26,21,27,"#e3b66b");line([(21,28),(19,30)],"#456f65")
            star(30,10,light)
        else:
            star(20,26,glow);box(15,26,16,27,"#ffd691");box(23,29,24,30,"#ffd691")
            star(29,13,"#fda15b");box(25,17,26,18,light)
    elif name == "Sunstone Heater":
        shape([(9,8),(12,6),(27,6),(31,9),(32,11),(32,30),(29,33),(27,33),(26,36),
               (22,36),(21,33),(15,33),(14,36),(10,36),(9,33),(7,31),(7,11)], ink)
        shape([(9,11),(13,8),(27,8),(30,11),(30,29),(27,32),(11,32),(9,29)],"#8c5f57")
        box(10,11,29,13,gold);box(13,8,26,10,"#f1ca83");box(12,14,27,28,"#513646")
        box(13,15,26,27,"#bf8056");box(15,16,24,26,"#402d3b")
        shape([(16,24),(16,21),(19,20),(20,16),(22,20),(24,22),(23,25),(21,26),(18,26)],"#ff9552")
        shape([(18,24),(20,20),(20,23),(22,22),(22,25),(19,25)],light)
        box(10,28,29,29,"#cb965e");box(12,30,26,31,"#67464a")
        for x in (10,28): box(x,15,x+1,16,light)
        star(33,5,"#f3c781")
    elif name == "Clockwork Feather":
        shape([(6,33),(12,25),(10,21),(12,16),(12,12),(16,13),(16,9),(21,8),(26,4),(35,4),
               (33,10),(33,14),(29,18),(26,19),(27,21),(22,25),(16,27),(11,32),(9,35),(6,36)], ink)
        shape([(12,22),(14,16),(15,14),(16,17),(18,11),(22,10),(27,6),(32,6),(30,11),
               (31,13),(27,16),(23,17),(24,20),(20,23),(16,25)],"#7e9dad")
        shape([(15,23),(19,15),(21,13),(23,13),(28,8),(30,7),(27,13),(23,16),(20,20)],"#b5dcd8")
        line([(8,33),(15,25),(23,16),(30,10)], gold, 2);line([(10,30),(15,24),(22,17)],light)
        for x,y in [(18,16),(21,13),(27,8)]: box(x,y,x+1,y+1,"#e7edd5")
        d.ellipse((7,25,16,34), fill="#b58052", outline=ink, width=1)
        d.ellipse((9,27,14,32), fill="#4e5363", outline=light, width=1)
        box(11,29,12,30,gold)
    elif name == "Gold frame":
        box(4,8,35,32,ink);box(6,10,33,30,"#a66b49");box(7,11,32,29,"#f6d488")
        box(9,13,30,27,"#885c49");box(10,14,29,26,"#a7b2a3")
        box(11,15,28,25,"#455e62");line([(11,24),(17,18),(21,22),(25,18),(28,23)],"#73958a",2)
        for x,y in [(6,10),(30,10),(6,27),(30,27)]:
            box(x,y,x+3,y+3,"#df9b5f");box(x+1,y,x+2,y+1,light)
    elif name == "Star badge":
        shape([(12,20),(18,20),(19,24),(15,35),(12,32),(8,32)],"#9b5979",ink)
        shape([(20,21),(27,19),(31,32),(27,31),(24,35)],"#aa6a86",ink)
        shape([(20,3),(24,12),(34,13),(27,20),(28,29),(20,24),(12,29),(13,20),(6,13),(16,12)],gold,ink)
        shape([(20,7),(22,14),(29,15),(24,19),(25,24),(20,21),(15,24),(16,19),(11,15),(18,14)],"#f2c875")
        line([(19,10),(17,15),(13,15)],"#ffedb3",2);box(20,17,21,18,"#fff1bd")
    else:
        shape([(4,14),(8,10),(30,10),(34,14),(34,26),(29,29),(7,29),(4,25)],ink)
        box(6,14,32,25,"#865979");box(8,12,30,14,"#dd9b9e");box(7,16,31,24,"#bd828e")
        box(10,18,25,19,"#f7d7b0");box(12,21,23,21,"#efb4a8")
        line([(24,27),(28,24),(32,20),(34,15)],"#647e61",2)
        for x,y in [(29,21),(33,15),(25,26)]:
            box(x-2,y-1,x+2,y+1,"#edacbe");box(x-1,y-2,x+1,y+2,"#f5c8c3");box(x,y,x,y,light)
    return im


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    PUBLIC.mkdir(exist_ok=True)
    with ZipFile(args.archive) as archive, tempfile.TemporaryDirectory(dir=PUBLIC.parent) as tmp:
        stage = Path(tmp)
        c = public_config(archive)
        creatures = creatures_for(c)
        data = {
            "version": c["CATALOG_VERSION"], "rarities": c["RARITIES"], "creatures": creatures,
            "eggs": eggs_for(c, creatures), "items": items_for(c), "cosmetics": cosmetics_for(c),
            "weekend": {"zone": "Australia/Sydney", "minTier": 3, "weightMultiplier": c["WEEKEND_SPAWN_MULTIPLIER"]},
        }
        export_assets(archive, stage / "assets" / "catalog", data)
        (stage / "data").mkdir()
        (stage / "data" / "catalog.json").write_text(json.dumps(data, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
        # Publish the metadata last, after all the artwork it references is ready.
        files = sorted((stage / "assets").rglob("*.webp")) + [stage / "data" / "catalog.json"]
        for source in files:
            target = PUBLIC / source.relative_to(stage)
            target.parent.mkdir(parents=True, exist_ok=True)
            source.replace(target)
    print(f"Exported {len(creatures)} creatures, {len(data['eggs'])} eggs, {len(data['items'])} items and {len(data['cosmetics'])} cosmetics.")


if __name__ == "__main__":
    main()
