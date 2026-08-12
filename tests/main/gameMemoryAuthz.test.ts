import { describe, it, expect } from "vitest";

import { parseAuthzAt, scanBufferForAuthz, bestAuthz } from "../../services/gameMemoryAuthz";

const ACC = "0123456789abcdef01234567"; // 24 hex
const VALID = `?accountId=${ACC}&nonce=1712345678901`;
const NEEDLE_AT = (buf: Buffer) => buf.indexOf("?accountId=");

describe("parseAuthzAt", () => {
  it("extracts a well-formed auth string", () => {
    const buf = Buffer.from(`noise\x00\x01${VALID}\x00tail`, "latin1");
    expect(parseAuthzAt(buf, NEEDLE_AT(buf))).toBe(VALID);
  });

  it("stops the nonce at the first non-digit", () => {
    const buf = Buffer.from(`?accountId=${ACC}&nonce=42&extra=x`, "latin1");
    expect(parseAuthzAt(buf, 0)).toBe(`?accountId=${ACC}&nonce=42`);
  });

  it("rejects a non-hex account id", () => {
    const buf = Buffer.from(`?accountId=zzz456789abcdef01234567&nonce=42`, "latin1");
    expect(parseAuthzAt(buf, 0)).toBeNull();
  });

  it("rejects a short account id", () => {
    const buf = Buffer.from(`?accountId=abc&nonce=42`, "latin1");
    expect(parseAuthzAt(buf, 0)).toBeNull();
  });

  it("rejects a missing &nonce= separator", () => {
    const buf = Buffer.from(`?accountId=${ACC}?nonce=42`, "latin1");
    expect(parseAuthzAt(buf, 0)).toBeNull();
  });

  it("rejects an empty nonce", () => {
    const buf = Buffer.from(`?accountId=${ACC}&nonce=x`, "latin1");
    expect(parseAuthzAt(buf, 0)).toBeNull();
  });

  it("accepts a nonce at the 24-digit limit", () => {
    const nonce = "123456789012345678901234";
    const buf = Buffer.from(`?accountId=${ACC}&nonce=${nonce}\x00`, "latin1");
    expect(parseAuthzAt(buf, 0)).toBe(`?accountId=${ACC}&nonce=${nonce}`);
  });

  it("rejects a nonce above the 24-digit limit", () => {
    const buf = Buffer.from(`?accountId=${ACC}&nonce=1234567890123456789012345\x00`, "latin1");
    expect(parseAuthzAt(buf, 0)).toBeNull();
  });

  it("returns null when the match runs off the buffer end", () => {
    const buf = Buffer.from(`?accountId=${ACC}&nonce=`, "latin1");
    expect(parseAuthzAt(buf, 0)).toBeNull();
  });
});

describe("scanBufferForAuthz + bestAuthz", () => {
  it("accepts one well-formed match", () => {
    expect(bestAuthz(new Map([[VALID, 1]]))).toEqual({
      authz: VALID,
      hits: 1,
      ambiguous: false,
    });
  });

  it("counts repeated matches and picks the most frequent", () => {
    const other = `?accountId=ffffffffffffffffffffffff&nonce=99`;
    const buf = Buffer.from(`${VALID} junk ${VALID} \x00 ${other} ${VALID}`, "latin1");
    const counts = new Map<string, number>();
    scanBufferForAuthz(buf, counts);
    expect(counts.get(VALID)).toBe(3);
    expect(counts.get(other)).toBe(1);
    expect(bestAuthz(counts)).toEqual({ authz: VALID, hits: 3, ambiguous: false });
  });

  it("ignores malformed candidates while counting valid ones", () => {
    const buf = Buffer.from(`?accountId=bad&nonce=1 ${VALID}`, "latin1");
    const counts = new Map<string, number>();
    scanBufferForAuthz(buf, counts);
    expect(counts.size).toBe(1);
    expect(counts.get(VALID)).toBe(1);
  });

  it("bestAuthz returns null on an empty tally", () => {
    expect(bestAuthz(new Map())).toEqual({ authz: null, hits: 0, ambiguous: false });
  });

  it("rejects distinct candidates tied for the highest count", () => {
    const other = `?accountId=ffffffffffffffffffffffff&nonce=99`;
    expect(
      bestAuthz(
        new Map([
          [VALID, 2],
          [other, 2],
        ]),
      ),
    ).toEqual({ authz: null, hits: 2, ambiguous: true });
  });

  it("accepts a unique leader after a lower-count tie", () => {
    const other = `?accountId=ffffffffffffffffffffffff&nonce=99`;
    const leader = `?accountId=aaaaaaaaaaaaaaaaaaaaaaaa&nonce=7`;
    expect(
      bestAuthz(
        new Map([
          [VALID, 2],
          [other, 2],
          [leader, 3],
        ]),
      ),
    ).toEqual({ authz: leader, hits: 3, ambiguous: false });
  });
});
