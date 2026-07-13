#!/usr/bin/env node
// Single source of truth for the Skillerr brand mark. Everything under
// assets/ that isn't a master SVG is *generated* from one — do not
// hand-edit the PNGs/ICO this script writes. Re-run after any change to
// assets/skillerr-mark.svg or assets/skillerr-lockup.svg and commit the
// results. CI (.github/workflows/ci.yml's `brand` job) re-runs this on
// every push to prove the pipeline itself works, but does not byte-diff
// the output against what's checked in — sharp/libvips's PNG encoding
// isn't guaranteed byte-identical across OS/architecture even for
// pixel-identical input, so a strict diff would fail CI on machine
// differences having nothing to do with the SVG actually changing.
//
// There are two master SVGs, both traced from the official reference
// image at assets/source/dot-skill-official.png (kept in the repo as
// the permanent ground truth for anyone re-doing the vectorization):
//   - skillerr-mark.svg   — icon only (scroll + wave). Used for every
//     square/icon output below (favicon, apple-touch-icon, the sized
//     PNGs) since small square slots can't fit the wordmark legibly.
//   - skillerr-lockup.svg — icon + "skill" wordmark, stacked exactly as
//     laid out in the official reference. Used for the OG/social banner
//     and anywhere a horizontal/README-style logo lockup is needed.
//
// Usage: node scripts/build-brand.mjs   (from repo root or anywhere)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const assetsDir = join(rootDir, "assets");
const svgPath = join(assetsDir, "skillerr-mark.svg");
const lockupSvgPath = join(assetsDir, "skillerr-lockup.svg");

const MARK_SIZES = [32, 64, 128, 256, 512, 1024];
const APPLE_TOUCH_ICON_SIZE = 180;
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
// Pale teal wash derived from the mark's own teal (#1CADAA mixed ~90%
// toward white). Chosen over the mark's raw teal or charcoal as a literal
// background: charcoal-on-charcoal would erase the scroll outline and the
// entire wordmark (both are charcoal), and full-saturation teal-on-teal
// would erase the wave. This tint keeps both palette colors — charcoal
// linework and the teal wave — at strong, legible contrast while still
// reading as "the brand's teal."
const OG_BACKGROUND = "#E8F7F7";
const OG_LOCKUP_HEIGHT = 480;
// Content bounding box of the lockup's ink within its 1024x1024 viewBox
// (icon top-left to wordmark bottom-right), plus a small margin, so the
// rasterized lockup isn't dwarfed by the master SVG's own whitespace.
const OG_LOCKUP_VIEWBOX = { x: 292, y: 135, width: 439, height: 630 };

const generated = [];

function fail(step, err) {
  console.error(`\n[build-brand] FAILED at: ${step}`);
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}

async function main() {
  if (!existsSync(svgPath)) {
    fail("read master SVG", new Error(`Missing ${svgPath}`));
  }
  if (!existsSync(lockupSvgPath)) {
    fail("read master lockup SVG", new Error(`Missing ${lockupSvgPath}`));
  }
  const svg = readFileSync(svgPath);
  const lockupSvgSource = readFileSync(lockupSvgPath, "utf8");
  console.log(`Source (icon):   ${svgPath}`);
  console.log(`Source (lockup): ${lockupSvgPath}`);

  // 1. Rasterize the master SVG to PNG at each canonical size. Sharp
  // rasterizes SVG input at its intrinsic size (1024x1024, per the
  // viewBox/width/height on the root <svg>) and resizes from there, so
  // output is deterministic and independent of host DPI settings.
  for (const size of MARK_SIZES) {
    const outPath = join(assetsDir, `skillerr-mark-${size}.png`);
    try {
      await sharp(svg)
        .resize(size, size)
        .png({ compressionLevel: 9 })
        .toFile(outPath);
    } catch (err) {
      fail(`rasterize skillerr-mark-${size}.png`, err);
    }
    generated.push(outPath);
  }

  // Keep the historical unsized `skillerr-mark.png` filename working
  // (README.md / packages/skillerr/README.md embed it directly) as an
  // alias of the 1024px master raster.
  {
    const outPath = join(assetsDir, "skillerr-mark.png");
    try {
      await sharp(svg).resize(1024, 1024).png({ compressionLevel: 9 }).toFile(outPath);
    } catch (err) {
      fail("write skillerr-mark.png alias", err);
    }
    generated.push(outPath);
  }

  // 2. favicon.ico — multi-resolution (256/48/32/16) generated from the
  // 256px PNG we just produced. png-to-ico is pure JS (pngjs under the
  // hood), so this needs no native toolchain / ImageMagick / iconutil.
  {
    const src256 = join(assetsDir, "skillerr-mark-256.png");
    const outPath = join(assetsDir, "favicon.ico");
    try {
      const icoBuffer = await pngToIco(src256);
      writeFileSync(outPath, icoBuffer);
    } catch (err) {
      fail("generate favicon.ico", err);
    }
    generated.push(outPath);
  }

  // 3. apple-touch-icon.png — 180x180 per Apple's convention, flattened
  // onto an opaque background (iOS composites transparent PNGs onto a
  // black square in some contexts, which looks broken for a light mark).
  {
    const outPath = join(assetsDir, "apple-touch-icon.png");
    try {
      await sharp(svg)
        .resize(APPLE_TOUCH_ICON_SIZE, APPLE_TOUCH_ICON_SIZE)
        .flatten({ background: "#FFFFFF" })
        .png({ compressionLevel: 9 })
        .toFile(outPath);
    } catch (err) {
      fail("generate apple-touch-icon.png", err);
    }
    generated.push(outPath);
  }

  // 4. .icns (macOS icon container) — intentionally NOT generated here.
  // There is no maintained, zero-native-dependency npm package that
  // writes .icns; the standard tool is Apple's `iconutil`, which only
  // ships with Xcode command line tools on macOS and is not installable
  // on Linux/Windows CI runners. Producing one from the PNGs above is a
  // local, macOS-only step:
  //
  //   mkdir skillerr-mark.iconset
  //   sips -z 16 16   assets/skillerr-mark-32.png   --out skillerr-mark.iconset/icon_16x16.png
  //   sips -z 32 32   assets/skillerr-mark-64.png   --out skillerr-mark.iconset/icon_16x16@2x.png
  //   sips -z 32 32   assets/skillerr-mark-32.png   --out skillerr-mark.iconset/icon_32x32.png
  //   sips -z 64 64   assets/skillerr-mark-128.png  --out skillerr-mark.iconset/icon_32x32@2x.png
  //   sips -z 128 128 assets/skillerr-mark-128.png  --out skillerr-mark.iconset/icon_128x128.png
  //   sips -z 256 256 assets/skillerr-mark-256.png  --out skillerr-mark.iconset/icon_128x128@2x.png
  //   sips -z 256 256 assets/skillerr-mark-256.png  --out skillerr-mark.iconset/icon_256x256.png
  //   sips -z 512 512 assets/skillerr-mark-512.png  --out skillerr-mark.iconset/icon_256x256@2x.png
  //   sips -z 512 512 assets/skillerr-mark-512.png  --out skillerr-mark.iconset/icon_512x512.png
  //   sips -z 1024 1024 assets/skillerr-mark-1024.png --out skillerr-mark.iconset/icon_512x512@2x.png
  //   iconutil -c icns skillerr-mark.iconset -o assets/skillerr-mark.icns
  //
  // See docs/FILE-TYPE.md for the full OS-registration writeup. This is
  // deliberately skipped (not faked) rather than blocking CI on a tool
  // that can't run there.
  console.log(
    "[build-brand] Skipping .icns: requires macOS `iconutil`, not scriptable " +
      "cross-platform in CI. See docs/FILE-TYPE.md for the manual steps.",
  );

  // 5. Social / OG banner — 1200x630, full icon+wordmark lockup
  // composited on a flat brand background. Kept text-free beyond what's
  // already baked into the lockup SVG's paths (no <text> rasterization)
  // so the output is identical across every OS/font environment,
  // matching the reproducibility check in CI.
  //
  // The lockup's own 1024x1024 viewBox has a lot of surrounding
  // whitespace (it reproduces the official reference image's exact
  // layout, which includes margin above the icon and below the
  // wordmark), so re-point the viewBox at just the ink's bounding box
  // before rasterizing — otherwise the mark would render tiny in the
  // banner. This only affects this one rasterization; the checked-in
  // skillerr-lockup.svg keeps its original 0 0 1024 1024 viewBox.
  {
    const outPath = join(assetsDir, "og-banner.png");
    try {
      const { x, y, width, height } = OG_LOCKUP_VIEWBOX;
      const croppedLockupSvg = lockupSvgSource.replace(
        /viewBox="[^"]*"\s+width="[^"]*"\s+height="[^"]*"/,
        `viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}"`,
      );
      const markBuffer = await sharp(Buffer.from(croppedLockupSvg))
        .resize({ height: OG_LOCKUP_HEIGHT })
        .png()
        .toBuffer();
      const markMeta = await sharp(markBuffer).metadata();
      await sharp({
        create: {
          width: OG_WIDTH,
          height: OG_HEIGHT,
          channels: 4,
          background: OG_BACKGROUND,
        },
      })
        .composite([
          {
            input: markBuffer,
            left: Math.round((OG_WIDTH - markMeta.width) / 2),
            top: Math.round((OG_HEIGHT - OG_LOCKUP_HEIGHT) / 2),
          },
        ])
        .png({ compressionLevel: 9 })
        .toFile(outPath);
    } catch (err) {
      fail("generate og-banner.png", err);
    }
    generated.push(outPath);
  }

  console.log(`\nGenerated ${generated.length} file(s) from ${svgPath}:`);
  for (const file of generated) {
    console.log(`  - ${file.replace(rootDir, "").replace(/^\//, "")}`);
  }
}

main().catch((err) => fail("unexpected error", err));
