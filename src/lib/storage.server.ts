import {
	DeleteObjectCommand,
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const UPLOAD_URL_EXPIRY_SECONDS = 10 * 60;
const DOWNLOAD_URL_EXPIRY_SECONDS = 15 * 60;

let client: S3Client | null | undefined;
let warned = false;

function getClient(): S3Client | null {
	if (client !== undefined) return client;
	const accountId = process.env.R2_ACCOUNT_ID;
	const accessKeyId = process.env.R2_ACCESS_KEY_ID;
	const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
	if (!accountId || !accessKeyId || !secretAccessKey) {
		if (!warned) {
			console.warn(
				"R2 credentials are not set — object storage features are disabled.",
			);
			warned = true;
		}
		client = null;
		return client;
	}
	client = new S3Client({
		region: "auto",
		endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
		credentials: { accessKeyId, secretAccessKey },
	});
	return client;
}

function getBucketName(): string | null {
	const bucket = process.env.R2_BUCKET_NAME;
	if (!bucket) {
		if (!warned) {
			console.warn(
				"R2_BUCKET_NAME is not set — object storage features are disabled.",
			);
			warned = true;
		}
		return null;
	}
	return bucket;
}

export async function createUploadUrl(input: {
	key: string;
	contentType: string;
}): Promise<string> {
	const s3 = getClient();
	const bucket = getBucketName();
	if (!s3 || !bucket) throw new Error("R2 storage is not configured");
	try {
		const command = new PutObjectCommand({
			Bucket: bucket,
			Key: input.key,
			ContentType: input.contentType,
		});
		return await getSignedUrl(s3, command, {
			expiresIn: UPLOAD_URL_EXPIRY_SECONDS,
		});
	} catch (error) {
		console.error("storage: failed to create upload url", error);
		throw error;
	}
}

export async function createDownloadUrl(input: {
	key: string;
}): Promise<string> {
	const s3 = getClient();
	const bucket = getBucketName();
	if (!s3 || !bucket) throw new Error("R2 storage is not configured");
	try {
		const command = new GetObjectCommand({
			Bucket: bucket,
			Key: input.key,
		});
		return await getSignedUrl(s3, command, {
			expiresIn: DOWNLOAD_URL_EXPIRY_SECONDS,
		});
	} catch (error) {
		console.error("storage: failed to create download url", error);
		throw error;
	}
}

export async function deleteObject(input: { key: string }): Promise<void> {
	const s3 = getClient();
	const bucket = getBucketName();
	if (!s3 || !bucket) throw new Error("R2 storage is not configured");
	try {
		await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: input.key }));
	} catch (error) {
		console.error("storage: failed to delete object", error);
		throw error;
	}
}

export async function downloadBuffer(input: { key: string }): Promise<Buffer> {
	const s3 = getClient();
	const bucket = getBucketName();
	if (!s3 || !bucket) throw new Error("R2 storage is not configured");
	try {
		const result = await s3.send(
			new GetObjectCommand({ Bucket: bucket, Key: input.key }),
		);
		const bytes = await result.Body?.transformToByteArray();
		if (!bytes) throw new Error(`empty object body for key ${input.key}`);
		return Buffer.from(bytes);
	} catch (error) {
		console.error("storage: failed to download object", error);
		throw error;
	}
}

export async function uploadBuffer(input: {
	key: string;
	body: Buffer;
	contentType: string;
}): Promise<void> {
	const s3 = getClient();
	const bucket = getBucketName();
	if (!s3 || !bucket) throw new Error("R2 storage is not configured");
	try {
		await s3.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: input.key,
				Body: input.body,
				ContentType: input.contentType,
			}),
		);
	} catch (error) {
		console.error("storage: failed to upload buffer", error);
		throw error;
	}
}
