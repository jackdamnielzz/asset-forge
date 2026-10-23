import zlib from 'node:zlib';

// Writes a .aseprite file (format documented at github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md):
// RGBA colour mode, one layer, one cel per frame, and a tag per animation.
// frames: [{ rgba: Buffer (w*h*4), duration: ms }], tags: [{ name, from, to }]
export function writeAseprite({ width, height, frames, tags = [], layerName = 'Sprite' }) {
  const frameBufs = frames.map((f, i) => {
    const chunks = [];
    if (i === 0) {
      chunks.push(chunk(0x2004, cat(u16(3), u16(0), u16(0), u16(0), u16(0), u16(0), u8(255), zeros(3), str(layerName))));
      if (tags.length) {
        chunks.push(chunk(0x2018, cat(u16(tags.length), zeros(8), ...tags.map((t) =>
          cat(u16(t.from), u16(t.to), u8(0), u16(0), zeros(6), zeros(3), u8(0), str(t.name)))))); // forward, no repeat
      }
    }
    const pixels = zlib.deflateSync(f.rgba);
    chunks.push(chunk(0x2005, cat(u16(0), i16(0), i16(0), u8(255), u16(2), i16(0), zeros(5), u16(width), u16(height), pixels)));
    const body = cat(...chunks);
    const header = cat(u32(16 + body.length), u16(0xf1fa), u16(chunks.length), u16(f.duration ?? 100), zeros(2), u32(chunks.length));
    return cat(header, body);
  });
  const all = cat(...frameBufs);
  const header = cat(
    u32(128 + all.length), u16(0xa5e0), u16(frames.length), u16(width), u16(height), u16(32), u32(1), u16(100),
    u32(0), u32(0), u8(0), zeros(3), u16(0), u8(1), u8(1), i16(0), i16(0), u16(16), u16(16), zeros(84),
  );
  return cat(header, all);
}

function chunk(type, data) { return cat(u32(6 + data.length), u16(type), data); }
const u8 = (v) => Buffer.from([v & 255]);
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const i16 = (v) => { const b = Buffer.alloc(2); b.writeInt16LE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const zeros = (n) => Buffer.alloc(n);
const str = (s) => { const t = Buffer.from(s, 'utf8'); return cat(u16(t.length), t); };
const cat = (...parts) => Buffer.concat(parts);
