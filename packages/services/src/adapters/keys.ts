import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * T11: server seeds exist only encrypted at rest. Production = AWS KMS in the isolated randomness account,
 * whose key policy allows decrypt only to the randomness service role. Local = AES-256-GCM with RNG_SEED_KEY.
 */
export interface SeedKeyProvider {
  readonly keyId: string;
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

export class LocalAesKeyProvider implements SeedKeyProvider {
  readonly keyId = "local-aes-gcm";
  private readonly key: Buffer;
  constructor(hexKey: string) {
    this.key = Buffer.from(hexKey, "hex");
    if (this.key.length !== 32) throw new Error("RNG_SEED_KEY must be 32 bytes hex");
  }
  async encrypt(plaintext: string) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
    return [iv, c.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
  }
  async decrypt(ciphertext: string) {
    const [iv, tag, body] = ciphertext.split(".").map((p) => Buffer.from(p, "base64"));
    const d = createDecipheriv("aes-256-gcm", this.key, iv!);
    d.setAuthTag(tag!);
    return Buffer.concat([d.update(body!), d.final()]).toString("utf8");
  }
}
