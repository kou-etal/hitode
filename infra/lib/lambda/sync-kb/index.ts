import {
  // BedrockRuntimeClient  → モデルを直接使う。
  //BedrockAgentClient    → KBとかAgentを使う。（検索させる） 
  // テキスト → Embedding → ベクトル保存 → ベクトル検索 → 返却これの配線がKB。
  //別にsynclambdaもocrと同様にBedrockRuntimeClientで作ること可能。でも便利なKBを使ってる。
  BedrockAgentClient,
  StartIngestionJobCommand,
} from "@aws-sdk/client-bedrock-agent";

const client = new BedrockAgentClient({});
//const client = new BedrockAgentClient();と同様。
//普通APIルートからBedrockAgentClient({});使うときは設定(region: "us-east-1",awsCredentials)必須。
// 今回はLambda = AWS内だから自動で設定->設定配列なし。
//lambdaは一回の操作、重くない操作で使う。コールドスタート。
//サーバーからAWSはリアルタイム、リクエスト多い、重い操作で使う。サーバー常駐。
//検索部分はサーバーにしてる。
//サーバーレスはサーバーがないではなくサーバーを自分で運用しない。
//nextのapiルートはvercelで関数的にデプロイもできるし、EC2でもがっつりデプロイできる。
//でもEC2建てる場合はNextでCORSとか気にせずにサクッとサーバーサイド記述できる強み消える。
//今回はVercelでデプロイしてて検索部分もサーバー立ててないから完全サーバーレス。

export const handler = async () => {
  await client.send(//クライアント+オブジェクト
    //保存先は既に決めてるからここで設定しない。
    //dataSourceId: process.env.DATA_SOURCE_ID!,は二重設定になる。
    //stackで複数決めてからここで一つ決める->dataSourceId: process.env.DATA_SOURCE_ID!,必須。
    new StartIngestionJobCommand({
      knowledgeBaseId: process.env.KNOWLEDGE_BASE_ID!,
      dataSourceId: process.env.DATA_SOURCE_ID!,
    })
  );

  console.log("Ingestion started");
};