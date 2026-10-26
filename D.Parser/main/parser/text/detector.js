
import fs from "node:fs";

const STD = [0x1000, 0x103f];
const AFT = [0x104a, 0x109f];
const EXA = [0xaa60, 0xaa7f];
const EXB = [0xa9e0, 0xa9ff];
const SPC = [0x2000, 0x200b];

function chainRanges(ranges) {
  const out = [];
  for (const [lo, hi] of ranges) {
    for (let c = lo; c <= hi; c += 1) out.push(c);
  }
  return out;
}


function bisectLeft(a, key) {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }

  read(n) {
    if (this.pos + n > this.buf.length) {
      throw new RangeError(`read ${n} bytes past end of model file`);
    }
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  int32() { return this.read(4).readInt32BE(0); }   
  int16() { return this.read(2).readInt16BE(0); }   
  float() { return this.read(4).readFloatBE(0); }    
}

export class ZawgyiDetector {
  constructor(modelPath) {
    const buf = Buffer.isBuffer(modelPath) || modelPath instanceof Uint8Array
      ? Buffer.from(modelPath.buffer, modelPath.byteOffset, modelPath.byteLength)
      : fs.readFileSync(modelPath);
    const stream = new Reader(buf);

    const uzmodelTag = stream.read(8).toString("latin1");
    if (uzmodelTag !== "UZMODEL ") throw new Error("invalid uzmodel_tag");

    const uzmodelVersion = stream.int32();
    let ssv;
    if (uzmodelVersion === 1) ssv = 0;
    else if (uzmodelVersion === 2) ssv = stream.int32();
    else throw new Error("invalid uzmodel_version");

    let ranges;
    if (ssv === 0) ranges = [STD, AFT, EXA, EXB, SPC];
    else if (ssv === 1) ranges = [STD, AFT, EXA, EXB];
    else throw new Error("invalid ssv");
    const chars = chainRanges(ranges);

    if (stream.read(8).toString("latin1") !== "BMARKOV ") throw new Error("invalid bmarkov_tag");
    if (stream.int32() !== 0) throw new Error("invalid bmarkov_version");

    const size = stream.int16();
    
    const params = new Float32Array(size * size);
    for (let i = 0; i < size; i += 1) {
      const count = stream.int16();
      if (count === 0) continue; 
      const offset = i * size;
      const baseValue = stream.float();
      params.fill(baseValue, offset, offset + size);
      for (let k = 0; k < count; k += 1) {
        const index = stream.int16();
        const value = stream.float();
        params[offset + index] = value;
      }
    }
    
    

    params[0] = NaN; 

    this._chars = chars;
    this._params = params;
    this._size = size;
    this._modelVersion = uzmodelVersion;
    this._ssv = ssv;
  }

  state(codePoint) {
    if (codePoint === null || codePoint === undefined) return 0;
    const i = bisectLeft(this._chars, codePoint);
    if (i < this._chars.length && this._chars[i] === codePoint) return i + 1;
    return 0;
  }

  
  _llrs(codePoints) {
    const size = this._size;
    const params = this._params;
    const states = new Int32Array(codePoints.length + 2);
    states[0] = 0;
    for (let i = 0; i < codePoints.length; i += 1) states[i + 1] = this.state(codePoints[i]);
    states[codePoints.length + 1] = 0;
    const out = new Float64Array(codePoints.length + 1);
    for (let i = 0; i < codePoints.length + 1; i += 1) {
      out[i] = params[states[i] * size + states[i + 1]];
    }
    return out;
  }
  
  getZawgyiProbability(string) {
    const codePoints = Array.from(string, (ch) => ch.codePointAt(0));
    const llrs = this._llrs(codePoints);
    let anyReal = false;
    for (let i = 0; i < llrs.length; i += 1) {
      if (!Number.isNaN(llrs[i])) { anyReal = true; break; }
    }
    if (!anyReal) return -Infinity;
    let total = 0;
    for (let i = 0; i < llrs.length; i += 1) {
      const x = llrs[i];
      if (!Number.isNaN(x)) total += x;
    }
    if (total >= 0) {
      const z = Math.exp(-total);
      return z / (z + 1);
    }
    return 1 / (1 + Math.exp(total));
  }

  
  detect(string, threshold = 0.5) {
    const prob = this.getZawgyiProbability(string);
    if (prob === -Infinity) return ["UNKNOWN", prob];
    if (prob > threshold) return ["ZAWGYI", prob];
    return ["UNICODE", prob];
  }
}

