import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Field-level encryption for bank account numbers. Separate subkeys are derived for
 * encryption and fingerprinting so a leaked fingerprint never helps decryption.
 */
export class FieldCipher {
  readonly #encKey: Buffer;
  readonly #macKey: Buffer;

  constructor(masterKeyBase64: string) {
    const master = Buffer.from(masterKeyBase64, "base64");
    if (master.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes");
    this.#encKey = Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), "melo/bank-account/enc/v1", 32));
    this.#macKey = Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), "melo/bank-account/mac/v1", 32));
  }

  /** Layout: iv (12) || ciphertext || tag (16). */
  encrypt(plaintext: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.#encKey, iv);
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([iv, body, cipher.getAuthTag()]);
  }

  decrypt(blob: Buffer): string {
    const iv = blob.subarray(0, IV_BYTES);
    const tag = blob.subarray(blob.length - TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", this.#encKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(blob.subarray(IV_BYTES, blob.length - TAG_BYTES)), decipher.final()]).toString(
      "utf8",
    );
  }

  fingerprint(institutionCode: string, accountNumber: string): Buffer {
    return createHmac("sha256", this.#macKey).update(`${institutionCode}:${accountNumber}`).digest();
  }
}
