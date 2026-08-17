const QRCode = require("qrcode");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

(async () => {
  const url =
    "https://play.google.com/store/apps/details?id=com.aurahomesystems.app";
  const root = path.join(__dirname, "..");
  const outDir = path.join(root, "assets");
  fs.mkdirSync(outDir, { recursive: true });

  const size = 1200;
  const qrBuf = await QRCode.toBuffer(url, {
    type: "png",
    width: size,
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: "#020617", light: "#FFFFFF" },
  });

  const logoPath = path.join(root, "icons", "icon-512.png");
  const logoSize = Math.round(size * 0.22);
  const logo = await sharp(logoPath)
    .resize(logoSize, logoSize, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();

  const pad = Math.round(logoSize * 1.14);
  const padImg = await sharp({
    create: {
      width: pad,
      height: pad,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const composedLogo = await sharp(padImg)
    .composite([{ input: logo, gravity: "centre" }])
    .png()
    .toBuffer();

  const outPath = path.join(outDir, "aura-play-store-qr.png");
  await sharp(qrBuf)
    .composite([{ input: composedLogo, gravity: "centre" }])
    .png()
    .toFile(outPath);

  await sharp(outPath)
    .resize(2000, 2000, { kernel: "nearest" })
    .toFile(path.join(outDir, "aura-play-store-qr-print.png"));

  console.log("Wrote", outPath);
  console.log("Wrote assets/aura-play-store-qr-print.png");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
