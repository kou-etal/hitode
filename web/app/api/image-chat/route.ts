import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { fromSSO } from "@aws-sdk/credential-provider-sso";
import { convertToModelMessages, streamText } from "ai";
import { awsCredentials, awsRegion } from "@/lib/aws";

const kbClient = new BedrockAgentRuntimeClient({
  region: awsRegion,
  ...awsCredentials,
});

const s3 = new S3Client({
  region: awsRegion,
  ...awsCredentials,
});

const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID!;
const RAW_BUCKET = process.env.RAW_IMAGE_BUCKET!;

const profile = process.env.AWS_PROFILE;
const bedrockProvider = createAmazonBedrock({
  region: awsRegion,
  ...(profile ? { credentialProvider: fromSSO({ profile }) } : {}),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTextFromMessage(msg: any): string {
  if (msg?.parts) {
    return msg.parts
      .filter(
        (p: { type: string; text?: string }) => p.type === "text" && p.text,
      )
      .map((p: { type: string; text?: string }) => p.text)
      .join("");
  }
  if (typeof msg?.content === "string") return msg.content;
  return "";
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const lastUserMessage = [...messages]
      .reverse()
      .find((m: { role: string }) => m.role === "user");
    const query = extractTextFromMessage(lastUserMessage ?? {});

    let searchResults: {
      imageId: string;
      filename: string;
      s3Key: string;
      description: string;
      score: number;
      imageUrl: string;
    }[] = [];

    try {
      const result = await kbClient.send(
        //RetrieveCommandの設定はリクエストのたびに、決める。CDKのスタックとは別。
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

      const parsed = (result.retrievalResults ?? [])
        .map((r) => {
          const text = r.content?.text ?? "";
          const score = r.score ?? 0;
          const imageIdMatch = text.match(/imageId:\s*(.+)/);
          const filenameMatch = text.match(/filename:\s*(.+)/);
          const s3KeyMatch = text.match(/s3Key:\s*(.+)/);
          const descMatch = text.match(
            /## Description\n([\s\S]*?)(?:\n## |$)/,
          );

          const imageId = imageIdMatch?.[1]?.trim();
          const filename = filenameMatch?.[1]?.trim();
          const s3Key = s3KeyMatch?.[1]?.trim();
          const description = descMatch?.[1]?.trim() ?? "";

          if (!imageId || !s3Key) return null;
          return {
            imageId,
            filename: filename ?? "",
            s3Key,
            description,
            score,
          };
        })
        .filter(Boolean) as typeof searchResults;

      searchResults = await Promise.all(
        parsed.map(async (img) => ({
          ...img,
          imageUrl: await getSignedUrl(
            s3,
            new GetObjectCommand({ Bucket: RAW_BUCKET, Key: img.s3Key }),
            { expiresIn: 3600 },
          ),
        })),
      );
    } catch (e) {
      console.error("KB search failed:", e);
    }

    const contextText =
      searchResults.length > 0
        ? searchResults
            .map(
              (img, i) =>
                `[画像${i + 1}] ID: ${img.imageId}, ファイル名: ${img.filename}, スコア: ${img.score.toFixed(3)}\n説明: ${img.description}`,
            )
            .join("\n\n")
        : "該当する画像が見つかりませんでした。";

    const imageListJson = JSON.stringify(
      searchResults.map((img) => ({
        imageId: img.imageId,
        filename: img.filename,
        imageUrl: img.imageUrl,
        score: img.score,
      })),
    );

    const result = streamText({
      model: bedrockProvider("us.anthropic.claude-sonnet-4-5-20250929-v1:0"),
      system: `あなたは画像検索アシスタントです。ユーザーの質問に対して、検索された画像データベースの結果をもとに回答してください。

検索結果:
${contextText}

回答のルール:
- 検索結果の画像について、関連性が高い順に紹介してください
- 各画像の説明文をもとに、なぜその画像が関連しているか説明してください
- 検索結果がない場合は、その旨を伝えてください
- 日本語で回答してください

重要: 回答の最後に必ず以下の形式で画像データを含めてください（これはUIで画像表示に使われます）:
<!--IMAGES:${imageListJson}-->`,
      messages: convertToModelMessages(messages),
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("image-chat error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
