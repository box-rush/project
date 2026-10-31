import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { awsClientConfig } from "./aws";

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

/**
 * T11 production: AWS KMS key in the randomness account. The key policy allows Decrypt only to the randomness
 * service role, and every decrypt is logged in CloudTrail. The plaintext seed exists only in that service's memory.
 */
export class KmsKeyProvider implements SeedKeyProvider {
  constructor(
    readonly keyId: string,
    private readonly client: Pick<import("@aws-sdk/client-kms").KMSClient, "send">,
  ) {}
  static async create(keyId: string) {
    const { KMSClient } = await import("@aws-sdk/client-kms");
    return new KmsKeyProvider(keyId, new KMSClient(awsClientConfig()));
  }
  async encrypt(plaintext: string) {
    const { EncryptCommand } = await import("@aws-sdk/client-kms");
    const r = await this.client.send(new EncryptCommand({ KeyId: this.keyId, Plaintext: Buffer.from(plaintext, "utf8"), EncryptionContext: { purpose: "boxrush-server-seed" } }));
    return `kms:${Buffer.from(r.CiphertextBlob!).toString("base64")}`;
  }
  async decrypt(ciphertext: string) {
    const { DecryptCommand } = await import("@aws-sdk/client-kms");
    if (!ciphertext.startsWith("kms:")) throw new Error("not a KMS ciphertext");
    const r = await this.client.send(new DecryptCommand({ KeyId: this.keyId, CiphertextBlob: Buffer.from(ciphertext.slice(4), "base64"), EncryptionContext: { purpose: "boxrush-server-seed" } }));
    return Buffer.from(r.Plaintext!).toString("utf8");
  }
}
