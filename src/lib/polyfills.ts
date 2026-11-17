/**
 * Text codecs for JS engines that lack them or lack the latin1 label (the PNG codec constructs
 * `new TextDecoder('latin1')` at import time). Must load before any other app module.
 */
type G = { TextDecoder?: unknown; TextEncoder?: unknown };
const g = globalThis as unknown as G;

function supported(): boolean {
  try {
    const Ctor = g.TextDecoder as new (label?: string) => { decode(b: Uint8Array): string };
    return new Ctor('latin1').decode(new Uint8Array([65])) === 'A' && new Ctor('utf-8').decode(new Uint8Array([65])) === 'A';
  } catch {
    return false;
  }
}

if (!supported()) {
  g.TextDecoder = class {
    private latin: boolean;
    constructor(label = 'utf-8') {
      this.latin = /^(latin1|iso-8859-1|ascii|binary)$/i.test(label);
    }
    decode(input?: ArrayBuffer | ArrayBufferView): string {
      if (!input) return '';
      const bytes = input instanceof Uint8Array ? input : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
      let out = '';
      if (this.latin) {
        for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
        return out;
      }
      for (let i = 0; i < bytes.length; ) {
        const b = bytes[i++];
        let cp = b;
        if (b >= 0xf0) cp = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
        else if (b >= 0xe0) cp = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
        else if (b >= 0xc0) cp = ((b & 31) << 6) | (bytes[i++] & 63);
        out += String.fromCodePoint(cp);
      }
      return out;
    }
  };
}

if (typeof g.TextEncoder !== 'function') {
  g.TextEncoder = class {
    encode(text = ''): Uint8Array {
      const out: number[] = [];
      for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        if (cp < 0x80) out.push(cp);
        else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
        else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      }
      return new Uint8Array(out);
    }
  };
}

// Some npm packages call Node's process.emitWarning, absent in React Native.
const proc = (globalThis as unknown as { process?: { emitWarning?: unknown } }).process;
if (proc && typeof proc.emitWarning !== 'function') proc.emitWarning = () => {};

export {};
