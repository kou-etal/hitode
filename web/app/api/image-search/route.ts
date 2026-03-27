import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { awsCredentials, awsRegion } from "@/lib/aws";

const client = new BedrockAgentRuntimeClient({
  region: awsRegion,
  ...awsCredentials,
});

const s3 = new S3Client({
  region: awsRegion,
  ...awsCredentials,
});

const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID!;
const RAW_BUCKET = process.env.RAW_IMAGE_BUCKET!;

export async function POST(req: Request) {
  try {
    const { query } = (await req.json()) as { query: string };

    if (!query) {
      return NextResponse.json(
        { error: "query is required" },
        { status: 400 },
      );
    }

    console.log("Searching KB:", KNOWLEDGE_BASE_ID, "query:", query);

    const result = await client.send(
      new RetrieveCommand({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        retrievalQuery: { text: query },
        retrievalConfiguration: {
          vectorSearchConfiguration: {
            overrideSearchType: "HYBRID",
            rerankingConfiguration: {
              type: "BEDROCK_RERANKING_MODEL",
              bedrockRerankingConfiguration: {
                numberOfRerankedResults: 5,
                modelConfiguration: {
                  modelArn: `arn:aws:bedrock:${awsRegion}::foundation-model/amazon.rerank-v1:0`,
                },
              },
            },
          },
        },
      }),
    );

    const images = (result.retrievalResults ?? [])
      .map((r) => {
        const text = r.content?.text ?? "";
        const score = r.score ?? 0;

        // メタデータからimageId, filename, s3Keyを抽出
        const imageIdMatch = text.match(/imageId:\s*(.+)/);
        const filenameMatch = text.match(/filename:\s*(.+)/);
        const s3KeyMatch = text.match(/s3Key:\s*(.+)/);
        const descMatch = text.match(/## Description\n([\s\S]*?)(?:\n## |$)/);

        const imageId = imageIdMatch?.[1]?.trim();
        const filename = filenameMatch?.[1]?.trim();
        const s3Key = s3KeyMatch?.[1]?.trim();
        const description = descMatch?.[1]?.trim() ?? "";

        if (!imageId || !s3Key) return null;

        return { imageId, filename: filename ?? "", s3Key, description, score };
      })
      .filter(Boolean);

    // presigned GET URLを生成
    const imagesWithUrls = await Promise.all(
      images.map(async (img) => ({
        ...img,
        imageUrl: await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: RAW_BUCKET, Key: img!.s3Key }),
          { expiresIn: 3600 },
        ),
      })),
    );

    return NextResponse.json({ images: imagesWithUrls, query });
  } catch (error) {
    console.error("Image search error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 },
    );
  }
}
