/**
 * The song details an MP3 carries inside it (its "ID3 tag"): the title,
 * artist, album and track number that music players show. Read in the
 * browser from the start of the file (ID3v2, the usual kind) or, failing
 * that, its last 128 bytes (the older ID3v1). Only ever a suggestion - the
 * upload pages put it in the boxes, where it can be edited.
 */
export interface FileTags {
  title?: string;
  artist?: string;
  album?: string;
  trackNumber?: number;
}

// Big enough for any text frames even behind embedded cover art; the frames
// we want are small, and anything past this is just more picture.
const MAX_TAG_BYTES = 4 * 1024 * 1024;

export async function readFileTags(file: File): Promise<FileTags> {
  try {
    const v2 = await readId3v2(file);
    if (v2.title) return v2;
    const v1 = await readId3v1(file);
    return {
      title: v2.title ?? v1.title,
      artist: v2.artist ?? v1.artist,
      album: v2.album ?? v1.album,
      trackNumber: v2.trackNumber ?? v1.trackNumber,
    };
  } catch {
    return {};
  }
}

async function readId3v2(file: File): Promise<FileTags> {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return {}; // "ID3"
  const version = head[3]; // 2, 3 or 4
  const flags = head[5];
  const size = syncsafe(head, 6);
  if (version < 2 || version > 4 || size <= 0) return {};

  let buf: Uint8Array = new Uint8Array(await file.slice(10, 10 + Math.min(size, MAX_TAG_BYTES)).arrayBuffer());
  // Whole-tag "unsynchronisation" (v2.2/2.3): FF 00 pairs stand for a plain FF.
  if (flags & 0x80 && version < 4) buf = unsync(buf);

  let pos = 0;
  if (flags & 0x40 && version >= 3) {
    // An extended header to skip.
    pos = version === 4 ? syncsafe(buf, 0) : 4 + readUint32(buf, 0);
  }

  const idLen = version === 2 ? 3 : 4;
  const headerLen = version === 2 ? 6 : 10;
  const wanted: Record<string, keyof FileTags> =
    version === 2
      ? { TT2: "title", TP1: "artist", TAL: "album", TRK: "trackNumber" }
      : { TIT2: "title", TPE1: "artist", TALB: "album", TRCK: "trackNumber" };
  const out: FileTags = {};

  while (pos + headerLen <= buf.length) {
    const id = String.fromCharCode(...buf.subarray(pos, pos + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break; // padding
    const frameSize =
      version === 2
        ? (buf[pos + 3] << 16) | (buf[pos + 4] << 8) | buf[pos + 5]
        : version === 4
          ? syncsafe(buf, pos + 4)
          : readUint32(buf, pos + 4);
    const formatFlags = version === 2 ? 0 : buf[pos + 9];
    const start = pos + headerLen;
    const end = start + frameSize;
    if (frameSize <= 0 || end > buf.length) break;

    const field = wanted[id];
    // Skip compressed/encrypted frames (v2.3: 0x80/0x40, v2.4: 0x08/0x04) - rare for text.
    const packed = version === 3 ? formatFlags & 0xc0 : version === 4 ? formatFlags & 0x0c : 0;
    if (field && !packed) {
      let body: Uint8Array = buf.subarray(start, end);
      if (version === 4 && formatFlags & 0x01) body = body.subarray(4); // data length indicator
      if (version === 4 && formatFlags & 0x02) body = unsync(body);
      const text = decodeText(body);
      if (text) {
        if (field === "trackNumber") {
          const n = parseInt(text, 10); // "3/12" -> 3
          if (n > 0 && n < 1000) out.trackNumber = n;
        } else {
          out[field] = text;
        }
      }
    }
    pos = end;
  }
  return out;
}

async function readId3v1(file: File): Promise<FileTags> {
  if (file.size < 128) return {};
  const buf = new Uint8Array(await file.slice(file.size - 128).arrayBuffer());
  if (buf[0] !== 0x54 || buf[1] !== 0x41 || buf[2] !== 0x47) return {}; // "TAG"
  const latin = (from: number, to: number) => clean(new TextDecoder("latin1").decode(buf.subarray(from, to)));
  const out: FileTags = {};
  const title = latin(3, 33);
  const artist = latin(33, 63);
  const album = latin(63, 93);
  if (title) out.title = title;
  if (artist) out.artist = artist;
  if (album) out.album = album;
  if (buf[125] === 0 && buf[126] > 0) out.trackNumber = buf[126]; // ID3v1.1
  return out;
}

// A text frame: one encoding byte, then the text (possibly several values
// separated by NULs - the first is the one wanted).
function decodeText(body: Uint8Array): string {
  if (body.length < 2) return "";
  const enc = body[0];
  const data = body.subarray(1);
  let text: string;
  if (enc === 1 || enc === 2) {
    // UTF-16 with a byte-order mark (1), or big-endian without one (2).
    let le = enc === 1;
    let from = 0;
    if (data[0] === 0xff && data[1] === 0xfe) (le = true), (from = 2);
    else if (data[0] === 0xfe && data[1] === 0xff) (le = false), (from = 2);
    text = new TextDecoder(le ? "utf-16le" : "utf-16be").decode(data.subarray(from, from + ((data.length - from) & ~1)));
  } else {
    text = new TextDecoder(enc === 3 ? "utf-8" : "latin1").decode(data);
  }
  return clean(text.split("\u0000")[0]);
}

function clean(s: string): string {
  // Curly apostrophes made straight, as titles taken from file names are.
  return s.replace(/\u0000/g, "").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

function syncsafe(b: Uint8Array, at: number): number {
  return ((b[at] & 0x7f) << 21) | ((b[at + 1] & 0x7f) << 14) | ((b[at + 2] & 0x7f) << 7) | (b[at + 3] & 0x7f);
}

function readUint32(b: Uint8Array, at: number): number {
  return ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
}

function unsync(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length);
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    out[n++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, n);
}
