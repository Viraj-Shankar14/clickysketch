import { captureScreenRaw } from "../services/desktopBridge";

export interface ScreenShot {
  /** data:image/jpeg;base64,... ready for an image_url content part. */
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Captures the display under the mouse (all ClickySketch windows are hidden from the capture),
 * scales it to at most `maxWidth` pixels wide and JPEG-encodes it.
 */
export async function captureScreenShot(maxWidth: number): Promise<ScreenShot> {
  const raw = await captureScreenRaw(maxWidth);

  const source = document.createElement("canvas");
  source.width = raw.width;
  source.height = raw.height;
  const sourceContext = source.getContext("2d");
  if (!sourceContext) throw new Error("This webview cannot create a drawing surface.");

  if (raw.kind === "rgba") {
    const pixels = new Uint8ClampedArray(raw.width * raw.height * 4);
    pixels.set(raw.data.subarray(0, pixels.length));
    sourceContext.putImageData(new ImageData(pixels, raw.width, raw.height), 0, 0);
  } else {
    // slice() copies into a plain ArrayBuffer, which is what Blob accepts on every TypeScript version.
    const bitmap = await createImageBitmap(new Blob([raw.data.slice()], { type: "image/jpeg" }));
    source.width = bitmap.width;
    source.height = bitmap.height;
    sourceContext.drawImage(bitmap, 0, 0);
    bitmap.close();
  }

  const scale = Math.min(1, maxWidth / source.width);
  if (scale === 1) {
    return { dataUrl: source.toDataURL("image/jpeg", 0.8), width: source.width, height: source.height };
  }
  const target = document.createElement("canvas");
  target.width = Math.round(source.width * scale);
  target.height = Math.round(source.height * scale);
  const targetContext = target.getContext("2d");
  if (!targetContext) throw new Error("This webview cannot create a drawing surface.");
  targetContext.imageSmoothingQuality = "high";
  targetContext.drawImage(source, 0, 0, target.width, target.height);
  return { dataUrl: target.toDataURL("image/jpeg", 0.8), width: target.width, height: target.height };
}
