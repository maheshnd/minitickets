import { MAX_POSTER_BYTES } from "@minitickets/shared";

// 1. Recognise raster headers and bound decoded dimensions (4K, at most 16M pixels).
//    These checks are NOT malware scanning or a complete image decoder. Production needs
//    an isolated scan/re-encode step before publishing; SVG/HTML are never accepted here.
export function isPosterImage(bytes: Buffer, contentType: string): boolean {
  if (bytes.length === 0 || bytes.length > MAX_POSTER_BYTES) return false;
  const dimensionsAllowed = (width: number, height: number) =>
    width > 0 && height > 0 && width <= 4096 && height <= 4096 && width * height <= 16_000_000;
  if (contentType === "image/png") {
    return bytes.length >= 45 && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
      && bytes.readUInt32BE(8) === 13 && bytes.toString("ascii", 12, 16) === "IHDR"
      && bytes.subarray(-12).toString("hex") === "0000000049454e44ae426082"
      && dimensionsAllowed(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  }
  if (contentType !== "image/jpeg" || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return false;
  // 2. Walk length-delimited JPEG segments until the frame header. Never trust an offset
  //    without checking bounds; reject odd/unsupported files rather than guessing a size.
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      return length >= 8 && dimensionsAllowed(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
    }
    offset += length;
  }
  return false;
}
