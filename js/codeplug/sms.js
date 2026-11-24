// The radio's text messages (OpenDMR src/services/sms.h): a header sector ("SMS1", the quick texts), then the inbox
// and the outbox, 32 records of 512 bytes each. The radio writes the boxes; we read them, delete records and write
// the quick texts.
//
// A record: used (0xA5; 0xFF free, 0 deleted), unread (0xFF unread, 0 read), mode (0 DMR, 1 M17), status (the
// outbox: 0 sending, 1 sent, 2 delivered, 3 not sent), seq (u32: its order, the newest the highest), time (u32: UTC
// seconds, 0 no clock), src, dst (u32: DMR IDs), group, format, TMS sequence number, reserved, peer (24 bytes: an
// M17 callsign), text (464 bytes: UTF-8, NUL terminated).

export const BASE = 0x30000;
export const END = 0x39000; // the header sector and the two boxes
export const MAGIC = 0x31534D53; // "SMS1"
export const PRESETS = 16;
export const PRESET_SIZE = 64; // 63 bytes of UTF-8 and its NUL
export const PRESETS_AT = BASE + 0x40;
export const BOXES = [BASE + 0x1000, BASE + 0x5000]; // the inbox, the outbox
export const BOX = 32;
export const RECORD = 512;
export const USED = 0xA5;

const u32 = (b, a) => (b[a] | (b[a + 1] << 8) | (b[a + 2] << 16) | (b[a + 3] << 24)) >>> 0;

function cString(bytes) {
    let n = bytes.indexOf(0);
    if (n < 0) {
        n = bytes.length;
    }
    let s = new TextDecoder().decode(bytes.subarray(0, n));
    return s.replace(/�+$/, ''); // a character cut at the end
}

export function hasHeader(img) {
    return u32(img, BASE) === MAGIC;
}

// The quick texts: 16 strings ('' unused)
export function readPresets(img) {
    const out = [];
    for (let i = 0; i < PRESETS; i++) {
        const at = PRESETS_AT + (i * PRESET_SIZE);
        out.push((img[at] === 0xFF) || !hasHeader(img) ? '' : cString(img.subarray(at, at + PRESET_SIZE).map((b) => (b === 0xFF ? 0 : b))));
    }
    return out;
}

// UTF-8 of a quick text cut to 63 bytes on a character
export function presetBytes(text) {
    const enc = new TextEncoder();
    let bytes = enc.encode(text);
    while (bytes.length > PRESET_SIZE - 1) {
        text = Array.from(text).slice(0, -1).join('');
        bytes = enc.encode(text);
    }
    return bytes;
}

// The quick texts into the image (the header's magic with them); the range written
export function writePresets(img, presets) {
    img.fill(0xFF, BASE, PRESETS_AT + (PRESETS * PRESET_SIZE));
    img[BASE] = MAGIC & 0xFF;
    img[BASE + 1] = (MAGIC >>> 8) & 0xFF;
    img[BASE + 2] = (MAGIC >>> 16) & 0xFF;
    img[BASE + 3] = (MAGIC >>> 24) & 0xFF;
    presets.forEach((text, i) => {
        if (text) {
            const at = PRESETS_AT + (i * PRESET_SIZE);
            const bytes = presetBytes(text);
            img.set(bytes, at);
            img[at + bytes.length] = 0;
        }
    });
    return [BASE, PRESETS_AT + (PRESETS * PRESET_SIZE)];
}

// The records of box (0 inbox, 1 outbox), the newest first
export function readBox(img, box) {
    const out = [];
    for (let slot = 0; slot < BOX; slot++) {
        const at = BOXES[box] + (slot * RECORD);
        if (img[at] !== USED) {
            continue;
        }
        out.push({
            box,
            at,
            unread: img[at + 1] === 0xFF,
            mode: img[at + 2],
            status: img[at + 3],
            seq: u32(img, at + 4),
            time: u32(img, at + 8),
            src: u32(img, at + 12),
            dst: u32(img, at + 16),
            group: img[at + 20] !== 0,
            format: img[at + 21],
            peer: cString(img.subarray(at + 24, at + 48)),
            text: cString(img.subarray(at + 48, at + RECORD)),
        });
    }
    return out.sort((a, b) => b.seq - a.seq);
}

// On the radio now (onRadio, an image) the same record as m (its seq): its deletion may be written
export function sameRecord(onRadio, m) {
    return onRadio[m.at] === USED && u32(onRadio, m.at + 4) === m.seq;
}
