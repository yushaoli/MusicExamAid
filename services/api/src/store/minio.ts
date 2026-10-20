import crypto from "node:crypto";

export interface MinioClientConfig {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region?: string;
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * Lightweight zero-dependency AWS Signature V4 client for S3 / MinIO (`100.64.0.4:9010`).
 */
export class MinioStorageClient {
  private readonly endpoint: URL;
  private readonly accessKey: string;
  private readonly secretKey: string;
  private readonly bucket: string;
  private readonly region: string;
  private bucketEnsured = false;

  constructor(cfg?: Partial<MinioClientConfig>) {
    const rawEndpoint = cfg?.endpoint ?? process.env["S3_ENDPOINT"] ?? "http://100.64.0.4:9010";
    this.endpoint = new URL(rawEndpoint);
    this.accessKey = cfg?.accessKey ?? process.env["S3_ACCESS_KEY"] ?? "minioadmin";
    this.secretKey = cfg?.secretKey ?? process.env["S3_SECRET_KEY"] ?? "minioadmin_change_me";
    this.bucket = cfg?.bucket ?? process.env["S3_BUCKET"] ?? "musicexamaid-dev";
    this.region = cfg?.region ?? "us-east-1";
  }

  private signRequest(
    method: string,
    canonicalUri: string,
    payload: Buffer
  ): Record<string, string> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(payload);
    const host = this.endpoint.host;

    const canonicalHeaders =
      `host:${host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

    const canonicalRequest = [
      method,
      canonicalUri,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const kDate = hmacSha256(`AWS4${this.secretKey}`, dateStamp);
    const kRegion = hmacSha256(kDate, this.region);
    const kService = hmacSha256(kRegion, "s3");
    const kSigning = hmacSha256(kService, "aws4_request");
    const signature = crypto
      .createHmac("sha256", kSigning)
      .update(stringToSign, "utf8")
      .digest("hex");

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      Host: host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      Authorization: authorization,
    };
  }

  async ensureBucket(): Promise<void> {
    if (process.env.NODE_ENV === 'test' && process.env.LIVE_E2E !== '1') {
      throw new Error('Live MinIO writes are disabled in tests; opt in with LIVE_E2E=1');
    }
    if (this.bucketEnsured) return;
    const uri = `/${encodeURIComponent(this.bucket)}`;
    const headHeaders = this.signRequest("HEAD", uri, Buffer.alloc(0));
    const headRes = await fetch(new URL(uri, this.endpoint), {
      method: "HEAD",
      headers: headHeaders,
    });
    if (headRes.status === 404) {
      const putHeaders = this.signRequest("PUT", uri, Buffer.alloc(0));
      const putRes = await fetch(new URL(uri, this.endpoint), {
        method: "PUT",
        headers: putHeaders,
      });
      if (!putRes.ok && putRes.status !== 409) {
        throw new Error(`MinIO createBucket failed: HTTP ${putRes.status}`);
      }
    }
    this.bucketEnsured = true;
  }

  async putObject(
    objectKey: string,
    body: Buffer,
    contentType = "application/octet-stream"
  ): Promise<{ bucket: string; key: string; s3_uri: string; size_bytes: number }> {
    await this.ensureBucket();
    const cleanKey = objectKey.replace(/^\/+/, "");
    const encodedKey = cleanKey.split("/").map(encodeURIComponent).join("/");
    const uri = `/${encodeURIComponent(this.bucket)}/${encodedKey}`;
    const headers = {
      ...this.signRequest("PUT", uri, body),
      "Content-Type": contentType,
      "Content-Length": String(body.length),
    };
    const res = await fetch(new URL(uri, this.endpoint), {
      method: "PUT",
      headers,
      body: new Uint8Array(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`MinIO putObject(${cleanKey}) failed: HTTP ${res.status} ${errText}`);
    }
    return {
      bucket: this.bucket,
      key: cleanKey,
      s3_uri: `s3://${this.bucket}/${cleanKey}`,
      size_bytes: body.length,
    };
  }

  async getObject(objectKey: string): Promise<Buffer | null> {
    const cleanKey = objectKey.replace(/^\/+/, "");
    const encodedKey = cleanKey.split("/").map(encodeURIComponent).join("/");
    const uri = `/${encodeURIComponent(this.bucket)}/${encodedKey}`;
    const headers = this.signRequest("GET", uri, Buffer.alloc(0));
    const res = await fetch(new URL(uri, this.endpoint), {
      method: "GET",
      headers,
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`MinIO getObject(${cleanKey}) failed: HTTP ${res.status}`);
    }
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }
}

export const minioClient = new MinioStorageClient();
