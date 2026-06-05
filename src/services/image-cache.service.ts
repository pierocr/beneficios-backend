import crypto from "node:crypto";
import sharp from "sharp";
import { env } from "../config/env";
import { getSupabaseAdminClient } from "../lib/supabase";
import { logger } from "../utils/logger";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

export interface CacheBenefitImageInput {
  providerSlug: string;
  providerBenefitKey: string;
  merchantSlug: string;
  benefitId?: string;
  imageKind?: "banner" | "logo";
  sourceUrl: string;
}

export interface CachedBenefitImage {
  sourceUrl: string;
  publicUrl: string;
  storagePath: string;
  byteSize: number;
  originalByteSize: number;
  width?: number;
  height?: number;
  sha256: string;
}

export interface FailedBenefitImageCache {
  sourceUrl: string;
  errorMessage: string;
}

export type BenefitImageCacheResult = CachedBenefitImage | FailedBenefitImageCache;

export function isCachedBenefitImage(result: BenefitImageCacheResult): result is CachedBenefitImage {
  return "publicUrl" in result;
}

export class ImageCacheService {
  async cacheBenefitImage(input: CacheBenefitImageInput): Promise<BenefitImageCacheResult> {
    const imageKind = input.imageKind ?? "banner";

    try {
      const existing = await this.getExistingCachedImage({
        providerSlug: input.providerSlug,
        providerBenefitKey: input.providerBenefitKey,
        imageKind,
        sourceUrl: input.sourceUrl,
      });
      if (existing) {
        return existing;
      }

      const sourceBuffer = await this.downloadImage(input.sourceUrl);
      const originalByteSize = sourceBuffer.byteLength;

      if (originalByteSize > MAX_SOURCE_BYTES) {
        throw new Error(`Source image is too large: ${originalByteSize} bytes`);
      }

      const sha256 = crypto.createHash("sha256").update(sourceBuffer).digest("hex");
      const optimized = await sharp(sourceBuffer, { animated: false })
        .rotate()
        .resize({
          width: env.BENEFIT_IMAGE_MAX_WIDTH,
          withoutEnlargement: true,
        })
        .webp({
          quality: env.BENEFIT_IMAGE_WEBP_QUALITY,
          effort: 4,
        })
        .toBuffer({ resolveWithObject: true });
      const storagePath = this.buildStoragePath({
        providerSlug: input.providerSlug,
        providerBenefitKey: input.providerBenefitKey,
        merchantSlug: input.merchantSlug,
        imageKind,
        sha256,
      });
      const supabase = getSupabaseAdminClient();
      const { error: uploadError } = await supabase.storage
        .from(env.BENEFIT_IMAGES_BUCKET)
        .upload(storagePath, optimized.data, {
          contentType: "image/webp",
          cacheControl: "31536000",
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`Failed to upload image to storage: ${uploadError.message}`);
      }

      const { data: publicUrlData } = supabase.storage.from(env.BENEFIT_IMAGES_BUCKET).getPublicUrl(storagePath);
      const publicUrl = publicUrlData.publicUrl;
      const cached: CachedBenefitImage = {
        sourceUrl: input.sourceUrl,
        publicUrl,
        storagePath,
        byteSize: optimized.data.byteLength,
        originalByteSize,
        width: optimized.info.width,
        height: optimized.info.height,
        sha256,
      };

      await this.upsertImageRecord({
        ...input,
        imageKind,
        cached,
      });

      return cached;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown image cache error";

      logger.warn("Benefit image cache failed", {
        providerSlug: input.providerSlug,
        providerBenefitKey: input.providerBenefitKey,
        merchantSlug: input.merchantSlug,
        sourceUrl: input.sourceUrl,
        error: errorMessage,
      });

      await this.upsertFailedImageRecord({
        ...input,
        imageKind,
        errorMessage,
      });

      return {
        sourceUrl: input.sourceUrl,
        errorMessage,
      };
    }
  }

  private async getExistingCachedImage(input: {
    providerSlug: string;
    providerBenefitKey: string;
    imageKind: string;
    sourceUrl: string;
  }): Promise<CachedBenefitImage | undefined> {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("benefit_images")
      .select("source_url, public_url, storage_path, byte_size, original_byte_size, width, height, sha256")
      .eq("provider_slug", input.providerSlug)
      .eq("provider_benefit_key", input.providerBenefitKey)
      .eq("image_kind", input.imageKind)
      .eq("source_url", input.sourceUrl)
      .eq("status", "cached")
      .maybeSingle();

    if (error) {
      logger.warn("Failed to load cached image record", {
        providerSlug: input.providerSlug,
        providerBenefitKey: input.providerBenefitKey,
        imageKind: input.imageKind,
        error: error.message,
      });
      return undefined;
    }

    if (!data?.public_url || !data.storage_path || !data.sha256) {
      return undefined;
    }

    const cached: CachedBenefitImage = {
      sourceUrl: String(data.source_url),
      publicUrl: String(data.public_url),
      storagePath: String(data.storage_path),
      byteSize: Number(data.byte_size ?? 0),
      originalByteSize: Number(data.original_byte_size ?? 0),
      sha256: String(data.sha256),
    };

    if (typeof data.width === "number") {
      cached.width = data.width;
    }

    if (typeof data.height === "number") {
      cached.height = data.height;
    }

    return cached;
  }

  private async downloadImage(sourceUrl: string): Promise<Buffer> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.BENEFIT_IMAGE_DOWNLOAD_TIMEOUT_MS);

    try {
      const response = await fetch(sourceUrl, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "accept-language": "es-CL,es;q=0.9",
          "user-agent": USER_AGENT,
        },
      });

      if (!response.ok) {
        throw new Error(`Source image returned ${response.status}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      const normalizedContentType = contentType.toLowerCase();
      if (
        normalizedContentType &&
        !normalizedContentType.includes("image/") &&
        !normalizedContentType.includes("application/octet-stream")
      ) {
        throw new Error(`Source URL did not return an image: ${contentType}`);
      }

      return Buffer.from(await response.arrayBuffer());
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildStoragePath(input: {
    providerSlug: string;
    providerBenefitKey: string;
    merchantSlug: string;
    imageKind: string;
    sha256: string;
  }): string {
    const safeProvider = sanitizePathSegment(input.providerSlug);
    const safeMerchant = sanitizePathSegment(input.merchantSlug);
    const safeKey = sanitizePathSegment(input.providerBenefitKey);
    const shortHash = input.sha256.slice(0, 16);

    return `benefits/${safeProvider}/${safeMerchant}/${safeKey}/${input.imageKind}-${shortHash}.webp`;
  }

  private async upsertImageRecord(input: CacheBenefitImageInput & {
    imageKind: string;
    cached: CachedBenefitImage;
  }): Promise<void> {
    const supabase = getSupabaseAdminClient();
    const { error } = await supabase.from("benefit_images").upsert(
      {
        provider_slug: input.providerSlug,
        provider_benefit_key: input.providerBenefitKey,
        merchant_slug: input.merchantSlug,
        benefit_id: input.benefitId ?? null,
        image_kind: input.imageKind,
        source_url: input.sourceUrl,
        storage_bucket: env.BENEFIT_IMAGES_BUCKET,
        storage_path: input.cached.storagePath,
        public_url: input.cached.publicUrl,
        mime_type: "image/webp",
        width: input.cached.width ?? null,
        height: input.cached.height ?? null,
        byte_size: input.cached.byteSize,
        original_byte_size: input.cached.originalByteSize,
        sha256: input.cached.sha256,
        status: "cached",
        error_message: null,
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider_slug,provider_benefit_key,image_kind" },
    );

    if (error) {
      logger.warn("Failed to upsert cached image record", {
        providerSlug: input.providerSlug,
        providerBenefitKey: input.providerBenefitKey,
        error: error.message,
      });
    }
  }

  private async upsertFailedImageRecord(input: CacheBenefitImageInput & {
    imageKind: string;
    errorMessage: string;
  }): Promise<void> {
    const supabase = getSupabaseAdminClient();
    const storagePath = this.buildFailedStoragePath(input);
    const { error } = await supabase.from("benefit_images").upsert(
      {
        provider_slug: input.providerSlug,
        provider_benefit_key: input.providerBenefitKey,
        merchant_slug: input.merchantSlug,
        benefit_id: input.benefitId ?? null,
        image_kind: input.imageKind,
        source_url: input.sourceUrl,
        storage_bucket: env.BENEFIT_IMAGES_BUCKET,
        storage_path: storagePath,
        public_url: "",
        status: "failed",
        error_message: input.errorMessage.slice(0, 500),
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider_slug,provider_benefit_key,image_kind" },
    );

    if (error) {
      logger.warn("Failed to upsert failed image record", {
        providerSlug: input.providerSlug,
        providerBenefitKey: input.providerBenefitKey,
        error: error.message,
      });
    }
  }

  private buildFailedStoragePath(input: CacheBenefitImageInput & { imageKind: string }): string {
    const hash = crypto.createHash("sha256").update(input.sourceUrl).digest("hex").slice(0, 16);
    return `failed/${sanitizePathSegment(input.providerSlug)}/${sanitizePathSegment(input.providerBenefitKey)}/${input.imageKind}-${hash}`;
  }
}

function sanitizePathSegment(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "unknown";
}

export const imageCacheService = new ImageCacheService();
