// Zip files, just enough for the CSV export: written stored (no compression), read stored or deflated (a zip made
// again by Windows or another tool; the browser's DecompressionStream inflates).

import {crc32} from './oddb.js';

const enc = new TextEncoder();

// [{name, data: Uint8Array}] -> the zip's bytes. Names are UTF-8 (flag bit 11).
export function makeZip(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const f of files) {
        const name = enc.encode(f.name);
        const crc = crc32(f.data);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034B50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true);
        local.setUint16(8, 0, true);
        local.setUint16(10, time, true);
        local.setUint16(12, date, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, f.data.length, true);
        local.setUint32(22, f.data.length, true);
        local.setUint16(26, name.length, true);
        local.setUint16(28, 0, true);
        parts.push(new Uint8Array(local.buffer), name, f.data);
        const c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014B50, true);
        c.setUint16(4, 20, true);
        c.setUint16(6, 20, true);
        c.setUint16(8, 0x0800, true);
        c.setUint16(10, 0, true);
        c.setUint16(12, time, true);
        c.setUint16(14, date, true);
        c.setUint32(16, crc, true);
        c.setUint32(20, f.data.length, true);
        c.setUint32(24, f.data.length, true);
        c.setUint16(28, name.length, true);
        c.setUint32(42, offset, true);
        central.push(new Uint8Array(c.buffer), name);
        offset += 30 + name.length + f.data.length;
    }
    const size = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054B50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {type: 'application/zip'});
}

export function isZip(bytes) {
    return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04;
}

async function inflate(data) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

// The zip's bytes -> [{name, data}] (folders left out), from its central directory
export async function readZip(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
        if (v.getUint32(i, true) === 0x06054B50) {
            end = i;
            break;
        }
    }
    if (end < 0) {
        throw new Error('not a zip file');
    }
    const count = v.getUint16(end + 10, true);
    let at = v.getUint32(end + 16, true);
    const files = [];
    for (let n = 0; n < count; n++) {
        if (v.getUint32(at, true) !== 0x02014B50) {
            throw new Error('a damaged zip file');
        }
        const flags = v.getUint16(at + 8, true);
        const method = v.getUint16(at + 10, true);
        const packed = v.getUint32(at + 20, true);
        const nameLength = v.getUint16(at + 28, true);
        const extra = v.getUint16(at + 30, true);
        const comment = v.getUint16(at + 32, true);
        const local = v.getUint32(at + 42, true);
        const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
        const name = new TextDecoder((flags & 0x0800) ? 'utf-8' : 'gb18030').decode(nameBytes);
        at += 46 + nameLength + extra + comment;
        if (name.endsWith('/')) {
            continue;
        }
        const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
        const raw = bytes.subarray(start, start + packed);
        if (method === 0) {
            files.push({name, data: raw});
        } else if (method === 8) {
            files.push({name, data: await inflate(raw)});
        } else {
            throw new Error(`${name}: a compression this page cannot read (${method})`);
        }
    }
    return files;
}
